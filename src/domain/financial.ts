import type { Sale } from '../types/sale';
import type { SaleFinancialData } from '../types/customerCredit';
import type { PaymentMethod } from '../types/payment';
import { sumMoney } from '../utils/money';
import { getSaleStatus } from '../utils/saleStatus';

export function getSaleEligibleAmount(sale: Sale, data: SaleFinancialData): number {
  if (getSaleStatus(sale) === 'cancelled') return sale.totalInCents;
  return sumMoney(data.returns.filter((item) => item.saleId === sale.id).map((item) => item.amountInCents));
}

export function getSaleResolvedAmount(saleId: string, data: SaleFinancialData): number {
  return sumMoney([...data.refunds.filter((refund) => refund.saleId === saleId && refund.status !== 'failed').map((refund) => refund.amountInCents), ...data.creditMovements.filter((movement) => movement.saleId === saleId && movement.type === 'restored').map((movement) => movement.amountInCents)]);
}

export function getSaleUnresolvedAmount(sale: Sale, data: SaleFinancialData): number {
  return Math.max(0, getSaleEligibleAmount(sale, data) - getSaleResolvedAmount(sale.id, data));
}

export function getSessionRefundTotals(sessionId: string, data: SaleFinancialData): Record<PaymentMethod, number> {
  const totals: Record<PaymentMethod, number> = { cash: 0, pix: 0, debit: 0, credit: 0 };
  for (const refund of data.refunds) {
    if (refund.cashSessionId !== sessionId || refund.status !== 'completed' || refund.method === 'customer_credit') continue;
    totals[refund.method] = sumMoney([totals[refund.method], refund.amountInCents]);
  }
  return totals;
}

export function getCustomerCreditReceivedBySession(sessionId: string, sales: Sale[]): number {
  return sumMoney(sales.filter((sale) => sale.cashSessionId === sessionId)
    .flatMap((sale) => sale.payments.filter((payment) => payment.method === 'customer_credit').map((payment) => payment.amountInCents)));
}
