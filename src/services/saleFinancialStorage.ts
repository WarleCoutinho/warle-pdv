import * as financialDomain from '../domain/financial';
import { CART_STORAGE_KEY } from './cartStorage';
import type { PaymentMethod } from '../types/payment';
import type { Sale } from '../types/sale';
import { requireCashOwner, requireOperator, OPERATOR_SESSION_KEY } from './operatorAccess';
import { getOpenCashSession, loadCashData } from './cashStorage';
import { listSales } from './saleStorage';
import { getCashSummary } from '../utils/cash';
import { emptySaleFinancialData, type CreditReservation, type CustomerCredit, type CustomerCreditMovement, type FinancialRefund, type MerchandiseReturn, type SaleFinancialData } from '../types/customerCredit';
import { multiplyMoney, sumMoney } from '../utils/money';
import { getSaleStatus } from '../utils/saleStatus';
import { getSaleLines, getReturnedLineQuantities } from '../utils/saleLines';
import { withFinancialLock } from './financialLock';
export const withCustomerCreditLock = withFinancialLock;
const creditAuthorizations = new Map<string, { hash: string; session: string; expiresAt: number }>();

export function assertCreditAuthorization(requested: Array<{ creditId: string }>): void {
  requireOperator();
  const data = loadSaleFinancialData();
  for (const { creditId } of requested) {
    const grant = creditAuthorizations.get(creditId);
    const credit = data.credits.find((item) => item.id === creditId);
    if (!grant || !credit || grant.hash !== credit.authCodeHash || grant.session !== sessionStorage.getItem(OPERATOR_SESSION_KEY) || grant.expiresAt < Date.now()) throw new Error('Informe novamente o código de autorização do crédito antes de concluir a venda.');
  }
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

export function getSaleEligibleAmount(sale: Sale, data = loadSaleFinancialData()) { return financialDomain.getSaleEligibleAmount(sale, data); }
export function getSaleResolvedAmount(saleId: string, data = loadSaleFinancialData()) { return financialDomain.getSaleResolvedAmount(saleId, data); }
export function getSaleUnresolvedAmount(sale: Sale, data = loadSaleFinancialData()) { return financialDomain.getSaleUnresolvedAmount(sale, data); }
export function getSessionRefundTotals(sessionId: string, data = loadSaleFinancialData()) { return financialDomain.getSessionRefundTotals(sessionId, data); }
export { getCustomerCreditReceivedBySession } from '../domain/financial';

export async function recordMerchandiseReturn(sale: Sale, quantities: Record<string, number>, cashSessionId?: string): Promise<SaleFinancialData> {
  return withCustomerCreditLock(() => {
    sale = listSales().find((item) => item.id === sale.id) ?? sale;
    if (cashSessionId) assertRefundCashSession(cashSessionId, 0);
    const data = loadSaleFinancialData();
    if (getSaleStatus(sale) === 'cancelled') throw new Error('A venda cancelada já permite apuração pelo valor integral; não registre outra devolução parcial nela.');
    const returnedByLine = getReturnedLineQuantities(sale, data);
    const lines = getSaleLines(sale);
    for (const key of Object.keys(quantities)) {
      if (!lines.some((item) => item.lineId === key) && lines.filter((item) => item.productId === key).length !== 1) throw new Error('Selecione a linha original da venda; este produto possui linhas repetidas ou não existe na venda.');
    }
    const items: MerchandiseReturn['items'] = [];
    for (const item of lines) {
      const uniqueProduct = lines.filter((line) => line.productId === item.productId).length === 1;
      const quantity = quantities[item.lineId] ?? (uniqueProduct ? quantities[item.productId] : 0) ?? 0;
      if (!Number.isSafeInteger(quantity) || quantity < 0) throw new Error('Informe quantidades inteiras válidas para a devolução.');
      if ((returnedByLine[item.lineId] ?? 0) + quantity > item.quantity) throw new Error(`A quantidade devolvida de ${item.productName} excede a quantidade da venda.`);
      if (quantity > 0) items.push({ lineId: item.lineId, productId: item.productId, productName: item.productName, unitPriceInCents: item.unitPriceInCents, quantity, amountInCents: multiplyMoney(item.unitPriceInCents, quantity) });
    }
    if (items.length === 0) throw new Error('Selecione ao menos um item para registrar a devolução.');
    const returnedAmount = sumMoney(items.map((item) => item.amountInCents));
    const entry: MerchandiseReturn = { id: createId(), saleId: sale.id, saleNumber: sale.number, createdAt: new Date().toISOString(), ...(cashSessionId ? { cashSessionId } : {}), items, amountInCents: returnedAmount };
    const next = { ...data, returns: [...data.returns, entry] };
    save(next);
    return next;
  });
}

export async function settleSaleBalance(sale: Sale, input: {
  amounts: Record<PaymentMethod | 'customer_credit', number>;
  statuses?: Partial<Record<PaymentMethod, 'completed' | 'pending'>>;
  cashSessionId?: string;
}): Promise<{ data: SaleFinancialData; issuedCredits: Array<{ credit: CustomerCredit; authCode: string }> }> {
  return withCustomerCreditLock(async () => {
    assertFinancialRecoveryComplete();
    if (input.cashSessionId) assertRefundCashSession(input.cashSessionId, 0);
    sale = listSales().find((item) => item.id === sale.id) ?? sale;
    const data = loadSaleFinancialData();
    const eligible = getSaleEligibleAmount(sale, data);
    const remaining = eligible - getSaleResolvedAmount(sale.id, data);
    const methods: Array<PaymentMethod | 'customer_credit'> = ['cash', 'pix', 'debit', 'credit', 'customer_credit'];
    for (const method of methods) {
      const amount = input.amounts[method] ?? 0;
      if (!Number.isSafeInteger(amount) || amount < 0) throw new Error('Informe valores de resolução não negativos e em centavos inteiros.');
      if (amount > 0 && method !== 'customer_credit' && input.cashSessionId) assertRefundCashSession(input.cashSessionId, 0);
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
    if (input.amounts.cash > 0) assertRefundCashSession(input.cashSessionId, input.statuses?.cash === 'pending' ? 0 : input.amounts.cash);
    const next = { ...data, refunds, credits, creditMovements };
    save(next);
    return { data: next, issuedCredits };
  });
}

export async function lookupCustomerCredit(query: string, authCode?: string): Promise<Omit<CustomerCredit, 'authCodeHash'> | undefined> {
  const normalized = query.trim().toLocaleUpperCase('pt-BR');
  if (!normalized) return undefined;
  const hash = authCode ? await hashAuthCode(authCode.trim()) : undefined;
  const data = loadSaleFinancialData();
  const candidates = data.credits.filter((item) => item.receiptNumber.toLocaleUpperCase('pt-BR') === normalized || String(item.originalSaleNumber) === normalized.replace(/^#?0*/, ''));
  const credit = hash ? candidates.find((item) => item.authCodeHash === hash) : authCode !== undefined ? undefined : candidates[0];
  if (!credit) return undefined;
  if (hash) {
    requireOperator();
    creditAuthorizations.set(credit.id, { hash, session: sessionStorage.getItem(OPERATOR_SESSION_KEY)!, expiresAt: Date.now() + 5 * 60 * 1000 });
  }
  const reserved = sumMoney(data.creditReservations.filter((item) => item.creditId === credit.id).map((item) => item.amountInCents));
  const { authCodeHash: _secret, ...publicCredit } = credit;
  return { ...publicCredit, balanceInCents: Math.max(0, credit.balanceInCents - reserved) };
}

export function searchCustomerCredits(query: string): Array<Omit<CustomerCredit, 'authCodeHash'>> {
  const normalized = query.trim().toLocaleUpperCase('pt-BR');
  if (!normalized) return [];
  return loadSaleFinancialData().credits.filter((credit) => credit.receiptNumber.toLocaleUpperCase('pt-BR').includes(normalized) || String(credit.originalSaleNumber) === normalized.replace(/^#?0*/, '')).map(({ authCodeHash: _secret, ...credit }) => credit);
}

export async function updatePendingRefund(refundId: string, status: 'completed' | 'failed', cashSessionId?: string): Promise<SaleFinancialData> {
  return withCustomerCreditLock(() => {
    assertFinancialRecoveryComplete();
    const data = loadSaleFinancialData();
    const refund = data.refunds.find((item) => item.id === refundId);
    if (!refund || refund.status !== 'pending') throw new Error('Este reembolso não está pendente ou já foi atualizado.');
    if (status === 'completed' && cashSessionId) assertRefundCashSession(cashSessionId, refund.method === 'cash' ? refund.amountInCents : 0);
    if (status === 'completed' && refund.method === 'cash') assertRefundCashSession(cashSessionId, refund.amountInCents);
    const refunds = data.refunds.map((item) => item.id === refundId ? { ...item, status, ...(status === 'completed' ? { completedAt: new Date().toISOString(), cashSessionId } : {}) } : item);
    const next = { ...data, refunds }; save(next); return next;
  });
}

export function reserveCreditRedemptions(saleId: string, requested: Array<{ creditId: string; amountInCents: number }>): SaleFinancialData {
  const data = loadSaleFinancialData();
  if (data.creditReservations.some((item) => item.saleId === saleId) || data.creditMovements.some((item) => item.saleId === saleId && item.type === 'redeemed')) throw new Error('Esta venda já possui reserva ou consumo de crédito; não repita a operação.');
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

function validateCreditReservations(sale: Sale, data: SaleFinancialData): CreditReservation[] {
  const reservations = data.creditReservations.filter((item) => item.saleId === sale.id);
  const requested = new Map<string, number>();
  for (const payment of sale.payments.filter((item) => item.method === 'customer_credit')) requested.set(payment.customerCreditId!, sumMoney([requested.get(payment.customerCreditId!) ?? 0, payment.amountInCents]));
  const redeemed = data.creditMovements.filter((item) => item.saleId === sale.id && item.type === 'redeemed');
  if (!reservations.length) {
    if ([...requested].some(([id, amount]) => sumMoney(redeemed.filter((item) => item.creditId === id).map((item) => item.amountInCents)) !== amount)) throw new Error('A venda gravada não possui reserva ou baixa correspondente. Preserve os dados para auditoria.');
    return reservations;
  }
  if (redeemed.length || [...requested].some(([id, amount]) => sumMoney(reservations.filter((item) => item.creditId === id).map((item) => item.amountInCents)) !== amount)
    || reservations.some((item) => !requested.has(item.creditId))) throw new Error('A reserva de crédito não corresponde à venda gravada; ela foi mantida bloqueada para auditoria.');
  return reservations;
}

export function commitCreditRedemptions(sale: Sale): SaleFinancialData {
  const data = loadSaleFinancialData();
  const reservations = validateCreditReservations(sale, data);
  if (!reservations.length) return data;
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

/** Re-read sales after taking the lock; the caller's old snapshot cannot release a valid reservation. */
export async function recoverCreditReservations(_previousSales?: Sale[]): Promise<void> {
  await withCustomerCreditLock(() => {
    requireOperator();
    const sales = listSales();
    const reservations = loadSaleFinancialData().creditReservations;
    for (const saleId of new Set(reservations.map((item) => item.saleId))) {
      const sale = sales.find((item) => item.id === saleId);
      if (!sale) { releaseCreditReservations(saleId); continue; }
      validateCreditReservations(sale, loadSaleFinancialData());
      discardInterruptedSaleDraft(sale);
      commitCreditRedemptions(sale);
    }
    for (const sale of sales) {
      if (!sale.payments.some((item) => item.method === 'customer_credit')) continue;
      commitCreditRedemptions(sale);
      if (getSaleStatus(sale) === 'cancelled') restoreCreditsForCancelledSale(sale);
    }
  });
}

/** A temporary cart already persisted as this sale must not be offered for replay after restart. */
function discardInterruptedSaleDraft(sale: Sale): void {
  const raw = localStorage.getItem(CART_STORAGE_KEY);
  if (!raw) return;
  let draft: unknown;
  try { draft = JSON.parse(raw); } catch { return; }
  const expected = sale.items.map(({ productId, quantity, unitPriceInCents }) => ({ productId, quantity, unitPriceInCents }));
  if (JSON.stringify(draft) === JSON.stringify(expected)) localStorage.removeItem(CART_STORAGE_KEY);
}

/** Incomplete writes must be recovered before another sale, settlement or cash close. */
export function assertFinancialRecoveryComplete(): void {
  const data = loadSaleFinancialData();
  const sales = listSales();
  if (data.creditReservations.length) throw new Error('Há reserva de crédito pendente de recuperação. Atualize o sistema antes de continuar.');
  for (const sale of sales) {
    for (const id of new Set(sale.payments.filter((item) => item.method === 'customer_credit').map((item) => item.customerCreditId!))) {
      const paid = sumMoney(sale.payments.filter((item) => item.customerCreditId === id).map((item) => item.amountInCents));
      const redeemed = sumMoney(data.creditMovements.filter((item) => item.saleId === sale.id && item.creditId === id && item.type === 'redeemed').map((item) => item.amountInCents));
      const restored = sumMoney(data.creditMovements.filter((item) => item.saleId === sale.id && item.creditId === id && item.type === 'restored').map((item) => item.amountInCents));
      if (redeemed !== paid || (sale.status === 'cancelled' && restored !== redeemed)) throw new Error('A venda possui baixa ou restauração de crédito pendente. Atualize o sistema antes de continuar.');
    }
  }
}

export function releaseCreditReservations(saleId: string): void {
  if (listSales().some((item) => item.id === saleId)) throw new Error('A reserva pertence a uma venda gravada e deve ser recuperada, não liberada.');
  const data = loadSaleFinancialData();
  const next = { ...data, creditReservations: data.creditReservations.filter((item) => item.saleId !== saleId) };
  save(next);
}

export function restoreCreditsForCancelledSale(sale: Sale): SaleFinancialData {
  const data = loadSaleFinancialData();
  if (getSaleStatus(sale) !== 'cancelled') throw new Error('Somente uma venda cancelada permite restaurar crédito.');
  const redemptions = data.creditMovements.filter((item) => item.type === 'redeemed' && item.saleId === sale.id);
  const remaining = new Map<string, number>();
  for (const item of redemptions) remaining.set(item.creditId, sumMoney([remaining.get(item.creditId) ?? 0, item.amountInCents]));
  for (const item of data.creditMovements.filter((entry) => entry.type === 'restored' && entry.saleId === sale.id)) {
    const amount = (remaining.get(item.creditId) ?? 0) - item.amountInCents;
    if (amount < 0) throw new Error('A restauração registrada excede o crédito utilizado. Preserve os dados para auditoria.');
    remaining.set(item.creditId, amount);
  }
  if (![...remaining.values()].some((amount) => amount > 0)) return data;
  const restoredAmount = sumMoney([...remaining.values()]);
  if (getSaleResolvedAmount(sale.id, data) + restoredAmount > sale.totalInCents) throw new Error('A restauração do crédito excederia o total da venda após os reembolsos já registrados.');
  const credits = data.credits.map((credit) => {
    const amount = remaining.get(credit.id) ?? 0;
    if (!amount) return credit;
    const balanceInCents = credit.balanceInCents + amount;
    if (balanceInCents > credit.originalAmountInCents) throw new Error('A restauração excede o crédito original. Preserve os dados para auditoria.');
    return { ...credit, balanceInCents, status: balanceInCents >= credit.originalAmountInCents ? 'available' as const : 'partial' as const };
  });
  const restored = [...remaining].filter(([, amount]) => amount > 0).map(([creditId, amountInCents]) => ({ id: createId(), creditId, type: 'restored' as const, amountInCents, createdAt: new Date().toISOString(), saleId: sale.id }));
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
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.saleId !== 'string' || !Number.isSafeInteger(value.saleNumber) || !Number.isSafeInteger(value.amountInCents) || Number(value.amountInCents) <= 0 || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt)) || !Array.isArray(value.items) || !value.items.length) return false;
  return value.items.every((item) => isRecord(item) && (item.lineId === undefined || (typeof item.lineId === 'string' && !!item.lineId)) && (item.unitPriceInCents === undefined || (Number.isSafeInteger(item.unitPriceInCents) && item.unitPriceInCents >= 0 && item.unitPriceInCents * item.quantity === item.amountInCents)) && typeof item.productId === 'string' && typeof item.productName === 'string' && Number.isSafeInteger(item.quantity) && Number(item.quantity) > 0 && Number.isSafeInteger(item.amountInCents) && Number(item.amountInCents) >= 0) && (value.items as Array<{ amountInCents: number }>).reduce((total, item) => total + item.amountInCents, 0) === value.amountInCents;
}
function isRefund(value: unknown): value is FinancialRefund {
  return isRecord(value) && typeof value.id === 'string' && typeof value.saleId === 'string' && Number.isSafeInteger(value.saleNumber) && ['cash', 'pix', 'debit', 'credit', 'customer_credit'].includes(String(value.method)) && Number.isSafeInteger(value.amountInCents) && Number(value.amountInCents) > 0 && ['pending', 'completed', 'failed'].includes(String(value.status)) && typeof value.createdAt === 'string' && Number.isFinite(Date.parse(value.createdAt)) && (value.cashSessionId === undefined || typeof value.cashSessionId === 'string') && (value.creditId === undefined || typeof value.creditId === 'string') && (value.status === 'completed' ? typeof value.completedAt === 'string' && Number.isFinite(Date.parse(value.completedAt)) : value.completedAt === undefined) && (value.method === 'customer_credit' ? value.status === 'completed' && typeof value.creditId === 'string' : value.creditId === undefined);
}
function isCustomerCredit(value: unknown): value is CustomerCredit {
  return isRecord(value) && typeof value.id === 'string' && typeof value.receiptNumber === 'string' && typeof value.authCodeHash === 'string' && /^[a-f0-9]{64}$/.test(value.authCodeHash) && typeof value.originalSaleId === 'string' && Number.isSafeInteger(value.originalSaleNumber) && typeof value.issuedAt === 'string' && Number.isFinite(Date.parse(value.issuedAt)) && Number.isSafeInteger(value.originalAmountInCents) && Number(value.originalAmountInCents) > 0 && Number.isSafeInteger(value.balanceInCents) && Number(value.balanceInCents) >= 0 && Number(value.balanceInCents) <= Number(value.originalAmountInCents) && ['available', 'partial', 'redeemed', 'cancelled'].includes(String(value.status));
}
function isCreditMovement(value: unknown): value is CustomerCreditMovement {
  return isRecord(value) && typeof value.id === 'string' && typeof value.creditId === 'string' && ['issued', 'redeemed', 'restored'].includes(String(value.type)) && Number.isSafeInteger(value.amountInCents) && Number(value.amountInCents) > 0 && typeof value.createdAt === 'string' && Number.isFinite(Date.parse(value.createdAt));
}
function isReservation(value: unknown): value is CreditReservation {
  return isRecord(value) && typeof value.id === 'string' && typeof value.creditId === 'string' && typeof value.saleId === 'string' && Number.isSafeInteger(value.amountInCents) && Number(value.amountInCents) > 0 && typeof value.createdAt === 'string' && Number.isFinite(Date.parse(value.createdAt));
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
