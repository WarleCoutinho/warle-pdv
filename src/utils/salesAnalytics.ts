import type { PaymentMethod } from '../types/payment';
import type { Sale } from '../types/sale';
import { sumMoney } from './money';

export type SalesPeriod = 'today' | 'week' | 'month';

export type SalesMetrics = {
  sales: Sale[];
  revenueInCents: number;
  saleCount: number;
  averageTicketInCents: number;
  biggestSaleInCents: number;
  latestSale: Sale | null;
};

export type SalesTrendBucket = {
  label: string;
  revenueInCents: number;
};

export function sortSalesMostRecent(sales: Sale[]): Sale[] {
  return [...sales].sort((left, right) => Date.parse(right.date) - Date.parse(left.date));
}

export function filterSalesByPeriod(sales: Sale[], period: SalesPeriod, referenceDate: Date = new Date()): Sale[] {
  return sales.filter((sale) => {
    const saleDate = new Date(sale.date);
    if (period === 'today') return isSameLocalDay(saleDate, referenceDate);
    if (period === 'month') {
      return saleDate.getFullYear() === referenceDate.getFullYear()
        && saleDate.getMonth() === referenceDate.getMonth();
    }

    const weekStart = startOfWeek(referenceDate);
    const nextWeekStart = new Date(weekStart);
    nextWeekStart.setDate(nextWeekStart.getDate() + 7);
    return saleDate >= weekStart && saleDate < nextWeekStart;
  });
}

export function getSalesMetrics(sales: Sale[]): SalesMetrics {
  const revenueInCents = sumMoney(sales.map((sale) => sale.totalInCents));
  const saleCount = sales.length;
  const sortedSales = sortSalesMostRecent(sales);
  return {
    sales: sortedSales,
    revenueInCents,
    saleCount,
    averageTicketInCents: saleCount === 0 ? 0 : Math.round(revenueInCents / saleCount),
    biggestSaleInCents: sales.reduce((biggest, sale) => Math.max(biggest, sale.totalInCents), 0),
    latestSale: sortedSales[0] ?? null,
  };
}

export function getPaymentTotals(sales: Sale[]): Record<PaymentMethod, number> {
  const totals: Record<PaymentMethod, number> = { cash: 0, pix: 0, debit: 0, credit: 0 };
  for (const sale of sales) {
    for (const payment of sale.payments) {
      totals[payment.method] = sumMoney([totals[payment.method], payment.amountInCents]);
    }
  }
  return totals;
}

export function getSalesTrend(sales: Sale[], period: SalesPeriod, referenceDate: Date = new Date()): SalesTrendBucket[] {
  const buckets = createTrendBuckets(period, referenceDate);
  for (const sale of sales) {
    const saleDate = new Date(sale.date);
    const index = period === 'today'
      ? Math.floor(saleDate.getHours() / 2)
      : period === 'week'
        ? (saleDate.getDay() + 6) % 7
        : saleDate.getDate() - 1;
    const bucket = buckets[index];
    if (bucket) bucket.revenueInCents = sumMoney([bucket.revenueInCents, sale.totalInCents]);
  }
  return buckets;
}

function createTrendBuckets(period: SalesPeriod, referenceDate: Date): SalesTrendBucket[] {
  if (period === 'today') {
    return Array.from({ length: 12 }, (_, index) => ({
      label: `${String(index * 2).padStart(2, '0')}h`,
      revenueInCents: 0,
    }));
  }
  if (period === 'week') {
    return ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']
      .map((label) => ({ label, revenueInCents: 0 }));
  }

  const daysInMonth = new Date(referenceDate.getFullYear(), referenceDate.getMonth() + 1, 0).getDate();
  return Array.from({ length: daysInMonth }, (_, index) => ({
    label: String(index + 1),
    revenueInCents: 0,
  }));
}

function startOfWeek(date: Date): Date {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return start;
}

function isSameLocalDay(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}
