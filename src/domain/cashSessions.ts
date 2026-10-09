import type { CashData, CashSession } from '../types/cash';
import { cashBusinessDate } from '../utils/cashDay';
export function getOpenCashSession(data: CashData, now = new Date()): CashSession | undefined {
  return data.sessions.find((session) => session.status === 'open' && (session.businessDate ?? cashBusinessDate(session.openedAt)) === cashBusinessDate(now));
}
export function getPendingCashSessions(data: CashData, now = new Date()): CashSession[] {
  return data.sessions.filter((session) => session.status === 'open' && (session.businessDate ?? cashBusinessDate(session.openedAt)) !== cashBusinessDate(now));
}
