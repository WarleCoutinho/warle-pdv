import type { PdvRepositories, ChangeTopic } from '../contracts';
import * as products from '../../services/productStorage';
import * as settings from '../../services/settingsStorage';
import * as operators from '../../services/operatorAccess';
import * as sales from '../../services/saleStorage';
import * as cash from '../../services/cashStorage';
import * as financial from '../../services/saleFinancialStorage';
import * as backups from '../../services/backupStorage';
import { loadDraftCart, CART_STORAGE_KEY } from '../../services/cartStorage';
import { clearLocalData } from '../../services/localDataMaintenance';
import { withFinancialLock } from '../../services/financialLock';
const keys: Record<ChangeTopic, string> = { products: products.PRODUCTS_STORAGE_KEY, settings: settings.SETTINGS_STORAGE_KEY, operator: operators.OPERATOR_SESSION_KEY, sales: sales.SALES_STORAGE_KEY, financial: financial.FINANCIAL_STORAGE_KEY, cash: cash.CASH_STORAGE_KEY, draft: CART_STORAGE_KEY };
const notify = () => { if (typeof window !== 'undefined') window.dispatchEvent(new Event('raiz-pdv:data-changed')); };
export function createWebRepositories(): PdvRepositories {
  let draftQueue: Promise<void> = Promise.resolve();
  return {
    products: { list: async () => products.loadProducts(), replaceCatalog: async (items) => { products.saveProducts(items); } },
    settings: {
      load: async () => settings.initializeOperatorAccess(),
      save: async (input, passwords = {}) => {
        operators.requireAdministrator();
        const accounts = await Promise.all((input.operators ?? []).map(async (account) => ({ ...account, ...(passwords[account.id] ? { passwordDigest: await operators.createPasswordDigest(passwords[account.id]) } : {}) })));
        const saved = await withFinancialLock(() => settings.saveSettings({ ...input, operators: accounts }));
        notify(); return saved;
      },
    },
    operators: { list: async () => settings.loadSettings().operators ?? [], current: async () => operators.getCurrentOperator(), login: operators.loginOperator, logout: async () => { operators.logoutOperator(); }, hasDefaultPassword: async () => operators.withDefaultAdmin(settings.loadSettings().operators).some((item) => item.role === 'admin' && item.passwordDigest === operators.DEFAULT_ADMIN.passwordDigest) },
    sales: { list: async () => sales.listSales(), getById: async (id) => sales.getSaleById(id) ?? null, complete: async (input) => {
      const save = input.payments.some((payment) => payment.method === 'customer_credit') ? sales.saveCompletedSaleWithCustomerCredit : sales.saveCompletedSale;
      return save(input.items, input.totalInCents, input.payments, input.cashSessionId);
    }, cancel: sales.cancelSaleAndRestoreCustomerCredit },
    cash: {
      read: async () => cash.loadCashData(),
      open: async (amount, operatorId) => { const result = await cash.openCashSession(amount, operatorId); notify(); return result; },
      move: async (sessionId, type, amount, description) => { const result = await cash.addCashMovement(sessionId, type, amount, description); notify(); return result; },
      close: async (sessionId, counts, fingerprint) => { const result = await cash.closeCashSession(sessionId, counts, fingerprint); notify(); return result; },
    },
    financial: { snapshot: async () => withFinancialLock(() => ({ sales: sales.listSales(), cash: cash.loadCashData(), financial: financial.loadSaleFinancialData() })), recordReturn: financial.recordMerchandiseReturn, settle: financial.settleSaleBalance, updateRefund: financial.updatePendingRefund, recover: financial.recoverCreditReservations },
    credits: { search: async (query) => financial.searchCustomerCredits(query), authenticate: async (query, code) => code ? financial.lookupCustomerCredit(query, code) : undefined },
    draft: { load: async (catalog) => { await draftQueue.catch(() => {}); localStorage.getItem(CART_STORAGE_KEY); return loadDraftCart(catalog); }, save: async (items) => {
      const serialized = JSON.stringify(items.map((item) => ({ productId: item.product.id, quantity: item.quantity, unitPriceInCents: item.unitPriceInCents })));
      const operation = draftQueue.catch(() => {}).then(() => { localStorage.setItem(CART_STORAGE_KEY, serialized); });
      draftQueue = operation; return operation;
    } },
    backups: { exportJson: async () => withFinancialLock(backups.createBackupJson), validateJson: async (contents) => backups.parseBackupJson(contents), import: async (backup) => { await draftQueue.catch(() => {}); await backups.restoreBackup(backup); }, safetyCopy: async () => backups.getRestoreSafetyCopy(), clearLocalData: async () => { await draftQueue.catch(() => {}); await withFinancialLock(() => { operators.requireAdministrator(); clearLocalData(); }); } },
    changes: { subscribe: (topics, listener) => {
      const storage = (event: StorageEvent) => { if (event.key === null || topics.some((topic) => keys[topic] === event.key)) listener(); };
      window.addEventListener('storage', storage); window.addEventListener('focus', listener);
      const events = [...new Set(topics.map((topic) => topic === 'products' ? 'raiz-pdv:products-changed' : 'raiz-pdv:data-changed'))];
      events.forEach((event) => window.addEventListener(event, listener));
      return () => { window.removeEventListener('storage', storage); window.removeEventListener('focus', listener); events.forEach((event) => window.removeEventListener(event, listener)); };
    } },
  };
}
