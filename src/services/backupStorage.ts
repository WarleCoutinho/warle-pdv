import type { BackupData, BackupDocument, BackupSummary } from '../types/backup';
import { withFinancialLock } from './financialLock';
import { getReturnedLineQuantities } from '../utils/saleLines';
import { requireAdministrator } from './operatorAccess';
import { emptySaleFinancialData } from '../types/customerCredit';
import { CART_STORAGE_KEY } from './cartStorage';
import { CASH_STORAGE_KEY, loadCashData, validateCashBackup } from './cashStorage';
import { PRODUCTS_STORAGE_KEY, loadProducts, validateProductsBackup } from './productStorage';
import { SALES_STORAGE_KEY, listSales, validateSalesBackup } from './saleStorage';
import { SETTINGS_STORAGE_KEY, loadSettings, validateSettingsBackup } from './settingsStorage';
import { FINANCIAL_STORAGE_KEY, loadSaleFinancialData, validateSaleFinancialBackup, getSaleEligibleAmount, getSaleResolvedAmount } from './saleFinancialStorage';

export const BACKUP_FORMAT = 'raiz-pdv-backup';
export const BACKUP_VERSION = 2;
export const RESTORE_SAFETY_KEY = 'raiz-pdv:restore-safety-backup';
const RECOVERY_FORMAT = 'raiz-pdv-recovery-snapshot';
const LEGACY_MANAGED_KEYS = [PRODUCTS_STORAGE_KEY, SETTINGS_STORAGE_KEY, SALES_STORAGE_KEY, CASH_STORAGE_KEY] as const;
const MANAGED_KEYS = [...LEGACY_MANAGED_KEYS, FINANCIAL_STORAGE_KEY] as const;
const RESTORABLE_KEYS = [...MANAGED_KEYS, CART_STORAGE_KEY] as const;

export type { BackupData, BackupDocument, BackupSummary } from '../types/backup';
export function createBackupJson(): string {
  const data = readCurrentData();
  validateFinancialRelations(data);
  const contents = JSON.stringify(createDocument(data), null, 2);
  if (contents.length > 10 * 1024 * 1024) throw new Error('O backup excede o limite de 10 MB e não pode ser exportado com segurança.');
  return contents;
}

/** Accepts v1 without inventing financial events, and normalizes its absent ledger to empty. */
export function parseBackupJson(contents: string): { backup: BackupDocument; summary: BackupSummary } {
  if (contents.length > 10 * 1024 * 1024) throw new Error('O arquivo excede o limite seguro de 10 MB.');
  let value: unknown;
  try { value = JSON.parse(contents); } catch { throw new Error('O arquivo não contém um JSON válido.'); }
  if (!isRecord(value)) throw new Error('Este arquivo não é um backup do Raiz PDV.');
  if (value.format === RECOVERY_FORMAT) throw new Error('Este é um snapshot bruto de recuperação, não um backup importável. Escolha um arquivo exportado pelo Raiz PDV.');
  if (value.format !== BACKUP_FORMAT) throw new Error('Este arquivo não é um backup do Raiz PDV.');
  if (value.version !== 1 && value.version !== BACKUP_VERSION) throw new Error(`Versão de backup incompatível (${String(value.version)}). Atualize o sistema ou use um backup compatível.`);
  if (typeof value.exportedAt !== 'string' || !Number.isFinite(Date.parse(value.exportedAt))) throw new Error('A data de exportação do backup é inválida.');
  if (!isRecord(value.integrity) || value.integrity.algorithm !== 'fnv1a-32' || typeof value.integrity.checksum !== 'string') throw new Error('O arquivo não contém uma verificação de integridade compatível.');
  if (!isRecord(value.data) || !hasExactKeys(value.data, value.version === 1 ? ['products', 'settings', 'sales', 'cash'] : ['products', 'settings', 'sales', 'cash', 'financial'])) throw new Error('A estrutura dos dados do backup é inválida.');
  if (!hasExactKeys(value, ['format', 'version', 'exportedAt', 'data', 'integrity'])) throw new Error('O arquivo contém campos não reconhecidos.');
  const legacyData = value.version === 1;
  const checkedData = {
    products: validateProductsBackup(value.data.products), settings: validateSettingsBackup(value.data.settings),
    sales: validateSalesBackup(value.data.sales), cash: validateCashBackup(value.data.cash),
    ...(legacyData ? {} : { financial: validateSaleFinancialBackup(value.data.financial) }),
  };
  if (checksum(JSON.stringify(checkedData)) !== value.integrity.checksum) throw new Error('A verificação de integridade falhou. O arquivo pode estar corrompido ou ter sido alterado.');
  const data: BackupData = { ...checkedData, financial: legacyData ? emptySaleFinancialData() : checkedData.financial! };
  validateFinancialRelations(data);
  const backup: BackupDocument = { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: value.exportedAt, data, integrity: legacyData ? { algorithm: 'fnv1a-32', checksum: checksum(JSON.stringify(data)) } : value.integrity as BackupDocument['integrity'] };
  return { backup, summary: getBackupSummary(backup) };
}

/** Keeps a pre-restore snapshot and compensates all touched keys if a write fails. */
export async function restoreBackup(backup: BackupDocument): Promise<void> {
  return withFinancialLock(() => {
    requireAdministrator();
    const validated = parseBackupJson(JSON.stringify(backup)).backup;
    const previous = new Map<string, string | null>(RESTORABLE_KEYS.map((key) => [key, localStorage.getItem(key)]));
    try { localStorage.setItem(RESTORE_SAFETY_KEY, createSafetyCopy(previous)); }
    catch { throw new Error('Não foi possível criar a cópia de segurança dos dados atuais. Nada foi restaurado. Libere espaço no armazenamento e tente novamente.'); }
    try {
      localStorage.setItem(PRODUCTS_STORAGE_KEY, JSON.stringify(validated.data.products));
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(validated.data.settings));
      localStorage.setItem(SALES_STORAGE_KEY, JSON.stringify(validated.data.sales));
      localStorage.setItem(CASH_STORAGE_KEY, JSON.stringify(validated.data.cash));
      localStorage.setItem(FINANCIAL_STORAGE_KEY, JSON.stringify(validated.data.financial));
      localStorage.removeItem(CART_STORAGE_KEY);
      if (typeof window !== 'undefined') window.dispatchEvent(new Event('raiz-pdv:data-changed'));
    } catch {
      let rollbackFailed = false;
      for (const [key, oldValue] of previous) { try { if (oldValue === null) localStorage.removeItem(key); else localStorage.setItem(key, oldValue); } catch { rollbackFailed = true; } }
      if (rollbackFailed) throw new Error('A restauração falhou e a reversão automática não foi completa. A cópia de segurança anterior está preservada localmente; não feche o sistema e procure suporte.');
      throw new Error('A restauração falhou. Os dados anteriores foram preservados e restaurados.');
    }
  });
}

export function getRestoreSafetyCopy(): string | null {
  const raw = localStorage.getItem(RESTORE_SAFETY_KEY); if (raw === null) return null;
  let value: unknown; try { value = JSON.parse(raw); } catch { throw new Error('A cópia local de segurança está inválida.'); }
  if (isRecord(value) && value.format === BACKUP_FORMAT) parseBackupJson(raw); else validateRecoverySnapshot(value);
  return raw;
}

export function getBackupSummary(backup: BackupDocument): BackupSummary {
  return { exportedAt: backup.exportedAt, products: backup.data.products.length, activeProducts: backup.data.products.filter((product) => product.active).length,
    sales: backup.data.sales.length, cancelledSales: backup.data.sales.filter((sale) => sale.status === 'cancelled').length,
    cashSessions: backup.data.cash.sessions.length, closedSessions: backup.data.cash.sessions.filter((session) => session.status === 'closed').length,
    cashMovements: backup.data.cash.movements.length, returns: backup.data.financial.returns.length, refunds: backup.data.financial.refunds.length, customerCredits: backup.data.financial.credits.length };
}

function createSafetyCopy(previous: Map<string, string | null>): string {
  try {
    const data: BackupData = { products: validateProductsBackup(parseStored(previous.get(PRODUCTS_STORAGE_KEY))), settings: validateSettingsBackup(parseStored(previous.get(SETTINGS_STORAGE_KEY))),
      sales: validateSalesBackup(parseStored(previous.get(SALES_STORAGE_KEY))), cash: validateCashBackup(parseStored(previous.get(CASH_STORAGE_KEY))),
      financial: previous.get(FINANCIAL_STORAGE_KEY) === null ? emptySaleFinancialData() : validateSaleFinancialBackup(parseStored(previous.get(FINANCIAL_STORAGE_KEY))) };
    validateFinancialRelations(data);
    return JSON.stringify(createDocument(data));
  } catch {
    const storage = Object.fromEntries(MANAGED_KEYS.map((key) => [key, previous.get(key) ?? null]));
    return JSON.stringify({ format: RECOVERY_FORMAT, version: 1, exportedAt: new Date().toISOString(), storage, integrity: { algorithm: 'fnv1a-32', checksum: checksum(JSON.stringify(storage)) } });
  }
}
function parseStored(raw: string | null | undefined): unknown { if (raw == null) throw new Error('Dado local ausente.'); return JSON.parse(raw); }
function validateRecoverySnapshot(value: unknown): void {
  if (!isRecord(value)) throw new Error('A cópia local de recuperação está inválida.');
  const storage = value.storage, integrity = value.integrity;
  const validKeys = isRecord(storage) && (hasExactKeys(storage, [...MANAGED_KEYS]) || hasExactKeys(storage, [...LEGACY_MANAGED_KEYS]));
  const keys = isRecord(storage) && Object.hasOwn(storage, FINANCIAL_STORAGE_KEY) ? MANAGED_KEYS : LEGACY_MANAGED_KEYS;
  if (value.format !== RECOVERY_FORMAT || value.version !== 1 || typeof value.exportedAt !== 'string' || !Number.isFinite(Date.parse(value.exportedAt))
    || !validKeys || !keys.every((key) => storage[key] === null || typeof storage[key] === 'string')
    || !isRecord(integrity) || integrity.algorithm !== 'fnv1a-32' || typeof integrity.checksum !== 'string'
    || checksum(JSON.stringify(storage)) !== integrity.checksum || !hasExactKeys(value, ['format', 'version', 'exportedAt', 'storage', 'integrity'])) throw new Error('A cópia local de recuperação está inválida.');
}
function readCurrentData(): BackupData { return { products: loadProducts(), settings: loadSettings(), sales: listSales(), cash: loadCashData(), financial: loadSaleFinancialData() }; }
function createDocument(data: BackupData): BackupDocument { return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: new Date().toISOString(), data, integrity: { algorithm: 'fnv1a-32', checksum: checksum(JSON.stringify(data)) } }; }
function checksum(value: string): string { let hash = 0x811c9dc5; for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 0x01000193); } return (hash >>> 0).toString(16).padStart(8, '0'); }
function isRecord(value: unknown): value is Record<string, any> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function hasExactKeys(value: Record<string, unknown>, expected: string[]): boolean { return Object.keys(value).length === expected.length && expected.every((key) => Object.hasOwn(value, key)); }
/** Validate relationships before any restore writes, without reconstructing legacy events. */
export function validateFinancialRelations(data: BackupData): void {
  const { financial, sales, cash } = data;
  const fail = () => { throw new Error('As relações dos registros financeiros do backup são inválidas.'); };
  if (new Set(sales.map((sale) => sale.id)).size !== sales.length || new Set(sales.map((sale) => sale.number)).size !== sales.length) fail();
  const saleFor = (id: string, number?: number) => {
    const sale = sales.find((item) => item.id === id);
    if (!sale || (number !== undefined && sale.number !== number)) fail();
    return sale!;
  };
  const checkSession = (id?: string) => { if (id !== undefined && !cash.sessions.some((session) => session.id === id)) fail(); };
  for (const sale of sales) checkSession(sale.cashSessionId);
  for (const entry of financial.returns) {
    const sale = saleFor(entry.saleId, entry.saleNumber); checkSession(entry.cashSessionId);
    try { getReturnedLineQuantities(sale, financial); } catch { fail(); }
  }
  for (const refund of financial.refunds) { saleFor(refund.saleId, refund.saleNumber); checkSession(refund.cashSessionId); if (refund.method === 'cash' && !refund.cashSessionId) fail(); }
  for (const credit of financial.credits) {
    saleFor(credit.originalSaleId, credit.originalSaleNumber); checkSession(credit.issuingCashSessionId);
    const issued = financial.refunds.filter((refund) => refund.creditId === credit.id);
    if (issued.length !== 1 || issued[0].method !== 'customer_credit' || issued[0].amountInCents !== credit.originalAmountInCents || issued[0].saleId !== credit.originalSaleId) fail();
  }
  for (const movement of financial.creditMovements) {
    if (!movement.saleId) fail();
    const sale = saleFor(movement.saleId!); checkSession(movement.cashSessionId);
    if (movement.type === 'restored' && sale.status !== 'cancelled') fail();
    if (movement.type !== 'issued') {
      const tendered = sale.payments.filter((payment) => payment.method === 'customer_credit' && payment.customerCreditId === movement.creditId).reduce((total, payment) => total + payment.amountInCents, 0);
      const redeemed = financial.creditMovements.filter((item) => item.saleId === sale.id && item.creditId === movement.creditId && item.type === 'redeemed').reduce((total, item) => total + item.amountInCents, 0);
      const restored = financial.creditMovements.filter((item) => item.saleId === sale.id && item.creditId === movement.creditId && item.type === 'restored').reduce((total, item) => total + item.amountInCents, 0);
      if (redeemed !== tendered || restored > redeemed) fail();
    }
    if (movement.type === 'issued' && !financial.refunds.some((refund) => refund.id === movement.refundId && refund.creditId === movement.creditId && refund.amountInCents === movement.amountInCents)) fail();
  }
  for (const reservation of financial.creditReservations) { /* a pre-sale reservation can survive interrupted storage */
    if (!reservation.saleId) fail();
  }
  for (const sale of sales) {
    try { getReturnedLineQuantities(sale, financial); } catch { fail(); }
    if (getSaleResolvedAmount(sale.id, financial) > getSaleEligibleAmount(sale, financial)) fail();
    for (const id of new Set(sale.payments.filter((item) => item.method === 'customer_credit').map((item) => item.customerCreditId!))) {
      if (!financial.credits.some((credit) => credit.id === id)) fail();
      const tendered = sale.payments.filter((item) => item.customerCreditId === id).reduce((total, item) => total + item.amountInCents, 0);
      const redeemed = financial.creditMovements.filter((item) => item.saleId === sale.id && item.creditId === id && item.type === 'redeemed').reduce((total, item) => total + item.amountInCents, 0);
      const reserved = financial.creditReservations.filter((item) => item.saleId === sale.id && item.creditId === id).reduce((total, item) => total + item.amountInCents, 0);
      if (redeemed + reserved !== tendered || (redeemed > 0 && reserved > 0)) fail();
    }
  }
}
