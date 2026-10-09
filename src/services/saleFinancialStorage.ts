import type { PaymentMethod } from '../types/payment';
import type { Sale } from '../types/sale';
import { requireCashOwner, requireOperator } from './operatorAccess';
import { getOpenCashSession, loadCashData } from './cashStorage';
import { listSales } from './saleStorage';
import { getCashSummary } from '../utils/cash';
import { emptySaleFinancialData, type CreditReservation, type CustomerCredit, type CustomerCreditMovement, type FinancialRefund, type MerchandiseReturn, type SaleFinancialData } from '../types/customerCredit';
import { multiplyMoney, sumMoney } from '../utils/money';
import { getSaleStatus } from '../utils/saleStatus';
export async function withCustomerCreditLock<T>(operation: () => Promise<T> | T): Promise<T> {
  if (typeof navigator === 'undefined' || !navigator.locks) throw new Error('Este navegador não oferece bloqueio seguro entre abas; o uso de crédito foi impedido para evitar duplicidade.');
  return navigator.locks.request('raiz-pdv:customer-credit-ledger', { mode: 'exclusive' }, operation);
}

export const FINANCIAL_STORAGE_KEY = 'raiz-pdv:sale-financial-data';

export function loadSaleFinancialData(): SaleFinancialData {
  const raw = localStorage.getItem(FINANCIAL_STORAGE_KEY);
  if (raw === null) return emptySaleFinancialData();
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('Os registros financeiros locais estão inválidos.'); }
  if (!isSaleFinancialData(value)) throw new Error('Os registros financeiros locais estão inválidos.');
  return value;
}

export function validateSaleFinancialBackup(value: unknown): SaleFinancialData {
  if (!isSaleFinancialData(value)) throw new Error('Os registros de devoluções e créditos do backup são inválidos.');
  return value;
}

export function clearSaleFinancialData(): void { localStorage.removeItem(FINANCIAL_STORAGE_KEY); }

export function getSaleEligibleAmount(sale: Sale, data = loadSaleFinancialData()): number {
  if (getSaleStatus(sale) === 'cancelled') return sale.totalInCents;
  return sumMoney(data.returns.filter((item) => item.saleId === sale.id).map((item) => item.amountInCents));
}

export function getSaleResolvedAmount(saleId: string, data = loadSaleFinancialData()): number {
  return sumMoney([...data.refunds.filter((refund) => refund.saleId === saleId && refund.status !== 'failed').map((refund) => refund.amountInCents), ...data.creditMovements.filter((movement) => movement.saleId === saleId && movement.type === 'restored').map((movement) => movement.amountInCents)]);
}

export function getSaleUnresolvedAmount(sale: Sale, data = loadSaleFinancialData()): number {
  return Math.max(0, getSaleEligibleAmount(sale, data) - getSaleResolvedAmount(sale.id, data));
}

export function getSessionRefundTotals(sessionId: string, data = loadSaleFinancialData()): Record<PaymentMethod, number> {
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

export function recordMerchandiseReturn(sale: Sale, quantities: Record<string, number>, cashSessionId?: string): SaleFinancialData {
  const data = loadSaleFinancialData();
  if (getSaleStatus(sale) === 'cancelled') throw new Error('A venda cancelada já permite apuração pelo valor integral; não registre outra devolução parcial nela.');
  const prior = data.returns.filter((item) => item.saleId === sale.id);
  const returnedByItem = new Map<string, number>();
  for (const returned of prior) for (const line of returned.items) returnedByItem.set(line.productId, (returnedByItem.get(line.productId) ?? 0) + line.quantity);
  const items: MerchandiseReturn['items'] = [];
  for (const item of sale.items) {
    const quantity = quantities[item.productId] ?? 0;
    if (!Number.isSafeInteger(quantity) || quantity < 0) throw new Error('Informe quantidades inteiras válidas para a devolução.');
    const alreadyReturned = returnedByItem.get(item.productId) ?? 0;
    if (alreadyReturned + quantity > item.quantity) throw new Error(`A quantidade devolvida de ${item.productName} excede a quantidade da venda.`);
    if (quantity > 0) items.push({ productId: item.productId, productName: item.productName, quantity, amountInCents: multiplyMoney(item.unitPriceInCents, quantity) });
  }
  if (items.length === 0) throw new Error('Selecione ao menos um item para registrar a devolução.');
  const returnedAmount = sumMoney(items.map((item) => item.amountInCents));
  const entry: MerchandiseReturn = { id: createId(), saleId: sale.id, saleNumber: sale.number, createdAt: new Date().toISOString(), ...(cashSessionId ? { cashSessionId } : {}), items, amountInCents: returnedAmount };
  const next = { ...data, returns: [...data.returns, entry] };
  save(next);
  return next;
}

export async function settleSaleBalance(sale: Sale, input: {
  amounts: Record<PaymentMethod | 'customer_credit', number>;
  statuses?: Partial<Record<PaymentMethod, 'completed' | 'pending'>>;
  cashSessionId?: string;
}): Promise<{ data: SaleFinancialData; issuedCredits: Array<{ credit: CustomerCredit; authCode: string }> }> {
  const data = loadSaleFinancialData();
  const eligible = getSaleEligibleAmount(sale, data);
  const remaining = eligible - getSaleResolvedAmount(sale.id, data);
  const methods: Array<PaymentMethod | 'customer_credit'> = ['cash', 'pix', 'debit', 'credit', 'customer_credit'];
  for (const method of methods) {
    const amount = input.amounts[method] ?? 0;
    if (!Number.isSafeInteger(amount) || amount < 0) throw new Error('Informe valores de resolução não negativos e em centavos inteiros.');
    if (method === 'cash' && amount > 0) assertRefundCashSession(input.cashSessionId, input.statuses?.cash === 'pending' ? 0 : amount);
  }
  const total = sumMoney(methods.map((method) => input.amounts[method] ?? 0));
  if (total <= 0 || total > remaining) throw new Error('A resolução excede o saldo elegível da venda ou não contém valor válido.');

  const issuedCredits: Array<{ credit: CustomerCredit; authCode: string }> = [];
  const now = new Date().toISOString();
  const refunds = [...data.refunds];
  const credits = [...data.credits];
  const creditMovements = [...data.creditMovements];
  for (const method of methods) {
    const amount = input.amounts[method] ?? 0;
    if (amount === 0) continue;
    const status = method === 'customer_credit' ? 'completed' : (input.statuses?.[method] ?? 'completed');
    const refund: FinancialRefund = { id: createId(), saleId: sale.id, saleNumber: sale.number, method, amountInCents: amount, status, createdAt: now,
      ...(status === 'completed' ? { completedAt: now } : {}), ...(method === 'cash' || method === 'pix' || method === 'debit' || method === 'credit' ? { cashSessionId: input.cashSessionId } : {}) };
    if (method === 'customer_credit') {
      const authCode = createAuthCode();
      const credit: CustomerCredit = { id: createId(), receiptNumber: createReceiptNumber(), authCodeHash: await hashAuthCode(authCode), originalSaleId: sale.id, originalSaleNumber: sale.number, issuedAt: now, originalAmountInCents: amount, balanceInCents: amount, status: 'available', ...(input.cashSessionId ? { issuingCashSessionId: input.cashSessionId } : {}) };
      refund.creditId = credit.id; credits.push(credit); creditMovements.push({ id: createId(), creditId: credit.id, type: 'issued', amountInCents: amount, createdAt: now, saleId: sale.id, refundId: refund.id, ...(input.cashSessionId ? { cashSessionId: input.cashSessionId } : {}) }); issuedCredits.push({ credit, authCode });
    }
    refunds.push(refund);
  }
  const next = { ...data, refunds, credits, creditMovements };
  save(next);
  return { data: next, issuedCredits };
}

export async function lookupCustomerCredit(query: string, authCode?: string): Promise<CustomerCredit | undefined> {
  const normalized = query.trim().toLocaleUpperCase('pt-BR');
  if (!normalized) return undefined;
  const data = loadSaleFinancialData();
  const candidates = data.credits.filter((item) => item.receiptNumber.toLocaleUpperCase('pt-BR') === normalized || String(item.originalSaleNumber) === normalized.replace(/^#?0*/, ''));
  const hash = authCode ? await hashAuthCode(authCode.trim()) : undefined;
  const credit = hash ? candidates.find((item) => item.authCodeHash === hash) : candidates[0];
  if (!credit) return undefined;
  const reserved = sumMoney(data.creditReservations.filter((item) => item.creditId === credit.id).map((item) => item.amountInCents));
  return { ...credit, balanceInCents: Math.max(0, credit.balanceInCents - reserved) };
}

export function searchCustomerCredits(query: string): CustomerCredit[] {
  const normalized = query.trim().toLocaleUpperCase('pt-BR');
  if (!normalized) return [];
  return loadSaleFinancialData().credits.filter((credit) => credit.receiptNumber.toLocaleUpperCase('pt-BR').includes(normalized) || String(credit.originalSaleNumber) === normalized.replace(/^#?0*/, '')).map(({ authCodeHash: _secret, ...credit }) => credit as CustomerCredit);
}

export function updatePendingRefund(refundId: string, status: 'completed' | 'failed', cashSessionId?: string): SaleFinancialData {
  const data = loadSaleFinancialData();
  const refund = data.refunds.find((item) => item.id === refundId);
  if (!refund || refund.status !== 'pending') throw new Error('Este reembolso não está pendente ou já foi atualizado.');
  if (status === 'completed' && refund.method === 'cash') assertRefundCashSession(cashSessionId, refund.amountInCents);
  const refunds = data.refunds.map((item) => item.id === refundId ? { ...item, status, ...(status === 'completed' ? { completedAt: new Date().toISOString(), ...(cashSessionId ? { cashSessionId } : {}) } : {}) } : item);
  const next = { ...data, refunds }; save(next); return next;
}

export function reserveCreditRedemptions(saleId: string, requested: Array<{ creditId: string; amountInCents: number }>): SaleFinancialData {
  const data = loadSaleFinancialData();
  const combined = new Map<string, number>();
  for (const item of requested) combined.set(item.creditId, sumMoney([combined.get(item.creditId) ?? 0, item.amountInCents]));
  for (const [creditId, amount] of combined) {
    const credit = data.credits.find((item) => item.id === creditId);
    const reserved = sumMoney(data.creditReservations.filter((item) => item.creditId === creditId).map((item) => item.amountInCents));
    if (!credit || !Number.isSafeInteger(amount) || amount <= 0 || amount > credit.balanceInCents - reserved) throw new Error('O crédito está indisponível ou seu saldo mudou. Consulte o comprovante e tente novamente.');
  }
  const reservations = [...data.creditReservations];
  for (const [creditId, amountInCents] of combined) reservations.push({ id: createId(), creditId, saleId, amountInCents, createdAt: new Date().toISOString() });
  const next = { ...data, creditReservations: reservations }; save(next); return next;
}

export function commitCreditRedemptions(sale: Sale): SaleFinancialData {
  const data = loadSaleFinancialData();
  const reservations = data.creditReservations.filter((item) => item.saleId === sale.id);
  if (reservations.length === 0) return data;
  const movements = [...data.creditMovements];
  const credits = data.credits.map((credit) => {
    const amount = sumMoney(reservations.filter((item) => item.creditId === credit.id).map((item) => item.amountInCents));
    if (!amount) return credit;
    if (amount > credit.balanceInCents) throw new Error('O saldo do crédito mudou durante a finalização.');
    movements.push({ id: createId(), creditId: credit.id, type: 'redeemed', amountInCents: amount, createdAt: new Date().toISOString(), saleId: sale.id, cashSessionId: sale.cashSessionId });
    const balanceInCents = credit.balanceInCents - amount;
    return { ...credit, balanceInCents, status: balanceInCents === 0 ? 'redeemed' as const : 'partial' as const };
  });
  const next = { ...data, credits, creditMovements: movements, creditReservations: data.creditReservations.filter((item) => item.saleId !== sale.id) };
  save(next); return next;
}

export async function recoverCreditReservations(sales: Sale[]): Promise<void> {
  if (!loadSaleFinancialData().creditReservations.length) return;
  await withCustomerCreditLock(() => {
    const reservations = loadSaleFinancialData().creditReservations;
    for (const saleId of [...new Set(reservations.map((item) => item.saleId))]) {
      const sale = sales.find((item) => item.id === saleId);
      if (!sale || getSaleStatus(sale) === 'cancelled') { releaseCreditReservations(saleId); continue; }
      const reserved = reservations.filter((item) => item.saleId === saleId);
      for (const entry of reserved) {
        const tendered = sumMoney(sale.payments.filter((item) => item.method === 'customer_credit' && item.customerCreditId === entry.creditId).map((item) => item.amountInCents));
        const totalReserved = sumMoney(reserved.filter((item) => item.creditId === entry.creditId).map((item) => item.amountInCents));
        if (tendered !== totalReserved) throw new Error('A reserva de crédito não corresponde à venda gravada; ela foi mantida bloqueada para auditoria.');
      }
      commitCreditRedemptions(sale);
    }
  });
}
export function releaseCreditReservations(saleId: string): void {
  const data = loadSaleFinancialData();
  const next = { ...data, creditReservations: data.creditReservations.filter((item) => item.saleId !== saleId) };
  save(next);
}

export function restoreCreditsForCancelledSale(sale: Sale): SaleFinancialData {
  const data = loadSaleFinancialData();
  if (getSaleStatus(sale) !== 'cancelled') throw new Error('Somente uma venda cancelada permite restaurar crédito.');
  const prior = data.creditMovements.filter((item) => item.type === 'restored' && item.saleId === sale.id);
  if (prior.length) return data;
  const redemptions = data.creditMovements.filter((item) => item.type === 'redeemed' && item.saleId === sale.id);
  if (!redemptions.length) return data;
  const restoredAmount = sumMoney(redemptions.map((item) => item.amountInCents));
  if (getSaleResolvedAmount(sale.id, data) + restoredAmount > sale.totalInCents) throw new Error('A restauração do crédito excederia o total da venda após os reembolsos já registrados.');
  const credits = data.credits.map((credit) => {
    const amount = sumMoney(redemptions.filter((item) => item.creditId === credit.id).map((item) => item.amountInCents));
    if (!amount) return credit;
    const balanceInCents = credit.balanceInCents + amount;
    return { ...credit, balanceInCents: Math.min(credit.originalAmountInCents, balanceInCents), status: balanceInCents >= credit.originalAmountInCents ? 'available' as const : 'partial' as const };
  });
  const restored = redemptions.map((item) => ({ id: createId(), creditId: item.creditId, type: 'restored' as const, amountInCents: item.amountInCents, createdAt: new Date().toISOString(), saleId: sale.id, ...(getOpenCashSession(loadCashData()) ? { cashSessionId: getOpenCashSession(loadCashData())!.id } : {}) }));
  const next = { ...data, credits, creditMovements: [...data.creditMovements, ...restored] }; save(next); return next;
}

export function calculateReturnedItemTotals(sale: Sale, data = loadSaleFinancialData()): Record<string, number> {
  const result: Record<string, number> = {};
  for (const entry of data.returns.filter((item) => item.saleId === sale.id)) for (const line of entry.items) result[line.productId] = (result[line.productId] ?? 0) + line.quantity;
  return result;
}

function assertRefundCashSession(sessionId: string | undefined, amount: number): void {
  const cash = loadCashData();
  const open = getOpenCashSession(cash);
  if (!open || open.id !== sessionId) throw new Error('Abra um caixa e registre o reembolso no caixa atual aberto.');
  requireCashOwner(open.operatorId);
  if (amount > getCashSummary(open, cash.movements, listSales()).expectedInCents) throw new Error('O reembolso excede o saldo físico disponível no caixa.');
}

function save(data: SaleFinancialData): void {
  requireOperator();
  if (!isSaleFinancialData(data)) throw new Error('Os registros financeiros não passaram na validação.');
  try { localStorage.setItem(FINANCIAL_STORAGE_KEY, JSON.stringify(data)); if (typeof window !== 'undefined') window.dispatchEvent(new Event('raiz-pdv:data-changed')); } catch { throw new Error('Não foi possível gravar o registro financeiro local. Nenhum lançamento foi confirmado.'); }
}
function isSaleFinancialData(value: unknown): value is SaleFinancialData {
  if (!isRecord(value) || !Array.isArray(value.returns) || !Array.isArray(value.refunds) || !Array.isArray(value.credits) || !Array.isArray(value.creditMovements) || !Array.isArray(value.creditReservations)) return false;
  if (!value.returns.every(isReturn) || !value.refunds.every(isRefund) || !value.credits.every(isCustomerCredit) || !value.creditMovements.every(isCreditMovement) || !value.creditReservations.every(isReservation)) return false;
  const credits = value.credits as CustomerCredit[], refunds = value.refunds as FinancialRefund[];
  if (new Set(credits.map((item) => item.id)).size !== credits.length || new Set(credits.map((item) => item.receiptNumber)).size !== credits.length) return false;
  if (new Set(refunds.map((item) => item.id)).size !== refunds.length) return false;
  if (new Set((value.returns as MerchandiseReturn[]).map((item) => item.id)).size !== value.returns.length) return false;
  if (new Set((value.creditMovements as CustomerCreditMovement[]).map((item) => item.id)).size !== value.creditMovements.length) return false;
  if (new Set((value.creditReservations as CreditReservation[]).map((item) => item.id)).size !== value.creditReservations.length) return false;
  for (const refund of refunds) if (refund.creditId && !credits.some((credit) => credit.id === refund.creditId)) return false;
  for (const movement of value.creditMovements as CustomerCreditMovement[]) {
    if (!credits.some((credit) => credit.id === movement.creditId)) return false;
    if (movement.refundId && !refunds.some((refund) => refund.id === movement.refundId)) return false;
  }
  const reservations = value.creditReservations as CreditReservation[];
  for (const reservation of reservations) if (!credits.some((credit) => credit.id === reservation.creditId)) return false;
  for (const credit of credits) {
    try {
      const movements = (value.creditMovements as CustomerCreditMovement[]).filter((item) => item.creditId === credit.id);
      const issued = sumMoney(movements.filter((item) => item.type === 'issued').map((item) => item.amountInCents));
      const redeemed = sumMoney(movements.filter((item) => item.type === 'redeemed').map((item) => item.amountInCents));
      const restored = sumMoney(movements.filter((item) => item.type === 'restored').map((item) => item.amountInCents));
      const reserved = sumMoney(reservations.filter((item) => item.creditId === credit.id).map((item) => item.amountInCents));
      if (issued !== credit.originalAmountInCents || credit.balanceInCents !== issued - redeemed + restored || reserved > credit.balanceInCents) return false;
      if ((credit.balanceInCents === 0 && credit.status !== 'redeemed') || (credit.balanceInCents > 0 && credit.balanceInCents < credit.originalAmountInCents && credit.status !== 'partial') || (credit.balanceInCents === credit.originalAmountInCents && credit.status !== 'available')) return false;
    } catch { return false; }
  }
  return true;
}function isReturn(value: unknown): value is MerchandiseReturn {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.saleId !== 'string' || !Number.isSafeInteger(value.saleNumber) || !Number.isSafeInteger(value.amountInCents) || Number(value.amountInCents) <= 0 || typeof value.createdAt !== 'string' || !Array.isArray(value.items) || !value.items.length) return false;
  return value.items.every((item) => isRecord(item) && typeof item.productId === 'string' && typeof item.productName === 'string' && Number.isSafeInteger(item.quantity) && Number(item.quantity) > 0 && Number.isSafeInteger(item.amountInCents) && Number(item.amountInCents) >= 0) && (value.items as Array<{ amountInCents: number }>).reduce((total, item) => total + item.amountInCents, 0) === value.amountInCents;
}
function isRefund(value: unknown): value is FinancialRefund {
  return isRecord(value) && typeof value.id === 'string' && typeof value.saleId === 'string' && Number.isSafeInteger(value.saleNumber) && ['cash', 'pix', 'debit', 'credit', 'customer_credit'].includes(String(value.method)) && Number.isSafeInteger(value.amountInCents) && Number(value.amountInCents) > 0 && ['pending', 'completed', 'failed'].includes(String(value.status)) && typeof value.createdAt === 'string' && Number.isFinite(Date.parse(value.createdAt)) && (value.cashSessionId === undefined || typeof value.cashSessionId === 'string') && (value.creditId === undefined || typeof value.creditId === 'string') && (value.status === 'completed' ? typeof value.completedAt === 'string' && Number.isFinite(Date.parse(value.completedAt)) : value.completedAt === undefined) && (value.method === 'customer_credit' ? value.status === 'completed' && typeof value.creditId === 'string' : value.creditId === undefined);
}
function isCustomerCredit(value: unknown): value is CustomerCredit {
  return isRecord(value) && typeof value.id === 'string' && typeof value.receiptNumber === 'string' && typeof value.authCodeHash === 'string' && /^[a-f0-9]{64}$/.test(value.authCodeHash) && typeof value.originalSaleId === 'string' && Number.isSafeInteger(value.originalSaleNumber) && typeof value.issuedAt === 'string' && Number.isFinite(Date.parse(value.issuedAt)) && Number.isSafeInteger(value.originalAmountInCents) && Number(value.originalAmountInCents) > 0 && Number.isSafeInteger(value.balanceInCents) && Number(value.balanceInCents) >= 0 && Number(value.balanceInCents) <= Number(value.originalAmountInCents) && ['available', 'partial', 'redeemed', 'cancelled'].includes(String(value.status));
}
function isCreditMovement(value: unknown): value is CustomerCreditMovement {
  return isRecord(value) && typeof value.id === 'string' && typeof value.creditId === 'string' && ['issued', 'redeemed', 'restored'].includes(String(value.type)) && Number.isSafeInteger(value.amountInCents) && Number(value.amountInCents) > 0 && typeof value.createdAt === 'string';
}
function isReservation(value: unknown): value is CreditReservation {
  return isRecord(value) && typeof value.id === 'string' && typeof value.creditId === 'string' && typeof value.saleId === 'string' && Number.isSafeInteger(value.amountInCents) && Number(value.amountInCents) > 0 && typeof value.createdAt === 'string';
}
function isRecord(value: unknown): value is Record<string, any> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function createId(): string { return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`; }
function createAuthCode(): string {
  if (typeof crypto === 'undefined' || !crypto.getRandomValues) throw new Error('Este ambiente não oferece geração segura de códigos. Não foi emitido crédito.');
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
}
async function hashAuthCode(value: string): Promise<string> {
  if (typeof crypto === 'undefined' || !crypto.subtle) throw new Error('Não foi possível validar o código de autorização com segurança neste ambiente.');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value.toUpperCase()));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
function createReceiptNumber(): string { return `CR-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`; }