import { useEffect, useMemo, useState } from 'react';
import { Receipt, type ReceiptPaperSize } from '../components/Receipt';
import { AppPageTopBar } from '../components/AppPageTopBar';
import { useModalFocus } from '../hooks/useModalFocus';
import { paymentMethodLabels, type SaleTenderMethod } from '../types/payment';
import type { AppPage } from '../types/navigation';
import { saleCancellationReasonLabels, type Sale, type SaleCancellationReason } from '../types/sale';
import type { StoreSettings } from '../types/settings';
import { cancelSaleAndRestoreCustomerCredit } from '../services/saleStorage';
import { SaleFinancialPanel } from '../components/SaleFinancialPanel';
import { CustomerCreditLookupPanel } from '../components/CustomerCreditLookupPanel';
import { usePersistedSales } from '../hooks/usePersistedSales';
import { getReceivedSummary } from '../utils/salesAnalytics';
import { formatMoney } from '../utils/money';
import { printCurrentReceipt } from '../utils/printing';
import { getSaleStatus } from '../utils/saleStatus';

type HistoryPageProps = {
  onNavigate: (page: AppPage) => void;
  settings: StoreSettings;
};

type PeriodFilter = 'today' | 'week' | 'month' | 'all';
type StatusFilter = 'all' | 'completed' | 'cancelled';

const dateFormatter = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit', month: '2-digit', year: 'numeric',
});
const timeFormatter = new Intl.DateTimeFormat('pt-BR', {
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

export function HistoryPage({ onNavigate, settings }: HistoryPageProps) {
  const { sales, financial, referenceDate, loading, error: loadError } = usePersistedSales();
  const [query, setQuery] = useState('');
  const [period, setPeriod] = useState<PeriodFilter>('all');
  const [paymentMethod, setPaymentMethod] = useState<SaleTenderMethod | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);

  const filteredSales = useMemo(() => {
    const normalizedQuery = query.trim().replace(/^#/, '');
    const today = referenceDate;
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
        const matchesStatus = statusFilter === 'all' || getSaleStatus(sale) === statusFilter;
        return matchesNumber && matchesPeriod && matchesPayment && matchesStatus;
      });
  }, [sales, query, period, paymentMethod, statusFilter, referenceDate]);

  function handleSaleUpdated(updatedSale: Sale) {
    setSelectedSale(updatedSale);
  }

  const filteredIds = new Set(filteredSales.map((sale) => sale.id));
  const totals = getReceivedSummary(filteredSales, financial.refunds.filter((refund) => filteredIds.has(refund.saleId)));
  useEffect(() => { setSelectedSale((selected) => selected ? sales.find((sale) => sale.id === selected.id) ?? null : null); }, [sales]);

  return (
    <div className="shell history-shell">
      <main className="content history-content">
        <AppPageTopBar activePage="history" onNavigate={onNavigate} />

        <div className="title-row history-title-row">
          <div>
            <h1>Histórico de vendas</h1>
            <div className="sub">Consulte vendas realizadas e reimprima comprovantes.</div>
          </div>
          {!loading && !loadError && <span className="history-count">{totals.saleCount} concluída(s) · {totals.cancelledCount} cancelada(s)</span>}
        </div>

        <CustomerCreditLookupPanel />

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
            <select id="history-payment" onChange={(event) => setPaymentMethod(event.target.value as SaleTenderMethod | 'all')} value={paymentMethod}>
              <option value="all">Todas</option>
              <option value="cash">Dinheiro</option>
              <option value="pix">Pix</option>
              <option value="debit">Débito</option>
              <option value="credit">Crédito</option><option value="customer_credit">Crédito do cliente</option>
            </select>
          </div>
          <div>
            <label htmlFor="history-status">Status</label>
            <select id="history-status" onChange={(event) => setStatusFilter(event.target.value as StatusFilter)} value={statusFilter}>
              <option value="all">Todas</option><option value="completed">Concluídas</option><option value="cancelled">Canceladas</option>
            </select>
          </div>
        </section>

        {!loading && !loadError && <section className="analytics-financial-summary" aria-label="Totais do histórico"><p>Totais das vendas filtradas. Canceladas ficam no histórico; emitir crédito não é saída de dinheiro. Reembolsos abaixo pertencem a essas vendas, mesmo quando realizados depois.</p><div><span>Vendas concluídas <b>{totals.saleCount}</b></span><span>Faturamento <b>{formatMoney(totals.revenueInCents)}</b></span><span>Reembolsos realizados <b>{formatMoney(totals.refundedInCents)}</b></span><span>Valor recebido líquido <b>{formatMoney(totals.netReceivedInCents)}</b></span></div></section>}
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
                    <td><span className="history-mobile-label">Venda</span><b>#{String(sale.number).padStart(6, '0')}</b>{getSaleStatus(sale) === 'cancelled' && <span className="sale-status-badge is-cancelled">Cancelada</span>}</td>
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
        <SaleDetailsModal onSaleUpdated={handleSaleUpdated} sale={selectedSale} onClose={() => setSelectedSale(null)} settings={settings} />
      )}
    </div>
  );
}

type SaleDetailsModalProps = {
  sale: Sale;
  onSaleUpdated: (sale: Sale) => void;
  onClose: () => void;
  settings: StoreSettings;
};

function SaleDetailsModal({ sale, onSaleUpdated, onClose, settings }: SaleDetailsModalProps) {
  const [paperSize, setPaperSize] = useState<ReceiptPaperSize>('80mm');
  const [showCancellation, setShowCancellation] = useState(false);
  const [cancellationError, setCancellationError] = useState<string | null>(null);
  const saleDate = new Date(sale.date);

  const dialogRef = useModalFocus(onClose);

  return (
    <div className="overlay success-overlay history-detail-overlay" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <section aria-labelledby="history-detail-title" aria-modal="true" className="modal history-detail-modal" ref={dialogRef} role="dialog" tabIndex={-1}>
        <div className="modalhead">
          <div><h2 id="history-detail-title">Venda #{String(sale.number).padStart(6, '0')}</h2><div className="sub" style={{ marginTop: 5 }}>{dateFormatter.format(saleDate)} às {timeFormatter.format(saleDate)}</div></div>
          <button aria-label="Fechar detalhes" className="x" onClick={onClose} type="button">×</button>
        </div>
        <div className="success history-detail-content">
          {getSaleStatus(sale) === 'cancelled' && <section aria-label="Dados do cancelamento" className="sale-cancellation-summary">
            <b>Venda cancelada</b><span>Cancelada em {sale.cancelledAt ? `${dateFormatter.format(new Date(sale.cancelledAt))} às ${timeFormatter.format(new Date(sale.cancelledAt))}` : '—'}</span>
            <span>Motivo: {sale.cancellationReason ? saleCancellationReasonLabels[sale.cancellationReason] : '—'}</span>
            {sale.cancellationNote && <span>Observação: {sale.cancellationNote}</span>}
          </section>}
          <section aria-labelledby="history-items-title" className="history-detail-section">
            <h3 id="history-items-title">Produtos</h3>
            <div className="history-detail-items">
              {sale.items.map((item, index) => (
                <div className="history-detail-item" key={item.lineId ?? `legacy-line-${index + 1}`}>
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

          <SaleFinancialPanel sale={sale} settings={settings} />

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
            {getSaleStatus(sale) === 'completed' && <button className="btn danger history-cancel-sale" onClick={() => { setCancellationError(null); setShowCancellation(true); }} type="button">Cancelar venda</button>}
            <button className="btn primary" onClick={printCurrentReceipt} type="button">▤ Reimprimir comprovante</button>
          </div>
        </div>
      </section>
      {showCancellation && <SaleCancellationModal error={cancellationError} onClose={() => setShowCancellation(false)} onConfirm={async (reason, note) => { try { const updated = await cancelSaleAndRestoreCustomerCredit(sale.id, reason, note); onSaleUpdated(updated); setShowCancellation(false); } catch (error) { setCancellationError(error instanceof Error ? error.message : 'Não foi possível cancelar a venda.'); } }} sale={sale} />}
    </div>
  );
}

function SaleCancellationModal({ sale, error, onClose, onConfirm }: { sale: Sale; error: string | null; onClose: () => void; onConfirm: (reason: SaleCancellationReason, note: string) => void; }) {
  const dialogRef = useModalFocus<HTMLFormElement>(onClose);
  const [reason, setReason] = useState<SaleCancellationReason | ''>(''); const [note, setNote] = useState('');
  const canConfirm = reason !== '' && (reason !== 'other' || !!note.trim());
  return <div className="overlay cancellation-overlay" onClick={(event) => event.target === event.currentTarget && onClose()}>
    <form aria-labelledby="cancel-sale-title" aria-modal="true" className="modal cancellation-modal" ref={dialogRef} tabIndex={-1} onSubmit={(event) => { event.preventDefault(); if (canConfirm) onConfirm(reason as SaleCancellationReason, note); }} role="dialog">
      <div className="modalhead"><h2 id="cancel-sale-title">Cancelar venda #{String(sale.number).padStart(6, '0')}?</h2><button aria-label="Fechar confirmação" className="x" onClick={onClose} type="button">×</button></div>
      <div className="modalbody cancellation-body"><p>Esta ação marcará a venda como cancelada. Ela continuará disponível no histórico, mas deixará de participar dos cálculos de vendas e faturamento.</p>
        <label className="field" htmlFor="cancellation-reason">Motivo do cancelamento<select id="cancellation-reason" onChange={(event) => setReason(event.target.value as SaleCancellationReason | '')} required value={reason}><option disabled value="">Selecione um motivo</option>{Object.entries(saleCancellationReasonLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        {reason === 'other' && <label className="field" htmlFor="cancellation-note">Observação<textarea id="cancellation-note" maxLength={300} onChange={(event) => setNote(event.target.value)} required value={note} /></label>}
        {error && <div className="settings-error" role="alert">{error}</div>}
      </div>
      <div className="modalfoot"><button className="btn secondary" onClick={onClose} type="button">Voltar</button><button className="btn danger" disabled={!canConfirm} type="submit">Confirmar cancelamento</button></div>
    </form>
  </div>;
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

