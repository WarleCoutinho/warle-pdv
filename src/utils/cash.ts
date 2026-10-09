import type { CashMovement, CashSession, CashSummary, CashReconciliation } from '../types/cash';
import type { PaymentMethod } from '../types/payment';
import type { Sale } from '../types/sale';
import { getReceivedSummary } from './salesAnalytics';
import { sumMoney } from './money';
import { getCustomerCreditReceivedBySession, getSessionRefundTotals, loadSaleFinancialData } from '../services/saleFinancialStorage';

export type CashPaymentTotals = Record<PaymentMethod, number>;
export type CashReconciliationDraft = {
  paymentTotalsInCents: CashPaymentTotals;
  refundTotalsInCents: CashPaymentTotals;
  customerCreditConsumedInCents: number;
  expectedByMethodInCents: CashPaymentTotals;
  totalNetSalesInCents: number;
  netReceivedInCents: number;
  saleCount: number;
  cancelledCount: number;
  cashSummary: CashSummary;
  sourceFingerprint: string;
};
export const paymentMethods: PaymentMethod[] = ['cash', 'pix', 'debit', 'credit'];

/** O valor aplicado à venda não inclui o troco; crédito interno não é novo recebimento da modalidade. */
export function getSessionPaymentTotals(session: CashSession, sales: Sale[]): CashPaymentTotals {
  const totals: CashPaymentTotals = { cash: 0, pix: 0, debit: 0, credit: 0 };
  for (const sale of sales) {
    if (sale.cashSessionId !== session.id) continue;
    for (const payment of sale.payments) {
      if (payment.method === 'customer_credit') {
        if (!Number.isSafeInteger(payment.amountInCents) || payment.amountInCents <= 0 || !payment.customerCreditId) throw new Error('Há pagamentos por crédito do cliente inválidos.');
        continue;
      }
      if (!paymentMethods.includes(payment.method) || !Number.isSafeInteger(payment.amountInCents) || payment.amountInCents < 0) throw new Error('Há pagamentos inválidos nas vendas desta sessão.');
      totals[payment.method] = sumMoney([totals[payment.method], payment.amountInCents]);
    }
  }
  return totals;
}

export function getCashSummary(session: CashSession, movements: CashMovement[], sales: Sale[]): CashSummary {
  const paymentTotals = getSessionPaymentTotals(session, sales);
  const sessionMovements = movements.filter((movement) => movement.cashSessionId === session.id);
  const refundsInCents = getSessionRefundTotals(session.id).cash;
  const suppliesInCents = sumMoney(sessionMovements.filter((movement) => movement.type === 'supply').map((movement) => movement.amountInCents));
  const withdrawalsInCents = sumMoney(sessionMovements.filter((movement) => movement.type === 'withdrawal').map((movement) => movement.amountInCents));
  const grossExpected = sumMoney([session.openingAmountInCents, paymentTotals.cash, suppliesInCents]);
  const outflows = sumMoney([withdrawalsInCents, refundsInCents]);
  const expectedInCents = session.expectedAmountInCents ?? grossExpected - outflows;
  if (!Number.isSafeInteger(expectedInCents) || expectedInCents < 0) throw new RangeError('O saldo esperado do caixa é inválido.');
  return { openingInCents: session.openingAmountInCents, salesInCents: paymentTotals.cash, suppliesInCents, withdrawalsInCents, refundsInCents, expectedInCents };
}

export function getCashReconciliationDraft(session: CashSession, movements: CashMovement[], sales: Sale[]): CashReconciliationDraft {
  const paymentTotalsInCents = getSessionPaymentTotals(session, sales);
  const financial = loadSaleFinancialData();
  const refundTotalsInCents = getSessionRefundTotals(session.id, financial);
  const customerCreditConsumedInCents = getCustomerCreditReceivedBySession(session.id, sales);
  const cashSummary = getCashSummary({ ...session, expectedAmountInCents: undefined }, movements, sales);
  const expectedByMethodInCents: CashPaymentTotals = {
    cash: cashSummary.expectedInCents,
    pix: paymentTotalsInCents.pix - refundTotalsInCents.pix,
    debit: paymentTotalsInCents.debit - refundTotalsInCents.debit,
    credit: paymentTotalsInCents.credit - refundTotalsInCents.credit,
  };
  const received = getReceivedSummary(sales.filter((sale) => sale.cashSessionId === session.id), financial.refunds.filter((refund) => refund.cashSessionId === session.id));
  const totalNetSalesInCents = received.revenueInCents;
  const sourceFingerprint = JSON.stringify({
    session: { id: session.id, status: session.status, openedAt: session.openedAt, openingAmountInCents: session.openingAmountInCents },
    movements: movements.filter((item) => item.cashSessionId === session.id).map(({ id, type, amountInCents, description, createdAt }) => ({ id, type, amountInCents, description, createdAt })).sort((a, b) => a.id.localeCompare(b.id)),
    financial: { refunds: financial.refunds.filter((item) => item.cashSessionId === session.id), returns: financial.returns.filter((item) => sales.some((sale) => sale.id === item.saleId && sale.cashSessionId === session.id)) },
    sales: sales.filter((sale) => sale.cashSessionId === session.id).map((sale) => ({ id: sale.id, number: sale.number, date: sale.date, status: sale.status ?? 'completed', totalInCents: sale.totalInCents, payments: sale.payments })).sort((a, b) => a.id.localeCompare(b.id)),
  });
  return { paymentTotalsInCents, refundTotalsInCents, customerCreditConsumedInCents, expectedByMethodInCents, totalNetSalesInCents, netReceivedInCents: received.netReceivedInCents, saleCount: received.saleCount, cancelledCount: received.cancelledCount, cashSummary, sourceFingerprint };
}

export function createCashReconciliation(draft: CashReconciliationDraft, countedInCents: CashPaymentTotals): CashReconciliation {
  const methods = {} as CashReconciliation['methods'];
  for (const method of paymentMethods) {
    const counted = countedInCents?.[method], expected = draft.expectedByMethodInCents[method];
    if (!Number.isSafeInteger(counted) || counted < 0) throw new Error('Informe um valor conferido válido para cada modalidade.');
    const difference = counted - expected;
    if (!Number.isSafeInteger(difference)) throw new Error('Não foi possível calcular uma das diferenças.');
    methods[method] = { expectedInCents: expected, countedInCents: counted, differenceInCents: difference };
  }
  return { paymentTotalsInCents: { ...draft.paymentTotalsInCents }, refundTotalsInCents: { ...draft.refundTotalsInCents }, customerCreditConsumedInCents: draft.customerCreditConsumedInCents, methods, totalNetSalesInCents: draft.totalNetSalesInCents, summaryVersion: 2, netReceivedInCents: draft.netReceivedInCents, saleCount: draft.saleCount, cancelledCount: draft.cancelledCount, cashSummary: { ...draft.cashSummary } };
}

export function getSessionCashSales(session: CashSession, sales: Sale[]): Sale[] {
  return sales.filter((sale) => sale.cashSessionId === session.id && sale.payments.some((payment) => payment.method === 'cash' && payment.amountInCents > 0));
}