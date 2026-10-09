import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { CartPanel } from '../components/CartPanel';
import { FinalizeSummary } from '../components/FinalizeSummary';
import { PaymentModal } from '../components/PaymentModal';
import { PosHeader } from '../components/PosHeader';
import { ProductCatalog } from '../components/ProductCatalog';
import { loadDraftCart, saveDraftCart } from '../services/cartStorage';
import { saveCompletedSale, saveCompletedSaleWithCustomerCredit, SaleCreditFinalizationPendingError } from '../services/saleStorage';
import { getOpenCashSession, loadCashData } from '../services/cashStorage';
import type { CartItem, Product } from '../types/product';
import type { SalePayment } from '../types/payment';
import type { Sale } from '../types/sale';
import type { StoreSettings } from '../types/settings';
import type { AppPage } from '../types/navigation';
import { changeCartItemQuantity, createCartItem } from '../utils/cart';
import { sumMoney } from '../utils/money';
import { calculatePaymentTotals, createSalePayment } from '../utils/payments';

type CartAction =
  | { type: 'add'; product: Product }
  | { type: 'increment'; productId: string }
  | { type: 'decrement'; productId: string }
  | { type: 'remove'; productId: string }
  | { type: 'clear' };

function cartReducer(items: CartItem[], action: CartAction): CartItem[] {
  switch (action.type) {
    case 'add': {
      const existing = items.find((item) => item.product.id === action.product.id);
      if (!existing) return [...items, createCartItem(action.product)];
      return items.map((item) => item.product.id === action.product.id
        ? changeCartItemQuantity(item, item.quantity + 1)
        : item);
    }
    case 'increment':
      return items.map((item) => item.product.id === action.productId
        ? changeCartItemQuantity(item, item.quantity + 1)
        : item);
    case 'decrement':
      return items.flatMap((item) => {
        if (item.product.id !== action.productId) return [item];
        return item.quantity <= 1 ? [] : [changeCartItemQuantity(item, item.quantity - 1)];
      });
    case 'remove':
      return items.filter((item) => item.product.id !== action.productId);
    case 'clear':
      return [];
  }
}

type PosPageProps = {
  onNavigate: (page: AppPage) => void;
  products: Product[];
  settings: StoreSettings;
  cashSessionId?: string;
  cashSessionLabel?: string;
  hasPendingCash?: boolean;
};

export function PosPage({ onNavigate, products, settings, cashSessionId, cashSessionLabel, hasPendingCash }: PosPageProps) {
  const finalizingSale = useRef(false);
  const [cart, dispatch] = useReducer(cartReducer, products, loadDraftCart);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('Todos');
  const [showPayment, setShowPayment] = useState(false);
  const [payments, setPayments] = useState<SalePayment[]>([]);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [completedSale, setCompletedSale] = useState<Sale | null>(null);

  const categories = useMemo(
    () => ['Todos', ...new Set(products.filter((product) => product.active).map((product) => product.category))],
    [products],
  );
  const filteredProducts = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase('pt-BR');
    return products.filter((product) => {
      const matchesCategory = category === 'Todos' || product.category === category;
      const matchesSearch = product.name.toLocaleLowerCase('pt-BR').includes(normalizedSearch);
      return product.active && matchesCategory && matchesSearch;
    });
  }, [category, search, products]);
  useEffect(() => { if (!categories.includes(category)) setCategory('Todos'); }, [categories, category]);
  const totalInCents = sumMoney(cart.map((item) => item.subtotalInCents));

  useEffect(() => {
    saveDraftCart(cart);
  }, [cart]);

  function startNewSale() {
    finalizingSale.current = false;
    dispatch({ type: 'clear' });
    setPayments([]);
    setPaymentError(null);
    setCompletedSale(null);
    setShowPayment(false);
    setSearch('');
    setCategory('Todos');
  }

  function openPayment() {
    if (cart.length === 0) return;
    setPaymentError(null);
    setShowPayment(true);
  }

  function addPayment(payment: SalePayment) {
    const { pendingInCents } = calculatePaymentTotals(totalInCents, payments);
    if (payment.method === 'customer_credit') {
      if (!payment.customerCreditId || !Number.isSafeInteger(payment.amountInCents) || payment.amountInCents <= 0 || payment.amountInCents > pendingInCents) return;
      setPayments((current) => [...current, payment]);
      return;
    }
    const enteredInCents = payment.method === 'cash' ? payment.amountReceivedInCents ?? 0 : payment.amountInCents;
    const validatedPayment = createSalePayment(payment.method, enteredInCents, pendingInCents);
    if (validatedPayment) setPayments((current) => [...current, validatedPayment]);
  }

  async function finalizePayment() {
    if (!cashSessionId || finalizingSale.current || cart.length === 0 || payments.length === 0) return;
    const persistedOpenSession = getOpenCashSession(loadCashData());
    if (!persistedOpenSession || persistedOpenSession.id !== cashSessionId) { setPaymentError('O caixa foi fechado ou trocado. Abra o caixa novamente antes de concluir a venda.'); return; }
    if (calculatePaymentTotals(totalInCents, payments).pendingInCents !== 0) return;
    finalizingSale.current = true; setPaymentError(null);
    try {
      const sale = payments.some((payment) => payment.method === 'customer_credit')
        ? await saveCompletedSaleWithCustomerCredit(cart, totalInCents, payments, cashSessionId)
        : await saveCompletedSale(cart, totalInCents, payments, cashSessionId);
      saveDraftCart([]); setCompletedSale(sale); setShowPayment(false); setPayments([]); dispatch({ type: 'clear' });
    } catch (error) {
      if (error instanceof SaleCreditFinalizationPendingError) {
        saveDraftCart([]); dispatch({ type: 'clear' }); setPayments([]); setShowPayment(false);
      } else finalizingSale.current = false;
      setPaymentError(error instanceof Error ? error.message : 'Não foi possível salvar a venda. Verifique o armazenamento local e tente novamente.');
    }
  }

  return (
    !cashSessionId ? <main className="content cash-blocked-content">
      <div className="cash-closed-card"><span aria-hidden="true" className="cash-state-icon">◷</span><h1>{hasPendingCash ? "Caixa pendente de fechamento" : "Entrada do operador"}</h1>
        <p>Selecione o operador e abra o caixa de hoje. Um caixa de outra data não pode receber novas vendas.</p>
        <button className="btn primary" onClick={() => onNavigate('cash')} type="button">Abrir caixa</button>
      </div>
    </main> :
    <div className="shell pos-shell">
      <div className="main pos-main">
        <main className="content pos-content">
          <PosHeader onNavigate={onNavigate} />
          <div className="title-row">
            <div>
              <h1>Nova venda</h1>
              <div className="sub">Toque nos produtos para adicionar ao carrinho.</div>
            </div>
            <span className="open-pill">● Caixa {cashSessionLabel}</span>
          </div>
          {paymentError && !showPayment && <p className="sale-save-error" role="alert">{paymentError}</p>}
          <div className="pos">
            <ProductCatalog
              categories={categories}
              onCategoryChange={setCategory}
              onSearchChange={setSearch}
              onSelectProduct={(product) => { if (product.active) dispatch({ type: 'add', product }); }}
              products={filteredProducts}
              search={search}
              selectedCategory={category}
            />
            <CartPanel
              items={cart}
              onDecrement={(productId) => dispatch({ type: 'decrement', productId })}
              onFinalize={openPayment}
              onIncrement={(productId) => dispatch({ type: 'increment', productId })}
              onRemove={(productId) => dispatch({ type: 'remove', productId })}
              totalInCents={totalInCents}
            />
          </div>
        </main>
      </div>
      {showPayment && (
        <PaymentModal
          onAddPayment={addPayment}
          onClose={() => setShowPayment(false)}
          onFinalize={finalizePayment}
          onRemovePayment={(index) => setPayments((current) => current.filter((_, paymentIndex) => paymentIndex !== index))}
          errorMessage={paymentError}
          payments={payments}
          totalInCents={totalInCents}
        />
      )}
      {completedSale && (
        <FinalizeSummary
          sale={completedSale}
          onStartNewSale={startNewSale}
          settings={settings}
        />
      )}
    </div>
  );
}
