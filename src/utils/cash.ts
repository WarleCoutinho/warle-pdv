import type { CashMovement, CashSession, CashSummary } from '../types/cash';
import type { Sale } from '../types/sale';
import { sumMoney } from './money';

export function getCashSummary(session: CashSession, movements: CashMovement[], sales: Sale[]): CashSummary {
  const sessionSales = sales.filter((sale) => sale.cashSessionId === session.id);
  const salesInCents = sumMoney(sessionSales.flatMap((sale) => sale.payments
    .filter((payment) => payment.method === 'cash')
    .map((payment) => payment.amountInCents)));
  const sessionMovements = movements.filter((movement) => movement.cashSessionId === session.id);
  const suppliesInCents = sumMoney(sessionMovements.filter((movement) => movement.type === 'supply').map((movement) => movement.amountInCents));
  const withdrawalsInCents = sumMoney(sessionMovements.filter((movement) => movement.type === 'withdrawal').map((movement) => movement.amountInCents));
  const expectedInCents = session.expectedAmountInCents ?? (
    session.openingAmountInCents + salesInCents + suppliesInCents - withdrawalsInCents
  );
  if (!Number.isSafeInteger(expectedInCents) || expectedInCents < 0) throw new RangeError('O saldo esperado do caixa é inválido.');
  return { openingInCents: session.openingAmountInCents, salesInCents, suppliesInCents, withdrawalsInCents, expectedInCents };
}

export function getSessionCashSales(session: CashSession, sales: Sale[]): Sale[] {
  return sales.filter((sale) => sale.cashSessionId === session.id
    && sale.payments.some((payment) => payment.method === 'cash' && payment.amountInCents > 0));
}
