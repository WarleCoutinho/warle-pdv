import { SaleCreditFinalizationPendingError } from '../domain/errors';
// Authentication and consumption share one service module, including during Vite hot reload.
export { lookupCustomerCredit } from './saleFinancialStorage';
import { requireOperator } from './operatorAccess';
import { assertCurrentCashSession } from './cashStorage';
import type { SalePayment } from '../types/payment';
import type { Sale, SaleCancellationReason, SaleItem } from '../types/sale';
import type { CartItem } from '../types/product';
import { multiplyMoney, sumMoney } from '../utils/money';
import { calculatePaymentTotals } from '../utils/payments';
import { isCompletedSale } from '../utils/saleStatus';
import { commitCreditRedemptions, releaseCreditReservations, reserveCreditRedemptions, restoreCreditsForCancelledSale, withCustomerCreditLock, assertFinancialRecoveryComplete, assertCreditAuthorization, getSaleResolvedAmount, loadSaleFinancialData } from './saleFinancialStorage';

export { SaleCreditFinalizationPendingError } from '../domain/errors';
export const SALES_STORAGE_KEY = 'raiz-pdv:completed-sales';

export function validateSalesBackup(value: unknown): Sale[] {
  if (!Array.isArray(value) || !value.every(isSale) || (Array.isArray(value) && (new Set(value.map((item: Sale) => item.id)).size !== value.length || new Set(value.map((item: Sale) => item.number)).size !== value.length))) throw new Error('A lista de vendas do backup é inválida.');
  return value;
}

export function listSales(): Sale[] {
  const raw = localStorage.getItem(SALES_STORAGE_KEY);
  if (raw === null) return [];

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('Os dados das vendas salvas estão inválidos.');
  }
  if (!Array.isArray(value) || !value.every(isSale) || (Array.isArray(value) && (new Set(value.map((item: Sale) => item.id)).size !== value.length || new Set(value.map((item: Sale) => item.number)).size !== value.length))) {
    throw new Error('Os dados das vendas salvas estão inválidos.');
  }
  return value as Sale[];
}

export function getSaleById(id: string): Sale | undefined {
  return listSales().find((sale) => sale.id === id);
}

export function clearStoredSales(): void {
  localStorage.removeItem(SALES_STORAGE_KEY);
}

export async function saveCompletedSale(items: CartItem[], totalInCents: number, payments: SalePayment[], cashSessionId: string): Promise<Sale> {
  return withCustomerCreditLock(() => {
    assertFinancialRecoveryComplete();
    requireOperator();
    if (!cashSessionId) throw new Error('Abra um caixa antes de concluir a venda.');
    assertCurrentCashSession(cashSessionId);
    const sales = listSales();
    const number = sales.reduce((max, sale) => Math.max(max, sale.number), 0) + 1;
    if (!Number.isSafeInteger(number)) throw new Error('Não foi possível gerar o número da venda.');

    const sale: Sale = {
      id: createSaleId(),
      number,
      date: new Date().toISOString(),
      cashSessionId,
      status: 'completed',
      items: items.map((item) => ({ ...toSaleItem(item), lineId: createSaleId() })),
      totalInCents,
      payments: payments.map((payment) => ({ ...payment, capturedAt: new Date().toISOString() })),
    };
    if (payments.some((payment) => payment.method === 'customer_credit')) throw new Error('Use a finalização protegida para vendas com crédito do cliente.');
    if (!isSale(sale)) throw new Error('Os dados da venda não passaram na validação.');

    try {
      localStorage.setItem(SALES_STORAGE_KEY, JSON.stringify([...sales, sale]));
    } catch {
      throw new Error('Não foi possível salvar a venda. A venda não foi concluída.');
    }
    notifySalesChanged();
    return sale;
  });
}

export async function saveCompletedSaleWithCustomerCredit(items: CartItem[], totalInCents: number, payments: SalePayment[], cashSessionId: string): Promise<Sale> {
  requireOperator();
  if (!cashSessionId) throw new Error('Abra um caixa antes de concluir a venda.');
  assertCurrentCashSession(cashSessionId);
  const sales = listSales();
  const number = sales.reduce((max, sale) => Math.max(max, sale.number), 0) + 1;
  if (!Number.isSafeInteger(number)) throw new Error('Não foi possível gerar o número da venda.');
  const sale: Sale = { id: createSaleId(), number, date: new Date().toISOString(), cashSessionId, status: 'completed', items: items.map((item) => ({ ...toSaleItem(item), lineId: createSaleId() })), totalInCents, payments: payments.map((payment) => ({ ...payment, capturedAt: new Date().toISOString() })) };
  if (!isSale(sale)) throw new Error('Os dados da venda não passaram na validação.');
  return withCustomerCreditLock(() => {
      assertCurrentCashSession(cashSessionId);
      assertFinancialRecoveryComplete();
      const currentSales = listSales();
      sale.number = currentSales.reduce((max, item) => Math.max(max, item.number), 0) + 1;
      sale.date = new Date().toISOString();
      if (!Number.isSafeInteger(sale.number)) throw new Error('Não foi possível gerar o número da venda.');
      const requested = payments.filter((payment) => payment.method === 'customer_credit').map((payment) => ({ creditId: payment.customerCreditId ?? '', amountInCents: payment.amountInCents }));
      assertCreditAuthorization(requested);
      reserveCreditRedemptions(sale.id, requested);
      try { localStorage.setItem(SALES_STORAGE_KEY, JSON.stringify([...currentSales, sale])); }
      catch {
        try { releaseCreditReservations(sale.id); } catch { throw new Error('A venda não foi gravada e a reserva foi preservada para recuperação. Atualize o sistema antes de tentar novamente.'); }
        throw new Error('Não foi possível salvar a venda; nenhum crédito foi consumido.');
      }
      try { commitCreditRedemptions(sale); }
      catch {
        notifySalesChanged();
        throw new SaleCreditFinalizationPendingError(sale.id);
      }
      notifySalesChanged();
      return sale;
  });
}

export async function cancelSaleAndRestoreCustomerCredit(saleId: string, reason: SaleCancellationReason, note = ''): Promise<Sale> {
  return withCustomerCreditLock(() => {
      assertFinancialRecoveryComplete();
      const original = getSaleById(saleId);
      if (original && isCompletedSale(original)) {
        const data = loadSaleFinancialData();
        const restored = sumMoney(data.creditMovements.filter((item) => item.saleId === saleId && item.type === 'redeemed').map((item) => item.amountInCents));
        if (getSaleResolvedAmount(saleId, data) + restored > original.totalInCents) throw new Error('O cancelamento excederia o total já compensado ao restaurar os créditos. Preserve os registros para conferência.');
      }
      const cancelled = cancelCompletedSale(saleId, reason, note);
      try { restoreCreditsForCancelledSale(cancelled); }
      catch {
        throw new Error('O cancelamento foi gravado, mas a restauração do crédito está pendente de recuperação. Não repita a operação; atualize o sistema. Os registros foram preservados.');
      }
      return cancelled;
  });
}
function cancelCompletedSale(saleId: string, reason: SaleCancellationReason, note = ''): Sale {
  requireOperator();
  if (!['launch_error', 'customer_cancelled', 'payment_error', 'other'].includes(reason)) throw new Error('Selecione um motivo válido para cancelar a venda.');
  if (reason === 'other' && !note.trim()) throw new Error('Descreva o motivo do cancelamento.');
  if (note.length > 300) throw new Error('A observação deve ter no máximo 300 caracteres.');
  const sales = listSales();
  const saleIndex = sales.findIndex((item) => item.id === saleId);
  if (saleIndex < 0) throw new Error('Esta venda não foi encontrada. Atualize o histórico e tente novamente.');
  const sale = sales[saleIndex];
  if (!isCompletedSale(sale)) throw new Error('Esta venda já está cancelada.');
  const cancelledSale: Sale = { ...sale, status: 'cancelled', cancelledAt: new Date().toISOString(), cancellationReason: reason,
    ...(note.trim() ? { cancellationNote: note.trim() } : {}) };
  const updatedSales = [...sales]; updatedSales[saleIndex] = cancelledSale;
  try { localStorage.setItem(SALES_STORAGE_KEY, JSON.stringify(updatedSales)); }
  catch { throw new Error('Não foi possível salvar o cancelamento no armazenamento local.'); }
  notifySalesChanged();
  return cancelledSale;
}

function toSaleItem(item: CartItem): SaleItem {
  return {
    productId: item.product.id,
    productName: item.product.name,
    unitPriceInCents: item.unitPriceInCents,
    quantity: item.quantity,
    subtotalInCents: item.subtotalInCents,
  };
}

function isSale(value: unknown): value is Sale {
  if (typeof value !== 'object' || value === null) return false;
  const sale = value as Record<string, unknown>;
  if (typeof sale.id !== 'string' || !sale.id
    || !Number.isSafeInteger(sale.number) || Number(sale.number) < 1
    || typeof sale.date !== 'string' || !Number.isFinite(Date.parse(sale.date))
    || !Number.isSafeInteger(sale.totalInCents) || Number(sale.totalInCents) < 0
    || !Array.isArray(sale.items) || !sale.items.every(isSaleItem)
    || !Array.isArray(sale.payments) || !sale.payments.every(isSalePayment)
    || (sale.status !== undefined && !['completed', 'cancelled'].includes(String(sale.status)))
    || (sale.cashSessionId !== undefined && (typeof sale.cashSessionId !== 'string' || !sale.cashSessionId))) return false;
  if (sale.status === 'cancelled') {
    if (typeof sale.cancelledAt !== 'string' || !Number.isFinite(Date.parse(sale.cancelledAt))
      || !['launch_error', 'customer_cancelled', 'payment_error', 'other'].includes(String(sale.cancellationReason))
      || (sale.cancellationNote !== undefined && typeof sale.cancellationNote !== 'string')) return false;
  } else if (sale.cancelledAt !== undefined || sale.cancellationReason !== undefined || sale.cancellationNote !== undefined) return false;

  try {
    const lineIds = (sale.items as SaleItem[]).map((item, index) => item.lineId ?? `legacy-line-${index + 1}`);
    if (new Set(lineIds).size !== lineIds.length) return false;
    const itemTotal = sumMoney((sale.items as SaleItem[]).map((item) => item.subtotalInCents));
    const paymentTotal = calculatePaymentTotals(Number(sale.totalInCents), sale.payments as SalePayment[]);
    return itemTotal === sale.totalInCents && paymentTotal.pendingInCents === 0 && paymentTotal.paidInCents === sale.totalInCents;
  } catch {
    return false;
  }
}

function isSaleItem(value: unknown): value is SaleItem {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  if ((item.lineId !== undefined && (typeof item.lineId !== 'string' || !item.lineId)) || typeof item.productId !== 'string' || typeof item.productName !== 'string'
    || !Number.isSafeInteger(item.unitPriceInCents) || Number(item.unitPriceInCents) < 0
    || !Number.isSafeInteger(item.quantity) || Number(item.quantity) < 1
    || !Number.isSafeInteger(item.subtotalInCents) || Number(item.subtotalInCents) < 0) return false;
  try {
    return multiplyMoney(Number(item.unitPriceInCents), Number(item.quantity)) === item.subtotalInCents;
  } catch {
    return false;
  }
}

function isSalePayment(value: unknown): value is SalePayment {
  if (typeof value !== 'object' || value === null) return false;
  const payment = value as Record<string, unknown>;
  if (!['cash', 'pix', 'debit', 'credit', 'customer_credit'].includes(String(payment.method))
    || !Number.isSafeInteger(payment.amountInCents) || Number(payment.amountInCents) <= 0
    || (payment.capturedAt !== undefined && (typeof payment.capturedAt !== 'string' || !Number.isFinite(Date.parse(payment.capturedAt))))) return false;
  if (payment.method === 'customer_credit') return typeof payment.customerCreditId === 'string' && !!payment.customerCreditId && payment.amountReceivedInCents === undefined && payment.changeInCents === undefined;
  if (payment.customerCreditId !== undefined) return false;
  if (payment.method !== 'cash') return payment.amountReceivedInCents === undefined && payment.changeInCents === undefined;
  return Number.isSafeInteger(payment.amountReceivedInCents)
    && Number(payment.amountReceivedInCents) >= Number(payment.amountInCents)
    && Number.isSafeInteger(payment.changeInCents)
    && Number(payment.changeInCents) === Number(payment.amountReceivedInCents) - Number(payment.amountInCents);
}

function createSaleId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function notifySalesChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('raiz-pdv:data-changed'));
}
