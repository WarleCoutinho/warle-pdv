// Compatibility facade for the stabilized web engine. New consumers pass an explicit snapshot.
import * as cash from '../domain/cash';
import { loadSaleFinancialData } from '../services/saleFinancialStorage';
import type { CashSession, CashMovement } from '../types/cash';
import type { Sale } from '../types/sale';
export { paymentMethods, getSessionPaymentTotals, getSessionCashSales, createCashReconciliation } from '../domain/cash';
export type { CashPaymentTotals, CashReconciliationDraft } from '../domain/cash';
export function getCashSummary(session: CashSession, movements: CashMovement[], sales: Sale[]) { return cash.getCashSummary(session, movements, sales, loadSaleFinancialData()); }
export function getCashReconciliationDraft(session: CashSession, movements: CashMovement[], sales: Sale[]) { return cash.getCashReconciliationDraft(session, movements, sales, loadSaleFinancialData()); }
