import type { CashData, CashMovement, CashSession } from '../types/cash';
import { listSales } from './saleStorage';
import { getCashSummary } from '../utils/cash';

const CASH_STORAGE_KEY = 'raiz-pdv:cash';

export function loadCashData(): CashData {
  const raw = localStorage.getItem(CASH_STORAGE_KEY);
  if (raw === null) return { sessions: [], movements: [] };
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('Os dados do caixa salvos estão inválidos.'); }
  if (!isCashData(value)) throw new Error('Os dados do caixa salvos estão inválidos.');
  return value;
}

export function getOpenCashSession(data: CashData): CashSession | undefined {
  return data.sessions.find((session) => session.status === 'open');
}

export function openCashSession(openingAmountInCents: number): CashData {
  assertCents(openingAmountInCents, true);
  const data = loadCashData();
  if (getOpenCashSession(data)) throw new Error('Já existe um caixa aberto.');
  const session: CashSession = {
    id: createId(), openedAt: new Date().toISOString(), openingAmountInCents, status: 'open',
  };
  const next = { ...data, sessions: [session, ...data.sessions] };
  saveCashData(next);
  return next;
}

export function addCashMovement(
  sessionId: string,
  type: CashMovement['type'],
  amountInCents: number,
  description = '',
): CashData {
  assertCents(amountInCents, false);
  const data = loadCashData();
  const session = data.sessions.find((item) => item.id === sessionId && item.status === 'open');
  if (!session) throw new Error('Não há um caixa aberto para registrar esta movimentação.');
  if (type === 'withdrawal' && amountInCents > getCashSummary(session, data.movements, listSales()).expectedInCents) {
    throw new Error('Não é possível realizar esta sangria. O valor informado é maior que o saldo disponível do caixa.');
  }
  const movement: CashMovement = {
    id: createId(), cashSessionId: sessionId, type, amountInCents,
    ...(description.trim() ? { description: description.trim() } : {}),
    createdAt: new Date().toISOString(),
  };
  const next = { ...data, movements: [movement, ...data.movements] };
  saveCashData(next);
  return next;
}

export function closeCashSession(sessionId: string, countedAmountInCents: number): CashData {
  assertCents(countedAmountInCents, true);
  const data = loadCashData();
  const sessionIndex = data.sessions.findIndex((item) => item.id === sessionId && item.status === 'open');
  if (sessionIndex < 0) throw new Error('Este caixa não está aberto.');
  const session = data.sessions[sessionIndex];
  const expectedAmountInCents = getCashSummary(session, data.movements, listSales()).expectedInCents;
  const differenceInCents = countedAmountInCents - expectedAmountInCents;
  if (!Number.isSafeInteger(differenceInCents)) throw new Error('Não foi possível calcular a diferença do caixa.');
  const closed: CashSession = {
    ...session, status: 'closed', closedAt: new Date().toISOString(), countedAmountInCents,
    expectedAmountInCents, differenceInCents,
  };
  const sessions = [...data.sessions];
  sessions[sessionIndex] = closed;
  const next = { ...data, sessions };
  saveCashData(next);
  return next;
}

export function clearCashData(): void {
  localStorage.removeItem(CASH_STORAGE_KEY);
}

function saveCashData(data: CashData): void {
  try { localStorage.setItem(CASH_STORAGE_KEY, JSON.stringify(data)); }
  catch { throw new Error('Não foi possível salvar os dados do caixa no armazenamento local.'); }
}

function assertCents(value: number, allowZero: boolean): void {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) throw new Error('Informe um valor válido em reais.');
}

function isCashData(value: unknown): value is CashData {
  if (typeof value !== 'object' || value === null) return false;
  const data = value as Record<string, unknown>;
  return Array.isArray(data.sessions) && data.sessions.every(isCashSession)
    && data.sessions.filter((session) => session.status === 'open').length <= 1
    && Array.isArray(data.movements) && data.movements.every(isCashMovement)
    && (data.movements as CashMovement[]).every((movement) => (data.sessions as CashSession[]).some((session) => session.id === movement.cashSessionId));
}

function isCashSession(value: unknown): value is CashSession {
  if (typeof value !== 'object' || value === null) return false;
  const session = value as Record<string, unknown>;
  if (typeof session.id !== 'string' || !session.id || typeof session.openedAt !== 'string' || !Number.isFinite(Date.parse(session.openedAt))
    || !Number.isSafeInteger(session.openingAmountInCents) || Number(session.openingAmountInCents) < 0
    || !['open', 'closed'].includes(String(session.status))) return false;
  if (session.status === 'open') return session.closedAt === undefined && session.countedAmountInCents === undefined
    && session.expectedAmountInCents === undefined && session.differenceInCents === undefined;
  return typeof session.closedAt === 'string' && Number.isFinite(Date.parse(session.closedAt))
    && Number.isSafeInteger(session.countedAmountInCents) && Number(session.countedAmountInCents) >= 0
    && Number.isSafeInteger(session.expectedAmountInCents) && Number(session.expectedAmountInCents) >= 0
    && Number.isSafeInteger(session.differenceInCents)
    && Number(session.differenceInCents) === Number(session.countedAmountInCents) - Number(session.expectedAmountInCents);
}

function isCashMovement(value: unknown): value is CashMovement {
  if (typeof value !== 'object' || value === null) return false;
  const movement = value as Record<string, unknown>;
  return typeof movement.id === 'string' && !!movement.id && typeof movement.cashSessionId === 'string' && !!movement.cashSessionId
    && ['supply', 'withdrawal'].includes(String(movement.type))
    && Number.isSafeInteger(movement.amountInCents) && Number(movement.amountInCents) > 0
    && (movement.description === undefined || typeof movement.description === 'string')
    && typeof movement.createdAt === 'string' && Number.isFinite(Date.parse(movement.createdAt));
}

function createId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
