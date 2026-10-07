import { useEffect, useMemo, useReducer, useState } from 'react';
import { CartPanel } from '../components/CartPanel';
import { FinalizeSummary } from '../components/FinalizeSummary';
import { PosHeader } from '../components/PosHeader';
import { ProductCatalog } from '../components/ProductCatalog';
import { products } from '../data/products';
import { loadDraftCart, saveDraftCart } from '../services/cartStorage';
import type { CartItem, Product } from '../types/product';
import { changeCartItemQuantity, createCartItem } from '../utils/cart';
import { sumMoney } from '../utils/money';

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

export function PosPage() {
  const [cart, dispatch] = useReducer(cartReducer, products, loadDraftCart);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('Todos');
  const [showFinalizeSummary, setShowFinalizeSummary] = useState(false);

  const categories = useMemo(
    () => ['Todos', ...new Set(products.filter((product) => product.active).map((product) => product.category))],
    [],
  );
  const filteredProducts = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase('pt-BR');
    return products.filter((product) => {
      const matchesCategory = category === 'Todos' || product.category === category;
      const matchesSearch = product.name.toLocaleLowerCase('pt-BR').includes(normalizedSearch);
      return product.active && matchesCategory && matchesSearch;
    });
  }, [category, search]);
  const totalInCents = sumMoney(cart.map((item) => item.subtotalInCents));

  useEffect(() => {
    saveDraftCart(cart);
  }, [cart]);

  function startNewSale() {
    dispatch({ type: 'clear' });
    setShowFinalizeSummary(false);
    setSearch('');
    setCategory('Todos');
  }

  return (
    <div className="shell pos-shell">
      <div className="main pos-main">
        <main className="content pos-content">
          <PosHeader />
          <div className="title-row">
            <div>
              <h1>Nova venda</h1>
              <div className="sub">Toque nos produtos para adicionar ao carrinho.</div>
            </div>
            <span className="open-pill">● Atendimento rápido</span>
          </div>
          <div className="pos">
            <ProductCatalog
              categories={categories}
              onCategoryChange={setCategory}
              onSearchChange={setSearch}
              onSelectProduct={(product) => dispatch({ type: 'add', product })}
              products={filteredProducts}
              search={search}
              selectedCategory={category}
            />
            <CartPanel
              items={cart}
              onDecrement={(productId) => dispatch({ type: 'decrement', productId })}
              onFinalize={() => setShowFinalizeSummary(true)}
              onIncrement={(productId) => dispatch({ type: 'increment', productId })}
              onRemove={(productId) => dispatch({ type: 'remove', productId })}
              totalInCents={totalInCents}
            />
          </div>
        </main>
      </div>
      {showFinalizeSummary && (
        <FinalizeSummary
          items={cart}
          onClose={() => setShowFinalizeSummary(false)}
          onStartNewSale={startNewSale}
          totalInCents={totalInCents}
        />
      )}
    </div>
  );
}

