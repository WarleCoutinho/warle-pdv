import { formatMoney } from '../utils/money';
import type { SalesTrendBucket } from '../utils/salesAnalytics';

type SalesTrendChartProps = {
  buckets: SalesTrendBucket[];
  periodLabel: string;
};

const chartHeight = 230;
const plotTop = 18;
const plotBottom = 190;

export function SalesTrendChart({ buckets, periodLabel }: SalesTrendChartProps) {
  const step = 44;
  const width = Math.max(620, buckets.length * step + 28);
  const plotHeight = plotBottom - plotTop;
  const maxRevenue = Math.max(...buckets.map((bucket) => bucket.revenueInCents), 0);

  return (
    <div className="sales-chart-scroll">
      <svg aria-label={`Faturamento por ${periodLabel}`} className="sales-trend-chart" role="img" viewBox={`0 0 ${width} ${chartHeight}`}>
        <line className="sales-chart-baseline" x1="12" x2={width - 12} y1={plotBottom} y2={plotBottom} />
        {buckets.map((bucket, index) => {
          const barWidth = Math.min(26, step - 14);
          const barHeight = maxRevenue === 0 ? 0 : Math.max(2, (bucket.revenueInCents / maxRevenue) * plotHeight);
          const x = index * step + (step - barWidth) / 2 + 12;
          const y = plotBottom - barHeight;
          return (
            <g key={`${bucket.label}-${index}`}>
              <rect className="sales-chart-bar" height={barHeight} rx="5" width={barWidth} x={x} y={y}>
                <title>{bucket.label}: {formatMoney(bucket.revenueInCents)}</title>
              </rect>
              <text className="sales-chart-label" textAnchor="middle" x={x + barWidth / 2} y={plotBottom + 22}>{bucket.label}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
