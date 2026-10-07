import { useMemo, useState } from 'react';
import { AppPageTopBar } from '../components/AppPageTopBar';
import { PaymentBreakdown } from '../components/PaymentBreakdown';
import { SalesTrendChart } from '../components/SalesTrendChart';
import { StatCard } from '../components/StatCard';
import { usePersistedSales } from '../hooks/usePersistedSales';
import type { AppPage } from '../types/navigation';
import { formatMoney } from '../utils/money';
import { filterSalesByPeriod, getPaymentTotals, getSalesMetrics, getSalesTrend, type SalesPeriod } from '../utils/salesAnalytics';

type ReportsPageProps = {
  onNavigate: (page: AppPage) => void;
};

const periodOptions: { id: SalesPeriod; label: string }[] = [
  { id: 'today', label: 'Hoje' },
  { id: 'week', label: 'Esta semana' },
  { id: 'month', label: 'Este mês' },
];

export function ReportsPage({ onNavigate }: ReportsPageProps) {
  const [period, setPeriod] = useState<SalesPeriod>('today');
  const { sales, loading, error } = usePersistedSales();
  const referenceDate = useMemo(() => new Date(), []);
  const periodSales = useMemo(() => filterSalesByPeriod(sales, period, referenceDate), [sales, period, referenceDate]);
  const metrics = useMemo(() => getSalesMetrics(periodSales), [periodSales]);
  const paymentTotals = useMemo(() => getPaymentTotals(periodSales), [periodSales]);
  const trend = useMemo(() => getSalesTrend(periodSales, period, referenceDate), [periodSales, period, referenceDate]);
  const periodLabel = periodOptions.find((option) => option.id === period)?.label.toLocaleLowerCase('pt-BR') ?? 'período';

  return (
    <main className="content analytics-content">
      <AppPageTopBar activePage="reports" onNavigate={onNavigate} />
      <div className="title-row analytics-title-row">
        <div><h1>Relatórios</h1><div className="sub">Acompanhe o faturamento e as formas de pagamento.</div></div>
        <div aria-label="Período do relatório" className="period-tabs" role="group">
          {periodOptions.map((option) => (
            <button aria-pressed={period === option.id} className={period === option.id ? 'selected' : ''} key={option.id} onClick={() => setPeriod(option.id)} type="button">{option.label}</button>
          ))}
        </div>
      </div>

      {error ? <div className="analytics-error" role="alert">{error}</div> : loading ? (
        <div className="analytics-loading" role="status">Carregando vendas salvas...</div>
      ) : (
        <>
          <section aria-label={`Indicadores: ${periodLabel}`} className="analytics-stat-grid">
            <StatCard accent="green" label="Faturamento" value={formatMoney(metrics.revenueInCents)} detail={`Total de ${periodLabel}`} />
            <StatCard accent="blue" label="Vendas" value={String(metrics.saleCount)} detail={metrics.saleCount === 1 ? 'Venda no período' : 'Vendas no período'} />
            <StatCard accent="purple" label="Ticket médio" value={formatMoney(metrics.averageTicketInCents)} detail="Faturamento ÷ vendas" />
            <StatCard accent="orange" label="Maior venda" value={formatMoney(metrics.biggestSaleInCents)} detail="Maior total individual" />
          </section>

          {metrics.saleCount === 0 && (
            <div className="analytics-empty-state">
              <b>Nenhuma venda neste período</b>
              <span>Ainda não existem vendas registradas neste período.</span>
            </div>
          )}

          <div className="analytics-report-grid">
            <section aria-labelledby="sales-chart-title" className="analytics-panel">
              <div className="analytics-panel-heading">
                <div><h2 id="sales-chart-title">Faturamento ao longo do período</h2><p>{period === 'today' ? 'Faixas de duas horas' : period === 'week' ? 'Por dia da semana' : 'Por dia do mês'}</p></div>
              </div>
              {metrics.saleCount === 0 ? <div className="analytics-chart-empty">Sem dados para exibir no gráfico.</div> : <SalesTrendChart buckets={trend} periodLabel={periodLabel} />}
            </section>
            <section aria-labelledby="report-payments-title" className="analytics-panel">
              <div className="analytics-panel-heading">
                <div><h2 id="report-payments-title">Formas de pagamento</h2><p>Distribuição do total recebido no período.</p></div>
              </div>
              <PaymentBreakdown showPercentages totalInCents={metrics.revenueInCents} totals={paymentTotals} />
            </section>
          </div>
        </>
      )}
    </main>
  );
}
