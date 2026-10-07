import { useMemo } from 'react';
import { AppPageTopBar } from '../components/AppPageTopBar';
import { PaymentBreakdown } from '../components/PaymentBreakdown';
import { StatCard } from '../components/StatCard';
import type { AppPage } from '../types/navigation';
import { formatMoney } from '../utils/money';
import { filterSalesByPeriod, getPaymentTotals, getSalesMetrics, sortSalesMostRecent } from '../utils/salesAnalytics';
import { paymentMethodLabels } from '../types/payment';
import { usePersistedSales } from '../hooks/usePersistedSales';

type DashboardPageProps = {
  onNavigate: (page: AppPage) => void;
};

const dateFormatter = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
const timeFormatter = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

export function DashboardPage({ onNavigate }: DashboardPageProps) {
  const { sales, loading, error } = usePersistedSales();
  const referenceDate = useMemo(() => new Date(), []);
  const todaySales = useMemo(() => filterSalesByPeriod(sales, 'today', referenceDate), [sales, referenceDate]);
  const todayMetrics = useMemo(() => getSalesMetrics(todaySales), [todaySales]);
  const allMetrics = useMemo(() => getSalesMetrics(sales), [sales]);
  const recentSales = useMemo(() => sortSalesMostRecent(sales).slice(0, 5), [sales]);
  const paymentTotals = useMemo(() => getPaymentTotals(todaySales), [todaySales]);

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

      {error ? <div className="analytics-error" role="alert">{error}</div> : loading ? (
        <div className="analytics-loading" role="status">Carregando vendas salvas...</div>
      ) : (
        <>
          <section aria-label="Indicadores de hoje" className="analytics-stat-grid">
            <StatCard accent="green" label="Faturamento hoje" value={formatMoney(todayMetrics.revenueInCents)} detail="Vendas concluídas hoje" />
            <StatCard accent="blue" label="Vendas hoje" value={String(todayMetrics.saleCount)} detail={todayMetrics.saleCount === 1 ? 'Venda concluída' : 'Vendas concluídas'} />
            <StatCard accent="purple" label="Ticket médio" value={formatMoney(todayMetrics.averageTicketInCents)} detail="Faturamento ÷ vendas de hoje" />
            <StatCard accent="orange" label="Última venda" value={allMetrics.latestSale ? formatMoney(allMetrics.latestSale.totalInCents) : 'Sem vendas'} detail={allMetrics.latestSale
              ? `#${String(allMetrics.latestSale.number).padStart(6, '0')} · ${timeFormatter.format(new Date(allMetrics.latestSale.date))}`
              : 'Ainda não há vendas registradas'} />
          </section>

          <div className="analytics-dashboard-grid">
            <section aria-labelledby="dashboard-payments-title" className="analytics-panel">
              <div className="analytics-panel-heading">
                <div><h2 id="dashboard-payments-title">Formas de pagamento</h2><p>Valores aplicados às vendas de hoje.</p></div>
                <span className="analytics-period-badge">Hoje</span>
              </div>
              <PaymentBreakdown totalInCents={todayMetrics.revenueInCents} totals={paymentTotals} />
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
