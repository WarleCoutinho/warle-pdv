import { useEffect, useMemo, useState } from 'react';
import { Receipt, type ReceiptPaperSize } from '../components/Receipt';
import { AppPageTopBar } from '../components/AppPageTopBar';
import { paymentMethodLabels, type PaymentMethod } from '../types/payment';
import type { AppPage } from '../types/navigation';
import type { Sale } from '../types/sale';
import type { StoreSettings } from '../types/settings';
import { listSales } from '../services/saleStorage';
import { formatMoney } from '../utils/money';
import { printCurrentReceipt } from '../utils/printing';

type HistoryPageProps = {
  onNavigate: (page: AppPage) => void;
  settings: StoreSettings;
};

type PeriodFilter = 'today' | 'week' | 'month' | 'all';

const dateFormatter = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit', month: '2-digit', year: 'numeric',
});
const timeFormatter = new Intl.DateTimeFormat('pt-BR', {
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

export function HistoryPage({ onNavigate, settings }: HistoryPageProps) {
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [period, setPeriod] = useState<PeriodFilter>('all');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | 'all'>('all');
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);

  useEffect(() => {
    try {
      setSales(listSales());
    } catch {
      setLoadError('Não foi possível carregar as vendas salvas. Verifique os dados no armazenamento local.');
    } finally {
      setLoading(false);
    }
  }, []);

  const filteredSales = useMemo(() => {
    const normalizedQuery = query.trim().replace(/^#/, '');
    const today = new Date();
    const weekStart = startOfWeek(today);
    const nextWeekStart = new Date(weekStart);
    nextWeekStart.setDate(nextWeekStart.getDate() + 7);

    return [...sales]
      .sort((left, right) => Date.parse(right.date) - Date.parse(left.date))
      .filter((sale) => {
        const saleDate = new Date(sale.date);
        const matchesNumber = !normalizedQuery
          || String(sale.number).padStart(6, '0').includes(normalizedQuery);
        const matchesPeriod = period === 'all'
          || (period === 'today' && isSameLocalDay(saleDate, today))
          || (period === 'week' && saleDate >= weekStart && saleDate < nextWeekStart)
          || (period === 'month' && saleDate.getFullYear() === today.getFullYear() && saleDate.getMonth() === today.getMonth());
        const matchesPayment = paymentMethod === 'all'
          || sale.payments.some((payment) => payment.method === paymentMethod);
        return matchesNumber && matchesPeriod && matchesPayment;
      });
  }, [sales, query, period, paymentMethod]);

  return (
    <div className="shell history-shell">
      <main className="content history-content">
        <AppPageTopBar activePage="history" onNavigate={onNavigate} />

        <div className="title-row history-title-row">
          <div>
            <h1>Histórico de vendas</h1>
            <div className="sub">Consulte vendas realizadas e reimprima comprovantes.</div>
          </div>
          {!loading && !loadError && <span className="history-count">{filteredSales.length} {filteredSales.length === 1 ? 'venda' : 'vendas'}</span>}
        </div>

        <section aria-label="Filtros do histórico" className="history-filters">
          <div className="history-search">
            <label htmlFor="history-search">Buscar venda</label>
            <input
              autoComplete="off"
              id="history-search"
              inputMode="numeric"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar pelo número..."
              value={query}
            />
          </div>
          <div>
            <label htmlFor="history-period">Período</label>
            <select id="history-period" onChange={(event) => setPeriod(event.target.value as PeriodFilter)} value={period}>
              <option value="today">Hoje</option>
              <option value="week">Esta semana</option>
              <option value="month">Este mês</option>
              <option value="all">Todas</option>
            </select>
          </div>
          <div>
            <label htmlFor="history-payment">Forma de pagamento</label>
            <select id="history-payment" onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod | 'all')} value={paymentMethod}>
              <option value="all">Todas</option>
              <option value="cash">Dinheiro</option>
              <option value="pix">Pix</option>
              <option value="debit">Débito</option>
              <option value="credit">Crédito</option>
            </select>
          </div>
        </section>

        {loadError ? (
          <div className="history-message error" role="alert">{loadError}</div>
        ) : loading ? (
          <div className="history-message" role="status">Carregando vendas...</div>
        ) : filteredSales.length === 0 ? (
          <div className="history-message">
            <span aria-hidden="true" className="history-empty-icon">▤</span>
            <b>{sales.length === 0 ? 'Nenhuma venda encontrada.' : 'Nenhuma venda corresponde aos filtros selecionados.'}</b>
            {sales.length === 0 && <span>As vendas concluídas aparecerão aqui.</span>}
          </div>
        ) : (
          <section aria-label="Vendas encontradas" className="history-table-card">
            <table className="history-table">
              <thead>
                <tr><th>Venda</th><th>Data</th><th>Hora</th><th>Total</th><th>Pagamento</th><th><span className="sr-only">Ação</span></th></tr>
              </thead>
              <tbody>
                {filteredSales.map((sale) => (
                  <tr key={sale.id}>
                    <td><span className="history-mobile-label">Venda</span><b>#{String(sale.number).padStart(6, '0')}</b></td>
                    <td><span className="history-mobile-label">Data</span>{dateFormatter.format(new Date(sale.date))}</td>
                    <td><span className="history-mobile-label">Hora</span>{timeFormatter.format(new Date(sale.date))}</td>
                    <td><span className="history-mobile-label">Total</span><b>{formatMoney(sale.totalInCents)}</b></td>
                    <td><span className="history-mobile-label">Pagamento</span>{getPaymentSummary(sale)}</td>
                    <td><button className="btn quiet history-detail-button" onClick={() => setSelectedSale(sale)} type="button">Ver detalhes <span aria-hidden="true">→</span></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </main>

      {selectedSale && (
        <SaleDetailsModal sale={selectedSale} onClose={() => setSelectedSale(null)} settings={settings} />
      )}
    </div>
  );
}

type SaleDetailsModalProps = {
  sale: Sale;
  onClose: () => void;
  settings: StoreSettings;
};

function SaleDetailsModal({ sale, onClose, settings }: SaleDetailsModalProps) {
  const [paperSize, setPaperSize] = useState<ReceiptPaperSize>('80mm');
  const saleDate = new Date(sale.date);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  return (
    <div className="overlay success-overlay history-detail-overlay" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <section aria-labelledby="history-detail-title" aria-modal="true" className="modal history-detail-modal" role="dialog">
        <div className="modalhead">
          <div><h2 id="history-detail-title">Venda #{String(sale.number).padStart(6, '0')}</h2><div className="sub" style={{ marginTop: 5 }}>{dateFormatter.format(saleDate)} às {timeFormatter.format(saleDate)}</div></div>
          <button aria-label="Fechar detalhes" className="x" onClick={onClose} type="button">×</button>
        </div>
        <div className="success history-detail-content">
          <section aria-labelledby="history-items-title" className="history-detail-section">
            <h3 id="history-items-title">Produtos</h3>
            <div className="history-detail-items">
              {sale.items.map((item) => (
                <div className="history-detail-item" key={`${item.productId}-${item.productName}`}>
                  <div><b>{item.quantity}× {item.productName}</b><small>{formatMoney(item.unitPriceInCents)} cada</small></div>
                  <b>{formatMoney(item.subtotalInCents)}</b>
                </div>
              ))}
            </div>
            <div className="history-detail-total"><span>Total da venda</span><b>{formatMoney(sale.totalInCents)}</b></div>
          </section>

          <section aria-labelledby="history-payments-title" className="history-detail-section">
            <h3 id="history-payments-title">Pagamentos</h3>
            {sale.payments.map((payment, index) => (
              <div className="history-detail-payment" key={`${payment.method}-${index}`}>
                <div className="history-detail-payment-heading"><b>{paymentMethodLabels[payment.method]}</b>{payment.method !== 'cash' && <b>{formatMoney(payment.amountInCents)}</b>}</div>
                {payment.method === 'cash' && (
                  <dl className="history-cash-breakdown">
                    <div><dt>Recebido</dt><dd>{formatMoney(payment.amountReceivedInCents ?? payment.amountInCents)}</dd></div>
                    <div><dt>Aplicado</dt><dd>{formatMoney(payment.amountInCents)}</dd></div>
                    <div><dt>Troco</dt><dd>{formatMoney(payment.changeInCents ?? 0)}</dd></div>
                  </dl>
                )}
              </div>
            ))}
          </section>

          <div className="receipt-controls history-receipt-controls">
            <label htmlFor="history-receipt-paper">Largura do papel</label>
            <select id="history-receipt-paper" onChange={(event) => setPaperSize(event.target.value as ReceiptPaperSize)} value={paperSize}>
              <option value="58mm">Térmica 58 mm</option>
              <option value="80mm">Térmica 80 mm</option>
              <option value="a4">Impressora comum (A4)</option>
            </select>
          </div>
          <Receipt paperSize={paperSize} sale={sale} settings={settings} />
          <div className="history-detail-actions">
            <button className="btn secondary" onClick={onClose} type="button">← Voltar ao histórico</button>
            <button className="btn primary" onClick={printCurrentReceipt} type="button">▤ Reimprimir comprovante</button>
          </div>
        </div>
      </section>
    </div>
  );
}

function getPaymentSummary(sale: Sale): string {
  const methods = [...new Set(sale.payments.map((payment) => payment.method))];
  return methods.map((method) => paymentMethodLabels[method]).join(' + ') || '—';
}

function startOfWeek(date: Date): Date {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const daysSinceMonday = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - daysSinceMonday);
  return start;
}

function isSameLocalDay(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

