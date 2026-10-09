import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

class MemoryStorage {
  data = new Map();
  failWrites = false;
  getItem(key) { return this.data.has(key) ? this.data.get(key) : null; }
  setItem(key, value) {
    if (this.failWrites) throw new Error('quota');
    this.data.set(key, String(value));
  }
  removeItem(key) { this.data.delete(key); }
  clear() { this.data.clear(); this.failWrites = false; }
}
globalThis.localStorage = new MemoryStorage();
globalThis.sessionStorage = new MemoryStorage();

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true, hmr: false }, appType: 'custom' });
const cash = await vite.ssrLoadModule('/src/utils/cash.ts');
const storage = await vite.ssrLoadModule('/src/services/cashStorage.ts');
const saleStorage = await vite.ssrLoadModule('/src/services/saleStorage.ts');
const settingsStorage = await vite.ssrLoadModule('/src/services/settingsStorage.ts');
const backupStorage = await vite.ssrLoadModule('/src/services/backupStorage.ts');
const access = await vite.ssrLoadModule('/src/services/operatorAccess.ts');
const adminAuth = () => sessionStorage.setItem(access.OPERATOR_SESSION_KEY, JSON.stringify({ id: access.DEFAULT_ADMIN.id, credential: access.DEFAULT_ADMIN.passwordDigest }));
const operatorAuth = (id) => sessionStorage.setItem(access.OPERATOR_SESSION_KEY, JSON.stringify({ id, credential: access.DEFAULT_ADMIN.passwordDigest }));
after(() => vite.close());
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); operatorAuth('operator-a'); localStorage.setItem('raiz-pdv:settings', JSON.stringify({ storeName: 'Teste', address: '', phone: '', receiptFooter: '', operators: [{ id: 'operator-a', name: 'Ana', active: true, passwordDigest: access.DEFAULT_ADMIN.passwordDigest }, { id: 'operator-b', name: 'Bruno', active: true, passwordDigest: access.DEFAULT_ADMIN.passwordDigest }] })); });

const opened = (openingAmountInCents = 0, id = 'session-1') => ({ id, openedAt: '2026-10-08T10:00:00.000Z', openingAmountInCents, status: 'open' });
const payment = (method, amountInCents, extras = {}) => ({ method, amountInCents, ...extras });
const sale = (method, amountInCents, overrides = {}) => ({
  id: 'sale-1', number: 1, date: '2026-10-08T11:00:00.000Z', cashSessionId: 'session-1',
  status: 'completed', items: [], totalInCents: amountInCents, payments: [payment(method, amountInCents)], ...overrides,
});
const draft = (sales = [], movements = [], session = opened()) => cash.getCashReconciliationDraft(session, movements, sales);

for (const method of ['cash', 'pix', 'debit', 'credit']) {
  test('Apura corretamente venda somente em ' + method, () => {
    const result = draft([sale(method, 1250)]);
    assert.equal(result.paymentTotalsInCents[method], 1250);
    assert.equal(result.expectedByMethodInCents[method], method === 'cash' ? 1250 : 1250);
    assert.equal(result.totalNetSalesInCents, 1250);
  });
}

test('Distribui pagamento misto exclusivamente pelas modalidades', () => {
  const result = draft([sale('cash', 5000, { payments: [payment('cash', 2000, { amountReceivedInCents: 3000, changeInCents: 1000 }), payment('pix', 3000)] })]);
  assert.deepEqual(result.paymentTotalsInCents, { cash: 2000, pix: 3000, debit: 0, credit: 0 });
  assert.deepEqual(result.expectedByMethodInCents, { cash: 2000, pix: 3000, debit: 0, credit: 0 });
});

test('Troco não infla recebimento em dinheiro', () => {
  const result = draft([sale('cash', 2000, { payments: [payment('cash', 2000, { amountReceivedInCents: 3000, changeInCents: 1000 })] })]);
  assert.equal(result.paymentTotalsInCents.cash, 2000);
  assert.equal(result.expectedByMethodInCents.cash, 2000);
});

test('Fundo inicial, suprimento e sangria alteram somente o dinheiro físico', () => {
  const movements = [
    { id: 's', cashSessionId: 'session-1', type: 'supply', amountInCents: 5000, createdAt: '2026-10-08T12:00:00Z' },
    { id: 'w', cashSessionId: 'session-1', type: 'withdrawal', amountInCents: 1200, createdAt: '2026-10-08T13:00:00Z' },
  ];
  const result = draft([sale('cash', 3000), sale('pix', 8000, { id: 'sale-2', payments: [payment('pix', 8000)] })], movements, opened(10000));
  assert.equal(result.cashSummary.expectedInCents, 16800);
  assert.equal(result.expectedByMethodInCents.pix, 8000);
  assert.equal(result.totalNetSalesInCents, 11000);
});

test('Conferência sem diferença e com zero válido', () => {
  const d = draft([]);
  const result = cash.createCashReconciliation(d, { cash: 0, pix: 0, debit: 0, credit: 0 });
  assert.equal(result.methods.cash.differenceInCents, 0);
  assert.equal(result.methods.pix.countedInCents, 0);
});
test('Registra falta', () => {
  const result = cash.createCashReconciliation(draft([sale('pix', 1000)]), { cash: 0, pix: 700, debit: 0, credit: 0 });
  assert.equal(result.methods.pix.differenceInCents, -300);
});
test('Registra sobra', () => {
  const result = cash.createCashReconciliation(draft([sale('debit', 1000)]), { cash: 0, pix: 0, debit: 1500, credit: 0 });
  assert.equal(result.methods.debit.differenceInCents, 500);
});
test('Mantém divergências simultâneas separadas', () => {
  const result = cash.createCashReconciliation(draft([sale('pix', 1000), sale('credit', 2000, { id: 'sale-2', payments: [payment('credit', 2000)] })]), { cash: 0, pix: 800, debit: 0, credit: 2300 });
  assert.equal(result.methods.pix.differenceInCents, -200);
  assert.equal(result.methods.credit.differenceInCents, 300);
});
test('Venda cancelada sem pagamentos registrados não cria recebimento', () => {
  const result = draft([sale('cash', 5000, { status: 'cancelled', payments: [] })]);
  assert.equal(result.paymentTotalsInCents.cash, 0);
  assert.equal(result.totalNetSalesInCents, 0);
});
test('Cancelamento sem evento de estorno mantém pagamentos registrados e exclui venda do líquido', () => {
  const result = draft([sale('cash', 2500, { status: 'cancelled' })]);
  assert.equal(result.paymentTotalsInCents.cash, 2500);
  assert.equal(result.totalNetSalesInCents, 0);
});
test('Estorno pendente/concluído ou realizado em sessão posterior não é inferido sem modelo de estornos', () => {
  const cancelled = sale('pix', 4200, { status: 'cancelled' });
  const result = draft([cancelled]);
  assert.equal(result.paymentTotalsInCents.pix, 4200);
  assert.equal(result.expectedByMethodInCents.pix, 4200);
});
test('Sessão sem vendas apura saldo inicial e movimentações sem faturamento', () => {
  const result = draft([], [], opened(5000));
  assert.equal(result.totalNetSalesInCents, 0);
  assert.equal(result.expectedByMethodInCents.cash, 5000);
});

test('Fecha uma única vez e salva snapshot imutável com quatro conferências', () => {
  const first = storage.openCashSession(1000, 'operator-a');
  const session = first.sessions[0];
  const d = cash.getCashReconciliationDraft(session, first.movements, []);
  const closed = storage.closeCashSession(session.id, { cash: 1000, pix: 0, debit: 0, credit: 0 }, d.sourceFingerprint);
  assert.equal(closed.sessions[0].reconciliation.methods.cash.countedInCents, 1000);
  assert.ok(closed.sessions[0].closedAt);
  assert.throws(() => storage.closeCashSession(session.id, { cash: 1000, pix: 0, debit: 0, credit: 0 }, d.sourceFingerprint), /fechado|aberto/);
});
test('Exige nova revisão se os dados de origem mudam', () => {
  const openedData = storage.openCashSession(0, 'operator-a');
  const session = openedData.sessions[0];
  assert.throws(() => storage.closeCashSession(session.id, { cash: 0, pix: 0, debit: 0, credit: 0 }, 'stale'), /mudaram/);
  assert.equal(storage.getOpenCashSession(storage.loadCashData()).id, session.id);
});
test('Revalida as vendas salvas imediatamente antes de fechar', () => {
  const openedData = storage.openCashSession(0, 'operator-a'), session = openedData.sessions[0];
  const reviewed = cash.getCashReconciliationDraft(session, [], []);
  const changedSale = sale('pix', 500, { cashSessionId: session.id, items: [{ productId: 'p1', productName: 'Produto', unitPriceInCents: 500, quantity: 1, subtotalInCents: 500 }] });
  localStorage.setItem('raiz-pdv:completed-sales', JSON.stringify([changedSale]));
  assert.throws(() => storage.closeCashSession(session.id, { cash: 0, pix: 0, debit: 0, credit: 0 }, reviewed.sourceFingerprint), /mudaram/);
  assert.equal(storage.getOpenCashSession(storage.loadCashData()).id, session.id);
});
test('Falha de gravação não fecha a sessão', () => {
  const openedData = storage.openCashSession(0, 'operator-a');
  const session = openedData.sessions[0], d = cash.getCashReconciliationDraft(session, [], []);
  localStorage.failWrites = true;
  assert.throws(() => storage.closeCashSession(session.id, { cash: 0, pix: 0, debit: 0, credit: 0 }, d.sourceFingerprint), /armazenamento local/);
  localStorage.failWrites = false;
  assert.equal(storage.getOpenCashSession(storage.loadCashData()).id, session.id);
});
test('Dados de vendas inválidos bloqueiam fechamento', () => {
  const openedData = storage.openCashSession(0, 'operator-a'), session = openedData.sessions[0];
  const d = cash.getCashReconciliationDraft(session, [], []);
  localStorage.setItem('raiz-pdv:completed-sales', '{');
  assert.throws(() => storage.closeCashSession(session.id, { cash: 0, pix: 0, debit: 0, credit: 0 }, d.sourceFingerprint));
  assert.equal(storage.getOpenCashSession(storage.loadCashData()).id, session.id);
});
test('Histórico legado sem reconciliação eletrônica continua carregável', () => {
  localStorage.setItem('raiz-pdv:cash', JSON.stringify({
    sessions: [{ id: 'old', openedAt: '2025-01-01T10:00:00.000Z', openingAmountInCents: 2000, closedAt: '2025-01-01T18:00:00.000Z', countedAmountInCents: 2700, expectedAmountInCents: 2500, differenceInCents: 200, status: 'closed' }],
    movements: [],
  }));
  assert.equal(storage.loadCashData().sessions[0].reconciliation, undefined);
});
test('Rejeita valores de conferência negativos ou não inteiros seguros', () => {
  assert.throws(() => cash.createCashReconciliation(draft([]), { cash: -1, pix: 0, debit: 0, credit: 0 }));
  assert.throws(() => cash.createCashReconciliation(draft([]), { cash: Number.MAX_SAFE_INTEGER + 1, pix: 0, debit: 0, credit: 0 }));
});


test('Entrada exige operador ativo e registra identidade e data; evita caixa duplicado', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-08T15:00:00Z') });
  assert.throws(() => storage.openCashSession(0), /operador ativo|operador que entrou|Entre/);
  assert.throws(() => storage.openCashSession(0, 'unknown'), /operador ativo|operador que entrou|Entre/);
  const next = storage.openCashSession(500, 'operator-a');
  const session = next.sessions[0];
  assert.equal(session.operatorName, 'Ana'); assert.equal(session.operatorId, 'operator-a');
  assert.equal(session.businessDate, '2026-10-08'); assert.equal(session.openedAt, '2026-10-08T15:00:00.000Z');
  operatorAuth('operator-b');
  assert.throws(() => storage.openCashSession(0, 'operator-b'), /Já existe/);
});

test('Virada de dia bloqueia operador pendente e venda antiga; outro operador pode abrir hoje', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-09T02:59:00Z') });
  const old = storage.openCashSession(1000, 'operator-a').sessions[0];
  t.mock.timers.tick(120000);
  assert.equal(storage.getOpenCashSession(storage.loadCashData()), undefined);
  assert.equal(storage.getPendingCashSessions(storage.loadCashData()).length, 1);
  assert.throws(() => storage.openCashSession(0, 'operator-a'), /pendente/);
  assert.throws(() => storage.addCashMovement(old.id, 'supply', 100), /hoje/);
  const item = { product: { id: 'p', name: 'Produto', priceInCents: 100, category: 'Geral', active: true, emoji: 'X' }, quantity: 1, unitPriceInCents: 100, subtotalInCents: 100 };
  assert.throws(() => saleStorage.saveCompletedSale([item], 100, [{ method: 'pix', amountInCents: 100 }], old.id), /hoje/);
  operatorAuth('operator-b');
  const current = storage.openCashSession(500, 'operator-b').sessions[0];
  assert.equal(current.businessDate, '2026-10-09'); assert.equal(current.operatorName, 'Bruno');
  const sale = saleStorage.saveCompletedSale([item], 100, [{ method: 'pix', amountInCents: 100 }], current.id);
  assert.equal(sale.cashSessionId, current.id);
  const priorDraft = cash.getCashReconciliationDraft(old, [], saleStorage.listSales());
  assert.equal(priorDraft.saleCount, 0); assert.equal(priorDraft.expectedByMethodInCents.pix, 0);
  adminAuth();
  const closed = storage.closeCashSession(old.id, priorDraft.expectedByMethodInCents, priorDraft.sourceFingerprint);
  assert.equal(closed.sessions.find((session) => session.id === old.id).closedAt, '2026-10-09T03:01:00.000Z');
  assert.equal(storage.getOpenCashSession(closed).id, current.id);
});

test('Fechar pendência libera o mesmo operador sem alterar sessões ou vendas anteriores', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-08T15:00:00Z') });
  const old = storage.openCashSession(1000, 'operator-a').sessions[0];
  t.mock.timers.tick(86400000);
  const priorDraft = cash.getCashReconciliationDraft(old, [], []);
  storage.closeCashSession(old.id, priorDraft.expectedByMethodInCents, priorDraft.sourceFingerprint);
  const next = storage.openCashSession(2000, 'operator-a');
  assert.equal(next.sessions[0].businessDate, '2026-10-09');
  assert.equal(next.sessions[1].openingAmountInCents, 1000);
  assert.equal(next.sessions[1].status, 'closed');
});

test('Caixa legado pendente sem operador continua fechável e não recebe identidade inventada', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-09T15:00:00Z') });
  localStorage.setItem(storage.CASH_STORAGE_KEY, JSON.stringify({ sessions: [opened()], movements: [] }));
  operatorAuth('operator-b');
  assert.throws(() => storage.openCashSession(0, 'operator-b'), /sem operador/);
  adminAuth();
  const priorDraft = draft();
  const next = storage.closeCashSession('session-1', priorDraft.expectedByMethodInCents, priorDraft.sourceFingerprint);
  assert.equal(next.sessions[0].operatorId, undefined);
  assert.equal(next.sessions[0].status, 'closed');
});

test('Backup inclui operadores e caixas pendentes/atuais sem misturar ou reconstruir histórico', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-08T15:00:00Z') });
  storage.openCashSession(1000, 'operator-a'); t.mock.timers.tick(86400000); operatorAuth('operator-b'); storage.openCashSession(2000, 'operator-b');
  const backup = backupStorage.parseBackupJson(backupStorage.createBackupJson()).backup;
  assert.equal(backup.data.settings.operators.length, 2);
  assert.equal(backup.data.cash.sessions.length, 2);
  assert.equal(backup.data.cash.sessions[0].operatorName, 'Bruno');
  adminAuth();
  backupStorage.restoreBackup(backup);
  assert.equal(storage.getPendingCashSessions(storage.loadCashData()).length, 1);
});

test('Cadastro rejeita operadores duplicados e operador inativo não abre caixa', () => {
  adminAuth();
  const settings = settingsStorage.loadSettings();
  assert.throws(() => settingsStorage.saveSettings({ ...settings, operators: [...settings.operators, { id: 'c', name: 'Ana', active: true, passwordDigest: access.DEFAULT_ADMIN.passwordDigest }] }), /válido/);
  settingsStorage.saveSettings({ ...settings, operators: settings.operators.map((operator) => ({ ...operator, active: false })) });
  assert.throws(() => storage.openCashSession(0, 'operator-a'), /operador ativo|operador que entrou|Entre/);
});


test('Admin padrão autentica com 123456; senha incorreta não cria sessão', async () => {
  sessionStorage.clear();
  await assert.rejects(() => access.loginOperator('Admin', 'wrong'), /incorretos/);
  assert.equal(access.getCurrentOperator(), null);
  const admin = await access.loginOperator('admin', '123456');
  assert.equal(admin.role, 'admin');
  assert.equal(access.getCurrentOperator().id, 'raiz-admin');
  access.logoutOperator(); assert.equal(access.getCurrentOperator(), null);
});

test('Operador autenticado não cadastra usuários nem abre caixa no nome de outro', () => {
  assert.throws(() => settingsStorage.saveSettings(settingsStorage.loadSettings()), /administrador/);
  assert.throws(() => storage.openCashSession(0, 'operator-b'), /operador que entrou/);
  sessionStorage.clear(); assert.throws(() => storage.openCashSession(0, 'operator-a'), /Entre/);
});

test('Senha personalizada protegida invalida sessão antiga e aceita só a nova senha', async () => {
  adminAuth();
  const settings = settingsStorage.loadSettings();
  const digest = await access.createPasswordDigest('novaSenha123');
  const saved = settingsStorage.saveSettings({ ...settings, operators: [{ ...access.DEFAULT_ADMIN, passwordDigest: digest }, ...settings.operators] });
  assert.equal(access.getCurrentOperator(), null);
  assert.equal(JSON.stringify(saved).includes('novaSenha123'), false);
  await assert.rejects(() => access.loginOperator('Admin', '123456'), /incorretos/);
  await access.loginOperator('Admin', 'novaSenha123');
  assert.equal(access.getCurrentOperator().role, 'admin');
});

test('Administrador não pode ser desativado como último administrador; migração mantém operadores', () => {
  adminAuth();
  const initialized = settingsStorage.initializeOperatorAccess();
  assert.equal(initialized.operators.find((operator) => operator.id === 'operator-a').name, 'Ana');
  assert.equal(initialized.operators.filter((operator) => operator.role === 'admin').length, 1);
  assert.throws(() => settingsStorage.saveSettings({ ...initialized, operators: initialized.operators.map((operator) => operator.role === 'admin' ? { ...operator, active: false } : operator) }), /válidos|administrador/);
});

test('Operador inativo não entra; senha curta e usuários repetidos são rejeitados', async () => {
  adminAuth();
  const settings = settingsStorage.initializeOperatorAccess();
  settingsStorage.saveSettings({ ...settings, operators: settings.operators.map((operator) => operator.id === 'operator-a' ? { ...operator, active: false } : operator) });
  await assert.rejects(() => access.loginOperator('Ana', '123456'), /incorretos/);
  await assert.rejects(() => access.createPasswordDigest('123'), /6 a 128/);
  assert.throws(() => settingsStorage.saveSettings({ ...settings, operators: [...settings.operators, { id: 'x', name: 'Outro', username: 'admin', active: true }] }), /válidos/);
});
