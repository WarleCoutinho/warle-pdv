import { useMemo } from 'react';
import { AppPageTopBar } from '../components/AppPageTopBar';
import { PaymentBreakdown } from '../components/PaymentBreakdown';
import { StatCard } from '../components/StatCard';
import type { AppPage } from '../types/navigation';
import { formatMoney } from '../utils/money';
import { filterSalesByPeriod, filterRecordedSalesByPeriod, getPaymentTotals, getFinancialPeriodSummary, getPeriodReceivedSummary, getSalesMetrics, sortSalesMostRecent } from '../utils/salesAnalytics';
import { paymentMethodLabels } from '../types/payment';
import { usePersistedSales } from '../hooks/usePersistedSales';
import type { CashData } from '../types/cash';
import { getOpenCashSession } from '../domain/cashSessions';
import { cashLabel } from '../utils/cashDay';
import { getCashSummary } from '../utils/cash';

type DashboardPageProps = {
  onNavigate: (page: AppPage) => void;
  cashData: CashData;
};

const dateFormatter = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
const timeFormatter = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

export function DashboardPage({ onNavigate, cashData }: DashboardPageProps) {
  const { sales, financial, referenceDate, loading, error } = usePersistedSales();
  const todaySales = useMemo(() => filterSalesByPeriod(sales, 'today', referenceDate), [sales, referenceDate]);
  const todayMetrics = useMemo(() => getSalesMetrics(todaySales, financial), [todaySales, financial]);
  const allMetrics = useMemo(() => getSalesMetrics(sales, financial), [sales, financial]);
  const recentSales = useMemo(() => sortSalesMostRecent(sales).slice(0, 5), [sales]);
  const paymentTotals = useMemo(() => getPaymentTotals(filterRecordedSalesByPeriod(sales, 'today', referenceDate), true), [sales, referenceDate]);
  const openCash = getOpenCashSession(cashData);
  const cashSummary = !error && openCash ? getCashSummary(openCash, cashData.movements, sales) : null;

  const financialSummary = getFinancialPeriodSummary(financial, 'today', referenceDate);

  const receivedSummary = getPeriodReceivedSummary(sales, financial, 'today', referenceDate);

  return (
    <main className="content analytics-content">
      <AppPageTopBar activePage="home" onNavigate={onNavigate} />
      <div className="title-row analytics-title-row">
        <div>
          <h1>Início</h1>
          <div className="sub">Resumo das vendas registradas no seu PDV.</div>
        </div>
        <button className="btn primary dashboard-cta" onClick={() => onNavigate('pos')} type="button">＋ Nova venda</button>
      </div>

      {openCash && cashSummary && <button className="dashboard-cash-indicator" onClick={() => onNavigate('cash')} type="button">
        <span><i /> {cashLabel(openCash)}</span><b>Saldo esperado: {formatMoney(cashSummary.expectedInCents)}</b><small>Dinheiro físico · ver controle do caixa →</small>
      </button>}

      {error ? <div className="analytics-error" role="alert">{error}</div> : loading ? (
        <div className="analytics-loading" role="status">Carregando vendas salvas...</div>
      ) : (
        <>
          <section aria-label="Indicadores de hoje" className="analytics-stat-grid">
            <StatCard accent="green" label="Faturamento hoje" value={formatMoney(todayMetrics.revenueInCents)} detail="Total das vendas concluídas hoje" />
            <StatCard accent="blue" label="Vendas hoje" value={String(todayMetrics.saleCount)} detail={todayMetrics.saleCount === 1 ? 'Venda concluída' : 'Vendas concluídas'} />
            <StatCard accent="purple" label="Ticket médio" value={formatMoney(todayMetrics.averageTicketInCents)} detail="Faturamento ÷ vendas de hoje" />
            <StatCard accent="orange" label="Última venda" value={allMetrics.latestSale ? formatMoney(allMetrics.latestSale.totalInCents) : 'Sem vendas'} detail={allMetrics.latestSale
              ? `#${String(allMetrics.latestSale.number).padStart(6, '0')} · ${timeFormatter.format(new Date(allMetrics.latestSale.date))}`
              : 'Ainda não há vendas registradas'} />
          </section>

          <section className="analytics-financial-summary" aria-label="Devoluções e créditos no período">
            <p>Faturamento: vendas concluídas. Recebido líquido: dinheiro, Pix e cartões menos reembolsos realizados. Emitir crédito não reduz o recebido; usar crédito em uma compra não gera novo recebimento.</p>
            <div><span>Valor recebido líquido <b>{formatMoney(receivedSummary.netReceivedInCents)}</b></span><span>Reembolsos realizados <b>{formatMoney(financialSummary.refundedInCents)}</b></span><span>Reembolsos pendentes <b>{formatMoney(financialSummary.pendingInCents)}</b></span><span>Créditos emitidos <b>{formatMoney(financialSummary.issuedCreditInCents)}</b></span></div>
          </section>
          <div className="analytics-dashboard-grid">
            <section aria-labelledby="dashboard-payments-title" className="analytics-panel">
              <div className="analytics-panel-heading">
                <div><h2 id="dashboard-payments-title">Formas de pagamento</h2><p>Pagamentos registrados hoje, inclusive de vendas canceladas. Reembolsos aparecem separadamente.</p></div>
                <span className="analytics-period-badge">Hoje</span>
              </div>
              <PaymentBreakdown totalInCents={Object.values(paymentTotals).reduce((sum, value) => sum + value, 0)} totals={paymentTotals} />
            </section>

            <section aria-labelledby="recent-sales-title" className="analytics-panel recent-sales-panel">
              <div className="analytics-panel-heading">
                <div><h2 id="recent-sales-title">Vendas recentes</h2><p>Últimas vendas concluídas.</p></div>
                <button className="text-action" onClick={() => onNavigate('history')} type="button">Ver histórico →</button>
              </div>
              {recentSales.length === 0 ? (
                <div className="analytics-panel-empty">Nenhuma venda registrada ainda.</div>
              ) : (
                <ul className="recent-sales-list">
                  {recentSales.map((sale) => {
                    const methods = [...new Set(sale.payments.map((payment) => payment.method))];
                    const paymentText = methods.map((method) => paymentMethodLabels[method]).join(' + ') || '—';
                    return (
                      <li key={sale.id}>
                        <div><b>#{String(sale.number).padStart(6, '0')}</b><small>{dateFormatter.format(new Date(sale.date))} · {timeFormatter.format(new Date(sale.date))}</small></div>
                        <span className="recent-sale-payment">{paymentText}</span>
                        <strong>{formatMoney(sale.totalInCents)}</strong>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>
        </>
      )}
    </main>
  );
}
