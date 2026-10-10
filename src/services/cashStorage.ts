import { getOpenCashSession, getPendingCashSessions } from '../domain/cashSessions';
import { withFinancialLock } from './financialLock';
import { assertFinancialRecoveryComplete } from './saleFinancialStorage';
import { requireCashOwner, requireOperator } from './operatorAccess';
import type { CashData, CashMovement, CashSession, CashReconciliation } from '../types/cash';
import type { PaymentMethod } from '../types/payment';
import { loadSettings } from './settingsStorage';
import { cashBusinessDate } from '../utils/cashDay';
import { listSales } from './saleStorage';
import { createCashReconciliation, getCashReconciliationDraft, getCashSummary, paymentMethods, type CashPaymentTotals } from '../utils/cash';

export const CASH_STORAGE_KEY = 'raiz-pdv:cash';

export function validateCashBackup(value: unknown): CashData {
  if (!isCashData(value)) throw new Error('Os dados de caixa do backup são inválidos.');
  return value;
}
export function loadCashData(): CashData {
  const raw = localStorage.getItem(CASH_STORAGE_KEY);
  if (raw === null) return { sessions: [], movements: [] };
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('Os dados do caixa salvos estão inválidos.'); }
  if (!isCashData(value)) throw new Error('Os dados do caixa salvos estão inválidos.');
  return value;
}
export { getOpenCashSession, getPendingCashSessions } from '../domain/cashSessions';
export function assertCurrentCashSession(sessionId: string): CashSession {
  const session = getOpenCashSession(loadCashData());
  if (!session || session.id !== sessionId) throw new Error('Este caixa não está aberto para hoje. Feche o caixa pendente e abra um novo para vender.');
  requireCashOwner(session.operatorId);
  return session;
}
export async function openCashSession(openingAmountInCents: number, operatorId?: string): Promise<CashData> {
  return withFinancialLock(() => {
    assertFinancialRecoveryComplete();
    const signedIn = requireOperator();
    if (operatorId !== signedIn.id) throw new Error('O caixa deve ser aberto pelo operador que entrou com senha.');
    assertCents(openingAmountInCents, true);
    const data = loadCashData();
    if (getOpenCashSession(data)) throw new Error('Já existe um caixa aberto para hoje.');
    const operator = loadSettings().operators?.find((item) => item.id === operatorId && item.active);
    if (!operator) throw new Error('Selecione um operador ativo cadastrado em Configurações.');
    if (getPendingCashSessions(data).some((session) => !session.operatorId || session.operatorId === operator.id)) throw new Error('Feche o caixa pendente deste operador antes de abrir o de hoje. Caixas antigos sem operador também precisam ser fechados.');
    const now = new Date();
    const session: CashSession = { id: createId(), openedAt: now.toISOString(), businessDate: cashBusinessDate(now), operatorId: operator.id, operatorName: operator.name, openingAmountInCents, status: 'open' };
    const next = { ...data, sessions: [session, ...data.sessions] }; saveCashData(next); return next;
  });
}
export async function addCashMovement(sessionId: string, type: CashMovement['type'], amountInCents: number, description = ''): Promise<CashData> {
  return withFinancialLock(() => {
    assertFinancialRecoveryComplete();
    if (!['supply', 'withdrawal'].includes(type)) throw new Error('Tipo de movimentação inválido.');
    assertCents(amountInCents, false);
    const data = loadCashData();
    const session = getOpenCashSession(data);
    if (session?.id !== sessionId) throw new Error('Movimentações só podem entrar no caixa aberto de hoje.');
    if (!session) throw new Error('Não há um caixa aberto para registrar esta movimentação.');
    requireCashOwner(session.operatorId);
    if (type === 'withdrawal' && amountInCents > getCashSummary(session, data.movements, listSales()).expectedInCents) throw new Error('Não é possível realizar esta sangria. O valor informado é maior que o saldo disponível do caixa.');
    const movement: CashMovement = { id: createId(), cashSessionId: sessionId, type, amountInCents, ...(description.trim() ? { description: description.trim() } : {}), createdAt: new Date().toISOString() };
    const next = { ...data, movements: [movement, ...data.movements] }; saveCashData(next); return next;
  });
}
export async function closeCashSession(sessionId: string, countedInCents: CashPaymentTotals, reviewedFingerprint: string): Promise<CashData> {
  return withFinancialLock(() => {
    assertFinancialRecoveryComplete();
    for (const method of paymentMethods) assertCents(countedInCents?.[method], true);
    const data = loadCashData();
    const sessionIndex = data.sessions.findIndex((item) => item.id === sessionId && item.status === 'open');
    if (sessionIndex < 0) throw new Error('Este caixa já foi fechado ou não está mais aberto.');
    const session = data.sessions[sessionIndex];
    requireCashOwner(session.operatorId, true);
    const sales = listSales();
    const draft = getCashReconciliationDraft(session, data.movements, sales);
    if (!reviewedFingerprint || draft.sourceFingerprint !== reviewedFingerprint) throw new Error('Os dados do caixa ou das vendas mudaram durante a conferência. Reabra o fechamento, revise os quatro valores e confirme novamente.');
    const reconciliation = createCashReconciliation(draft, countedInCents);
    const cash = reconciliation.methods.cash;
    const closed: CashSession = { ...session, status: 'closed', closedAt: new Date().toISOString(), countedAmountInCents: cash.countedInCents, expectedAmountInCents: cash.expectedInCents, differenceInCents: cash.differenceInCents, reconciliation };
    const sessions = [...data.sessions]; sessions[sessionIndex] = closed;
    const next = { ...data, sessions }; saveCashData(next); return next;
  });
}
export function clearCashData(): void { localStorage.removeItem(CASH_STORAGE_KEY); }
function saveCashData(data: CashData): void { try { localStorage.setItem(CASH_STORAGE_KEY, JSON.stringify(data)); } catch { throw new Error('Não foi possível salvar os dados do caixa no armazenamento local. O fechamento não foi concluído.'); } }
function assertCents(value: number, allowZero: boolean): void { if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) throw new Error('Informe um valor válido em reais.'); }
function isCashData(value: unknown): value is CashData {
  if (typeof value !== 'object' || value === null) return false;
  const data = value as Record<string, unknown>;
  return Array.isArray(data.sessions) && data.sessions.every(isCashSession) && validOpenSessions(data.sessions as CashSession[])
    && Array.isArray(data.movements) && data.movements.every(isCashMovement) && new Set(data.movements.map((item: CashMovement) => item.id)).size === data.movements.length
    && (data.movements as CashMovement[]).every((movement) => (data.sessions as CashSession[]).some((session) => session.id === movement.cashSessionId));
}
function isCashSession(value: unknown): value is CashSession {
  if (typeof value !== 'object' || value === null) return false;
  const session = value as Record<string, unknown>;
  if (typeof session.id !== 'string' || !session.id || typeof session.openedAt !== 'string' || !Number.isFinite(Date.parse(session.openedAt)) || !Number.isSafeInteger(session.openingAmountInCents) || Number(session.openingAmountInCents) < 0 || !['open', 'closed'].includes(String(session.status))) return false;
  if ((session.operatorId === undefined) !== (session.operatorName === undefined) || (session.operatorId !== undefined && (typeof session.operatorId !== 'string' || !session.operatorId || typeof session.operatorName !== 'string' || !session.operatorName)) || (session.businessDate !== undefined && session.businessDate !== cashBusinessDate(String(session.openedAt)))) return false;
  if (session.status === 'open') return session.closedAt === undefined && session.countedAmountInCents === undefined && session.expectedAmountInCents === undefined && session.differenceInCents === undefined && session.reconciliation === undefined;
  if (!(typeof session.closedAt === 'string' && Number.isFinite(Date.parse(session.closedAt)) && Number.isSafeInteger(session.countedAmountInCents) && Number(session.countedAmountInCents) >= 0 && Number.isSafeInteger(session.expectedAmountInCents) && Number(session.expectedAmountInCents) >= 0 && Number.isSafeInteger(session.differenceInCents) && Number(session.differenceInCents) === Number(session.countedAmountInCents) - Number(session.expectedAmountInCents))) return false;
  if (session.reconciliation === undefined) return true;
  if (!isCashReconciliation(session.reconciliation)) return false;
  const cash = session.reconciliation.methods.cash;
  return Number(session.countedAmountInCents) === cash.countedInCents && Number(session.expectedAmountInCents) === cash.expectedInCents && Number(session.differenceInCents) === cash.differenceInCents;
}
function isCashReconciliation(value: unknown): value is CashReconciliation {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (!Number.isSafeInteger(record.totalNetSalesInCents) || Number(record.totalNetSalesInCents) < 0 || typeof record.paymentTotalsInCents !== 'object' || record.paymentTotalsInCents === null || typeof record.methods !== 'object' || record.methods === null || typeof record.cashSummary !== 'object' || record.cashSummary === null) return false;
  if (record.summaryVersion !== undefined && (record.summaryVersion !== 2 || !Number.isSafeInteger(record.netReceivedInCents) || !Number.isSafeInteger(record.saleCount) || Number(record.saleCount) < 0 || !Number.isSafeInteger(record.cancelledCount) || Number(record.cancelledCount) < 0)) return false;
  const totals = record.paymentTotalsInCents as Record<string, unknown>, methods = record.methods as Record<string, unknown>, summary = record.cashSummary as Record<string, unknown>;
  const validTotals = paymentMethods.every((method) => Number.isSafeInteger(totals[method]) && Number(totals[method]) >= 0);
  const validSummary = ['openingInCents', 'salesInCents', 'suppliesInCents', 'withdrawalsInCents', 'expectedInCents'].every((key) => Number.isSafeInteger(summary[key]) && Number(summary[key]) >= 0) && (summary.refundsInCents === undefined || (Number.isSafeInteger(summary.refundsInCents) && Number(summary.refundsInCents) >= 0));
  const refunds = Number(summary.refundsInCents ?? 0);
  const derivedExpected = Number(summary.openingInCents) + Number(summary.salesInCents) + Number(summary.suppliesInCents) - Number(summary.withdrawalsInCents) - refunds;
  const refundTotals = (record.refundTotalsInCents ?? { cash: 0, pix: 0, debit: 0, credit: 0 }) as Record<string, unknown>;
  const validRefunds = paymentMethods.every((method) => Number.isSafeInteger(refundTotals[method]) && Number(refundTotals[method]) >= 0) && (record.customerCreditConsumedInCents === undefined || (Number.isSafeInteger(record.customerCreditConsumedInCents) && Number(record.customerCreditConsumedInCents) >= 0));
  const validNetReceived = record.summaryVersion === undefined || Number(record.netReceivedInCents) === paymentMethods.reduce((total, method) => total + Number(totals[method]) - Number(refundTotals[method]), 0);
  return validNetReceived && validTotals && validSummary && validRefunds && Number.isSafeInteger(derivedExpected) && derivedExpected >= 0 && Number(summary.expectedInCents) === derivedExpected
    && Number(summary.salesInCents) === Number(totals.cash)
    && paymentMethods.every((method) => isReconciliationMethod(methods[method])
      && methods[method].expectedInCents === (method === 'cash' ? Number(summary.expectedInCents) : record.summaryVersion === 2 ? Number(totals[method]) - Number(refundTotals[method] ?? 0) : Math.max(0, Number(totals[method]) - Number(refundTotals[method] ?? 0))))
    && (methods.cash as CashReconciliation['methods'][PaymentMethod]).expectedInCents === Number(summary.expectedInCents);
}
function isReconciliationMethod(value: unknown): value is CashReconciliation['methods'][PaymentMethod] {
  if (typeof value !== 'object' || value === null) return false;
  const method = value as Record<string, unknown>;
  return Number.isSafeInteger(method.expectedInCents) && Number.isSafeInteger(method.countedInCents) && Number(method.countedInCents) >= 0 && Number.isSafeInteger(method.differenceInCents) && Number(method.differenceInCents) === Number(method.countedInCents) - Number(method.expectedInCents);
}
function isCashMovement(value: unknown): value is CashMovement {
  if (typeof value !== 'object' || value === null) return false;
  const movement = value as Record<string, unknown>;
  return typeof movement.id === 'string' && !!movement.id && typeof movement.cashSessionId === 'string' && !!movement.cashSessionId && ['supply', 'withdrawal'].includes(String(movement.type)) && Number.isSafeInteger(movement.amountInCents) && Number(movement.amountInCents) > 0 && (movement.description === undefined || typeof movement.description === 'string') && typeof movement.createdAt === 'string' && Number.isFinite(Date.parse(movement.createdAt));
}
function createId(): string { return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`; }

function validOpenSessions(sessions: CashSession[]): boolean {
  if (new Set(sessions.map((session) => session.id)).size !== sessions.length) return false;
  const open = sessions.filter((session) => session.status === 'open');
  const dates = open.map((session) => session.businessDate ?? cashBusinessDate(session.openedAt));
  const operators = open.filter((session) => session.operatorId).map((session) => session.operatorId);
  return new Set(dates).size === dates.length && new Set(operators).size === operators.length;
}
