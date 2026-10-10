import type { FinancialRefund, SaleFinancialData } from '../types/customerCredit';
import { emptySaleFinancialData } from '../types/customerCredit';
import type { SaleTenderMethod } from '../types/payment';
import type { Sale } from '../types/sale';
import { sumMoney } from './money';
import { isCompletedSale } from './saleStatus';

export type SalesPeriod = 'today' | 'week' | 'month';

export type SalesMetrics = {
  sales: Sale[];
  revenueInCents: number;
  netSalesInCents: number;
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
  return getCompletedSales(sales).sort((left, right) => Date.parse(right.date) - Date.parse(left.date));
}

export function getCompletedSales(sales: Sale[]): Sale[] {
  return sales.filter(isCompletedSale);
}

export function filterSalesByPeriod(sales: Sale[], period: SalesPeriod, referenceDate: Date = new Date()): Sale[] {
  return filterRecordedSalesByPeriod(sales, period, referenceDate).filter(isCompletedSale);
}

export function filterRecordedSalesByPeriod(sales: Sale[], period: SalesPeriod, referenceDate: Date = new Date()): Sale[] {
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

export function getSalesMetrics(sales: Sale[], financial: SaleFinancialData = emptySaleFinancialData()): SalesMetrics {
  const completedSales = getCompletedSales(sales);
  const revenueInCents = sumMoney(completedSales.map((sale) => sale.totalInCents));
  const netSalesInCents = sumMoney(completedSales.map((sale) => getNetSaleAmount(sale, financial)));
  const saleCount = completedSales.length;
  const sortedSales = sortSalesMostRecent(completedSales);
  return {
    sales: sortedSales,
    revenueInCents,
    netSalesInCents,
    saleCount,
    averageTicketInCents: saleCount === 0 ? 0 : Math.round(revenueInCents / saleCount),
    biggestSaleInCents: completedSales.reduce((biggest, sale) => Math.max(biggest, sale.totalInCents), 0),
    latestSale: sortedSales[0] ?? null,
  };
}

export function getPaymentTotals(sales: Sale[], includeCancelled = false): Record<SaleTenderMethod, number> {
  const totals: Record<SaleTenderMethod, number> = { cash: 0, pix: 0, debit: 0, credit: 0, customer_credit: 0 };
  for (const sale of includeCancelled ? sales : getCompletedSales(sales)) {
    for (const payment of sale.payments) {
      totals[payment.method] = sumMoney([totals[payment.method], payment.amountInCents]);
    }
  }
  return totals;
}

export function getSalesTrend(sales: Sale[], period: SalesPeriod, referenceDate: Date = new Date()): SalesTrendBucket[] {
  const buckets = createTrendBuckets(period, referenceDate);
  for (const sale of filterSalesByPeriod(sales, period, referenceDate)) {
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

/** Sales stay on their original date; returns adjust that sale, never its receipt. */
export function getNetSaleAmount(sale: Sale, financial: SaleFinancialData): number {
  if (!isCompletedSale(sale)) return 0;
  const returned = sumMoney(financial.returns.filter((entry) => entry.saleId === sale.id).map((entry) => entry.amountInCents));
  return Math.max(0, sale.totalInCents - returned);
}

export function getFinancialPeriodSummary(financial: SaleFinancialData, period: SalesPeriod, referenceDate: Date = new Date()) {
  const inPeriod = (date: string) => {
    const value = new Date(date);
    if (period === 'today') return isSameLocalDay(value, referenceDate);
    if (period === 'month') return value.getFullYear() === referenceDate.getFullYear() && value.getMonth() === referenceDate.getMonth();
    const start = startOfWeek(referenceDate), end = new Date(start); end.setDate(end.getDate() + 7);
    return value >= start && value < end;
  };
  return {
    refundedInCents: sumMoney(financial.refunds.filter((entry) => entry.method !== 'customer_credit' && entry.status === 'completed' && inPeriod(entry.completedAt!)).map((entry) => entry.amountInCents)),
    pendingInCents: sumMoney(financial.refunds.filter((entry) => entry.status === 'pending' && inPeriod(entry.createdAt)).map((entry) => entry.amountInCents)),
    issuedCreditInCents: sumMoney(financial.credits.filter((entry) => inPeriod(entry.issuedAt)).map((entry) => entry.originalAmountInCents)),
  };
}

/** Financial receipts include recorded payments of cancelled sales until actually refunded. */
export function getReceivedSummary(sales: Sale[], refunds: FinancialRefund[]) {
  const completed = getCompletedSales(sales);
  const receivedInCents = sumMoney(sales.flatMap((sale) => sale.payments.filter((payment) => payment.method !== 'customer_credit').map((payment) => payment.amountInCents)));
  const refundedInCents = sumMoney(refunds.filter((refund) => refund.status === 'completed' && refund.method !== 'customer_credit').map((refund) => refund.amountInCents));
  const netReceivedInCents = receivedInCents - refundedInCents;
  if (!Number.isSafeInteger(netReceivedInCents)) throw new Error('O total recebido é inválido.');
  return { saleCount: completed.length, cancelledCount: sales.length - completed.length, revenueInCents: sumMoney(completed.map((sale) => sale.totalInCents)), receivedInCents, refundedInCents, netReceivedInCents };
}

export function getPeriodReceivedSummary(sales: Sale[], financial: SaleFinancialData, period: SalesPeriod, referenceDate: Date) {
  const recorded = filterRecordedSalesByPeriod(sales, period, referenceDate);
  const refunds = financial.refunds.filter((refund) => refund.status === 'completed' && refund.completedAt && filterRecordedSalesByPeriod([{ date: refund.completedAt } as Sale], period, referenceDate).length > 0);
  return getReceivedSummary(recorded, refunds);
}
