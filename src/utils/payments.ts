import type { SalePayment } from '../types/payment';
import { sumMoney } from './money';

export function calculatePaymentTotals(totalInCents: number, payments: SalePayment[]) {
  const paidInCents = sumMoney(payments.map((payment) => payment.amountInCents));
  return {
    paidInCents,
    pendingInCents: Math.max(0, totalInCents - paidInCents),
  };
}

export function createSalePayment(
  method: SalePayment['method'],
  enteredInCents: number,
  pendingInCents: number,
): SalePayment | null {
  if (!Number.isSafeInteger(enteredInCents) || enteredInCents <= 0 || pendingInCents <= 0) return null;

  if (method !== 'cash') {
    if (enteredInCents > pendingInCents) return null;
    return { method, amountInCents: enteredInCents };
  }

  const amountInCents = Math.min(enteredInCents, pendingInCents);
  return {
    method,
    amountInCents,
    amountReceivedInCents: enteredInCents,
    changeInCents: enteredInCents - amountInCents,
  };
}

export function formatMoneyInput(amountInCents: number): string {
  const whole = Math.floor(amountInCents / 100);
  const cents = amountInCents % 100;
  return `${whole},${String(cents).padStart(2, '0')}`;
}

