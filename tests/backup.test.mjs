import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

class MemoryStorage {
  data = new Map();
  failKeyOnce = null;
  getItem(key) { return this.data.has(key) ? this.data.get(key) : null; }
  setItem(key, value) {
    if (this.failKeyOnce === key) { this.failKeyOnce = null; throw new Error('quota'); }
    this.data.set(key, String(value));
  }
  removeItem(key) { this.data.delete(key); }
  clear() { this.data.clear(); this.failKeyOnce = null; }
}
globalThis.localStorage = new MemoryStorage();
globalThis.sessionStorage = new MemoryStorage();
const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true, hmr: false }, appType: 'custom' });
const backupService = await vite.ssrLoadModule('/src/services/backupStorage.ts');
const cash = await vite.ssrLoadModule('/src/utils/cash.ts');
const keyboard = await vite.ssrLoadModule('/src/utils/keyboardNavigation.ts');
const keys = {
  products: 'raiz-pdv:products', settings: 'raiz-pdv:settings', sales: 'raiz-pdv:completed-sales',
  cash: 'raiz-pdv:cash', financial: 'raiz-pdv:sale-financial-data', cart: 'raiz-pdv:draft-cart', safety: 'raiz-pdv:restore-safety-backup',
};
const access = await vite.ssrLoadModule('/src/services/operatorAccess.ts');
const adminAuth = () => sessionStorage.setItem(access.OPERATOR_SESSION_KEY, JSON.stringify({ id: access.DEFAULT_ADMIN.id, credential: access.DEFAULT_ADMIN.passwordDigest }));
const operatorAuth = (id) => sessionStorage.setItem(access.OPERATOR_SESSION_KEY, JSON.stringify({ id, credential: access.DEFAULT_ADMIN.passwordDigest }));
after(() => vite.close());
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); adminAuth(); });

const product = (id, name) => ({ id, name, priceInCents: 500, category: 'Bebidas', active: true, emoji: '🥤' });
const settings = (storeName) => ({ storeName, address: '', phone: '', receiptFooter: 'Obrigado!' });
const closedFinancialData = () => {
  const session = { id: 'session-a', openedAt: '2026-10-08T10:00:00.000Z', openingAmountInCents: 1000, status: 'open' };
  const cancelledSale = {
    id: 'sale-a', number: 1, date: '2026-10-08T11:00:00.000Z', cashSessionId: session.id,
    status: 'cancelled', cancelledAt: '2026-10-08T11:10:00.000Z', cancellationReason: 'customer_cancelled',
    items: [{ productId: 'p1', productName: 'Água', unitPriceInCents: 500, quantity: 1, subtotalInCents: 500 }],
    totalInCents: 500, payments: [{ method: 'pix', amountInCents: 500 }],
  };
  const draft = cash.getCashReconciliationDraft(session, [], [cancelledSale]);
  const reconciliation = cash.createCashReconciliation(draft, { cash: 1000, pix: 500, debit: 0, credit: 0 });
  const closedSession = {
    ...session, status: 'closed', closedAt: '2026-10-08T12:00:00.000Z', countedAmountInCents: 1000,
    expectedAmountInCents: 1000, differenceInCents: 0, reconciliation,
  };
  return { sales: [cancelledSale], cash: { sessions: [closedSession], movements: [] } };
};
function setData(data) {
  localStorage.setItem(keys.products, JSON.stringify(data.products));
  localStorage.setItem(keys.settings, JSON.stringify(data.settings));
  localStorage.setItem(keys.sales, JSON.stringify(data.sales));
  localStorage.setItem(keys.cash, JSON.stringify(data.cash));
  localStorage.setItem(keys.financial, JSON.stringify({ returns: [], refunds: [], credits: [], creditMovements: [], creditReservations: [] }));
}
function dataSet(name) {
  const financial = closedFinancialData();
  return { products: [product('p1', name)], settings: settings(name), ...financial };
}

test('Exporta versão, data, dados financeiros e não inclui o carrinho temporário', () => {
  const data = dataSet('Loja atual');
  setData(data);
  localStorage.setItem(keys.cart, '[{"rascunho":true}]');
  const raw = backupService.createBackupJson();
  const parsed = backupService.parseBackupJson(raw);
  assert.equal(parsed.backup.version, 2);
  assert.ok(Number.isFinite(Date.parse(parsed.backup.exportedAt)));
  assert.equal(parsed.summary.products, 1);
  assert.equal(parsed.summary.cancelledSales, 1);
  assert.equal(parsed.summary.closedSessions, 1);
  assert.equal(parsed.backup.data.cash.sessions[0].reconciliation.methods.pix.countedInCents, 500);
  assert.equal(Object.hasOwn(parsed.backup.data, 'cart'), false);
  assert.deepEqual(parsed.backup.data.financial.credits, []);
});

test('Restaura arquivo válido com cópia de segurança e remove o carrinho antigo', () => {
  const incoming = dataSet('Loja do backup');
  setData(incoming);
  const candidate = backupService.parseBackupJson(backupService.createBackupJson()).backup;
  const old = { ...dataSet('Loja antes'), sales: [], cash: { sessions: [], movements: [] } };
  setData(old);
  localStorage.setItem(keys.cart, 'rascunho');
  backupService.restoreBackup(candidate);
  assert.deepEqual(JSON.parse(localStorage.getItem(keys.products)), incoming.products);
  assert.deepEqual(JSON.parse(localStorage.getItem(keys.settings)), incoming.settings);
  assert.deepEqual(JSON.parse(localStorage.getItem(keys.sales)), incoming.sales);
  assert.deepEqual(JSON.parse(localStorage.getItem(keys.cash)).sessions[0].reconciliation, incoming.cash.sessions[0].reconciliation);
  assert.deepEqual(JSON.parse(localStorage.getItem(keys.financial)), { returns: [], refunds: [], credits: [], creditMovements: [], creditReservations: [] });
  assert.equal(localStorage.getItem(keys.cart), null);
  assert.equal(backupService.parseBackupJson(localStorage.getItem(keys.safety)).backup.data.settings.storeName, 'Loja antes');
});

test('Rejeita JSON inválido, versão incompatível, checksum incorreto e registro inválido', () => {
  assert.throws(() => backupService.parseBackupJson('{'), /JSON válido/);
  const data = dataSet('Loja');
  setData(data);
  const valid = JSON.parse(backupService.createBackupJson());
  assert.throws(() => backupService.parseBackupJson(JSON.stringify({ ...valid, version: 3 })), /incompatível/);
  assert.throws(() => backupService.parseBackupJson(JSON.stringify({ ...valid, integrity: { ...valid.integrity, checksum: '00000000' } })), /integridade falhou/);
  valid.data.products = [{ id: '', name: '', priceInCents: -1 }];
  assert.throws(() => backupService.parseBackupJson(JSON.stringify(valid)), /lista de produtos do backup é inválida/);
});

test('Falha durante a gravação reverte todos os dados e conserva a cópia anterior', () => {
  setData(dataSet('Backup recebido'));
  const incoming = backupService.parseBackupJson(backupService.createBackupJson()).backup;
  const old = { ...dataSet('Loja preservada'), sales: [], cash: { sessions: [], movements: [] } };
  setData(old);
  localStorage.setItem(keys.cart, 'carrinho-preservado');
  const rawBefore = new Map([keys.products, keys.settings, keys.sales, keys.cash, keys.financial, keys.cart].map((key) => [key, localStorage.getItem(key)]));
  localStorage.failKeyOnce = keys.sales;
  assert.throws(() => backupService.restoreBackup(incoming), /dados anteriores foram preservados/);
  for (const [key, value] of rawBefore) assert.equal(localStorage.getItem(key), value, `valor original da chave ${key}`);
  assert.equal(backupService.parseBackupJson(localStorage.getItem(keys.safety)).backup.data.settings.storeName, 'Loja preservada');
});


test('Navegação de opções com setas percorre e envolve lista de resultados/formas de pagamento', () => {
  assert.equal(keyboard.getNextWrappedIndex(-1, 1, 3), 0);
  assert.equal(keyboard.getNextWrappedIndex(0, -1, 3), 2);
  assert.equal(keyboard.getNextWrappedIndex(2, 1, 3), 0);
  assert.equal(keyboard.getNextWrappedIndex(0, -1, 0), -1);
});

test('Navegação de itens do carrinho não ultrapassa o primeiro ou último item', () => {
  assert.equal(keyboard.getAdjacentIndex(0, -1, 3), -1);
  assert.equal(keyboard.getAdjacentIndex(0, 1, 3), 1);
  assert.equal(keyboard.getAdjacentIndex(2, 1, 3), -1);
});


test('Permite reparar um conjunto local corrompido após guardar os valores brutos anteriores', () => {
  setData({ ...dataSet('Antes da corrupção'), sales: [], cash: { sessions: [], movements: [] } });
  const incoming = backupService.parseBackupJson(backupService.createBackupJson()).backup;
  localStorage.setItem(keys.sales, '{json quebrado');
  backupService.restoreBackup(incoming);
  const safety = JSON.parse(localStorage.getItem(keys.safety));
  assert.equal(safety.format, 'raiz-pdv-recovery-snapshot');
  assert.equal(safety.storage[keys.sales], '{json quebrado');
  assert.deepEqual(JSON.parse(localStorage.getItem(keys.products)), incoming.data.products);
});

test('Se não for possível gravar a cópia prévia, não inicia a restauração', () => {
  setData({ ...dataSet('Antes'), sales: [], cash: { sessions: [], movements: [] } });
  const incoming = backupService.parseBackupJson(backupService.createBackupJson()).backup;
  const oldProducts = localStorage.getItem(keys.products);
  localStorage.failKeyOnce = keys.safety;
  assert.throws(() => backupService.restoreBackup(incoming), /cópia de segurança dos dados atuais/);
  assert.equal(localStorage.getItem(keys.products), oldProducts);
});


function recalculate(document) {
  let hash = 0x811c9dc5;
  const text = JSON.stringify(document.data);
  for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 0x01000193); }
  document.integrity.checksum = (hash >>> 0).toString(16).padStart(8, '0');
  return JSON.stringify(document);
}

test('Backup v1 permanece compatível sem inventar ledger histórico', () => {
  setData(dataSet('Legado'));
  const document = JSON.parse(backupService.createBackupJson());
  document.version = 1; delete document.data.financial;
  const parsed = backupService.parseBackupJson(recalculate(document));
  assert.deepEqual(parsed.backup.data.financial, { returns: [], refunds: [], credits: [], creditMovements: [], creditReservations: [] });
  assert.equal(parsed.backup.data.sales[0].payments[0].capturedAt, undefined);
});

test('Rejeita evento órfão ou compensação excessiva mesmo com checksum válido', () => {
  setData(dataSet('Loja'));
  const document = JSON.parse(backupService.createBackupJson());
  document.data.financial.refunds.push({ id: 'refund', saleId: 'unknown', saleNumber: 1, method: 'pix', amountInCents: 100, status: 'pending', createdAt: '2026-10-08T11:00:00.000Z' });
  assert.throws(() => backupService.parseBackupJson(recalculate(document)), /relações/);
  document.data.financial.refunds[0].saleId = 'sale-a';
  document.data.financial.refunds[0].amountInCents = 501;
  assert.throws(() => backupService.parseBackupJson(recalculate(document)), /relações/);
});

test('Falha ao gravar ledger durante restauração reverte todas as chaves', () => {
  setData(dataSet('Recebido'));
  const incoming = backupService.parseBackupJson(backupService.createBackupJson()).backup;
  setData(dataSet('Anterior'));
  const before = new Map([keys.products, keys.settings, keys.sales, keys.cash, keys.financial].map((key) => [key, localStorage.getItem(key)]));
  localStorage.failKeyOnce = keys.financial;
  assert.throws(() => backupService.restoreBackup(incoming), /dados anteriores foram preservados/);
  for (const [key, raw] of before) assert.equal(localStorage.getItem(key), raw);
});
