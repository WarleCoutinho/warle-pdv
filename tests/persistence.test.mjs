import test, { beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createServer } from 'vite';
class Storage {
  data = new Map(); failure = null; plan = new Map();
  getItem(key) { return this.data.get(key) ?? null; }
  setItem(key, value) { const positions = this.plan.get(key); if (positions && positions.includes(++positions.count)) throw new Error('quota'); if (this.failure === key) { this.failure = null; throw new Error('quota'); } this.data.set(key, String(value)); }
  removeItem(key) { this.data.delete(key); }
  reset() { this.data.clear(); this.failure = null; this.plan.clear(); }
}
globalThis.localStorage = new Storage(); globalThis.sessionStorage = new Storage();
let tail = Promise.resolve();
const locks = { request: (_key, _options, callback) => { const operation = tail.then(callback); tail = operation.catch(() => {}); return operation; } };
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks } });
const events = new EventTarget(); globalThis.window = events;
const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true, hmr: false }, appType: 'custom' });
const { createWebRepositories } = await vite.ssrLoadModule('/src/persistence/index.ts');
const { createPdvApplication } = await vite.ssrLoadModule('/src/application/createPdvApplication.ts');
const { getCashReconciliationDraft, getCashSummary } = await vite.ssrLoadModule('/src/domain/cash.ts');
const { getSaleEligibleAmount } = await vite.ssrLoadModule('/src/domain/financial.ts');
const { SaleCreditFinalizationPendingError } = await vite.ssrLoadModule('/src/domain/errors.ts');
let repos, app, session;
const product = { id: 'p', name: 'Produto', category: 'Categoria', emoji: 'X', priceInCents: 500, active: true };
const cart = (unitPrice = 500, quantity = 1) => [{ product: { ...product, priceInCents: unitPrice }, quantity, unitPriceInCents: unitPrice, subtotalInCents: unitPrice * quantity }];
const payment = (method, cents) => ({ method, amountInCents: cents, ...(method === 'cash' ? { amountReceivedInCents: cents, changeInCents: 0 } : {}) });
const complete = (cents = 500, payments = [payment('pix', cents)], quantity = 1) => app.completeSale({ items: cart(cents / quantity, quantity), totalInCents: cents, payments, cashSessionId: session.id });
const amounts = (method, cents) => ({ cash: 0, pix: 0, debit: 0, credit: 0, customer_credit: 0, [method]: cents });
async function issue(cents = 1500) {
  const sale = await complete(cents); await app.sales.cancel(sale.id, 'customer_cancelled');
  const result = await app.settle(sale, { amounts: amounts('customer_credit', cents) }); return result.issuedCredits[0];
}
after(() => vite.close());
beforeEach(async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-09T12:00:00Z') });
  localStorage.reset(); sessionStorage.reset(); navigator.locks = locks;
  repos = createWebRepositories(); app = createPdvApplication(repos);
  await app.products.replaceCatalog([product]); await app.settings.load();
  await app.operators.login('Admin', '123456');
  const data = await app.cash.open(10000, 'raiz-admin'); session = data.sessions[0];
});
test('Todos os agregados de consulta retornam Promise; composição aceita portas substituídas', async () => {
  for (const result of [repos.products.list(), repos.settings.load(), repos.operators.list(), repos.operators.current(), repos.sales.list(), repos.sales.getById('missing'), repos.cash.read(), repos.financial.snapshot(), repos.credits.search(''), repos.draft.load([product]), repos.backups.safetyCopy()]) { assert.ok(result instanceof Promise); await result; }
  const injected = createPdvApplication({ ...repos, products: { ...repos.products, list: async () => [] } });
  assert.deepEqual((await injected.bootstrap()).products, []); assert.equal(await repos.sales.getById('missing'), null);
});
test('Catálogo mantém imagem, categoria, ativação e notificação na mesma aba e entre abas', async () => {
  let changes = 0; const unsubscribe = repos.changes.subscribe(['products'], () => ++changes);
  await app.products.replaceCatalog([{ ...product, name: 'Novo', category: 'Outra', active: false, imageDataUrl: 'data:image/png;base64,aA==' }]);
  assert.equal((await app.products.list())[0].imageDataUrl, 'data:image/png;base64,aA=='); assert.equal(changes, 1);
  const event = new Event('storage'); Object.defineProperty(event, 'key', { value: 'raiz-pdv:products' }); window.dispatchEvent(event); assert.equal(changes, 2);
  unsubscribe(); window.dispatchEvent(event); assert.equal(changes, 2);
});
test('Configurações e cadastro verificam credenciais no adaptador e invalidam sessão após troca de senha', async () => {
  const settings = await app.settings.load();
  await app.settings.save({ ...settings, storeName: 'Loja', operators: [...settings.operators, { id: 'op', name: 'Vendedor', username: 'Venda', active: true, role: 'operator' }] }, { op: 'abcdef' });
  assert.equal((await app.settings.load()).storeName, 'Loja');
  assert.ok(!(localStorage.getItem('raiz-pdv:settings').includes('abcdef')));
  await app.operators.logout(); assert.equal(await app.operators.current(), null);
  await assert.rejects(() => app.operators.login('Venda', 'errada'), /senha|operador/i);
  assert.equal((await app.operators.login('Venda', 'abcdef')).id, 'op');
  await assert.rejects(() => app.settings.save(settings), /administrador/i);
  assert.equal(localStorage.getItem('raiz-pdv:operator-session'), null); assert.ok(sessionStorage.getItem('raiz-pdv:operator-session'));
  await app.operators.logout(); await app.operators.login('Admin', '123456');
  await app.settings.save(await app.settings.load(), { 'raiz-admin': 'nova123' });
  assert.equal(await app.operators.current(), null); await assert.rejects(() => app.operators.login('Admin', '123456'));
  assert.equal((await app.operators.login('Admin', 'nova123')).role, 'admin');
});
test('Venda simples grava linhas estáveis, pagamentos e numeração após a persistência', async () => {
  const sale = await complete(); assert.ok(sale.items[0].lineId); assert.equal(sale.number, 1); assert.equal((await app.sales.getById(sale.id)).totalInCents, 500);
});
test('Pagamento combinado mantém total aplicado e dinheiro físico sem troco', async () => {
  const sale = await complete(1500, [payment('cash', 500), payment('debit', 1000)]);
  const snapshot = await app.financial.snapshot(); const draft = getCashReconciliationDraft(session, snapshot.cash.movements, snapshot.sales, snapshot.financial);
  assert.equal(sale.payments.length, 2); assert.equal(draft.paymentTotalsInCents.cash, 500); assert.equal(draft.paymentTotalsInCents.debit, 1000); assert.equal(draft.netReceivedInCents, 1500);
});
test('Crédito exige autenticação pelo contrato; consulta não expõe verificador', async () => {
  const { credit, authCode } = await issue(); const payments = [{ method: 'customer_credit', amountInCents: 500, customerCreditId: credit.id }];
  assert.equal((await app.credits.search(credit.receiptNumber))[0].authCodeHash, undefined);
  await assert.rejects(() => complete(500, payments), /autorização/);
  assert.equal(await app.credits.authenticate(credit.receiptNumber, ''), undefined); assert.equal(await app.credits.authenticate(credit.receiptNumber, 'errada'), undefined);
  await app.credits.authenticate(credit.receiptNumber, authCode); await complete(500, payments);
  assert.equal((await app.credits.search(credit.receiptNumber))[0].balanceInCents, 1000);
});
test('Crédito parcial, esgotamento e cancelamento restauram exatamente as baixas', async () => {
  const { credit, authCode } = await issue(1000); await app.credits.authenticate(credit.receiptNumber, authCode);
  await complete(400, [{ method: 'customer_credit', amountInCents: 400, customerCreditId: credit.id }]);
  assert.equal((await app.credits.search(credit.receiptNumber))[0].status, 'partial');
  const sale = await complete(600, [{ method: 'customer_credit', amountInCents: 600, customerCreditId: credit.id }]);
  assert.equal((await app.credits.search(credit.receiptNumber))[0].status, 'redeemed');
  await app.sales.cancel(sale.id, 'customer_cancelled'); await app.financial.recover(); await app.financial.recover();
  const snapshot = await app.financial.snapshot(); assert.equal(snapshot.financial.credits[0].balanceInCents, 600); assert.equal(snapshot.financial.creditMovements.filter((m) => m.type === 'restored').length, 1);
});
test('Devolução parcial por lineId e reembolso pendente/concluído preservam distinção financeira', async () => {
  const sale = await complete(1000, [payment('cash', 1000)], 2);
  await app.recordReturn(sale, { [sale.items[0].lineId]: 1 });
  const result = await app.settle(sale, { amounts: amounts('cash', 500), statuses: { cash: 'pending' } });
  let snapshot = await app.financial.snapshot(); assert.equal(getSaleEligibleAmount(sale, snapshot.financial), 500); assert.equal(getCashSummary(session, [], snapshot.sales, snapshot.financial).expectedInCents, 11000);
  await app.updateRefund(result.data.refunds[0].id, 'completed'); snapshot = await app.financial.snapshot(); assert.equal(getCashSummary(session, [], snapshot.sales, snapshot.financial).expectedInCents, 10500);
  await assert.rejects(() => app.recordReturn(sale, { [sale.items[0].lineId]: 2 }), /quantidade/);
});
test('Falha de reembolso libera elegibilidade, não representa devolução de dinheiro', async () => {
  const sale = await complete(); await app.sales.cancel(sale.id, 'customer_cancelled');
  const result = await app.settle(sale, { amounts: amounts('pix', 500), statuses: { pix: 'pending' } });
  await app.updateRefund(result.data.refunds[0].id, 'failed');
  const second = await app.settle(sale, { amounts: amounts('pix', 500) }); assert.equal(second.data.refunds.filter((r) => r.status === 'completed').length, 1);
});
test('Fechamento grava snapshot imutável; novo caixa e mudanças posteriores não alteram histórico', async () => {
  await complete(); const snapshot = await app.financial.snapshot(); const draft = getCashReconciliationDraft(session, [], snapshot.sales, snapshot.financial);
  const closed = await app.cash.close(session.id, draft.expectedByMethodInCents, draft.sourceFingerprint); const stored = JSON.stringify(closed.sessions[0]);
  await app.cash.open(0, 'raiz-admin'); assert.equal(JSON.stringify((await app.cash.read()).sessions.find((item) => item.id === session.id)), stored);
  await assert.rejects(() => app.cash.close(session.id, draft.expectedByMethodInCents, draft.sourceFingerprint), /fechado|aberto|sessão/i);
});
test('Fingerprint obsoleto rejeita fechamento após movimento', async () => {
  const snapshot = await app.financial.snapshot(); const draft = getCashReconciliationDraft(session, [], [], snapshot.financial);
  await app.cash.move(session.id, 'supply', 100, 'Troco');
  await assert.rejects(() => app.cash.close(session.id, draft.expectedByMethodInCents, draft.sourceFingerprint), /mudaram|Reabra/);
});
test('Modalidade eletrônica negativa continua válida na nova camada', async () => {
  const sale = await complete(); await app.sales.cancel(sale.id, 'customer_cancelled');
  const snapshot = await app.financial.snapshot(); const draft = getCashReconciliationDraft(session, [], snapshot.sales, snapshot.financial); await app.cash.close(session.id, draft.expectedByMethodInCents, draft.sourceFingerprint);
  const next = await app.cash.open(0, 'raiz-admin'); session = next.sessions.find((item) => item.status === 'open');
  await app.settle(sale, { amounts: amounts('pix', 500) });
  const current = await app.financial.snapshot(); const signed = getCashReconciliationDraft(session, [], current.sales, current.financial); assert.equal(signed.expectedByMethodInCents.pix, -500);
  const closed = await app.cash.close(session.id, { cash: 0, pix: 0, debit: 0, credit: 0 }, signed.sourceFingerprint); assert.equal(closed.sessions.find((item) => item.id === session.id).reconciliation.methods.pix.expectedInCents, -500);
});
test('Falha após venda salva preserva reserva e recuperação idempotente pelo contrato', async () => {
  const { credit, authCode } = await issue(); await app.credits.authenticate(credit.receiptNumber, authCode);
  const positions = [2]; positions.count = 0; localStorage.plan.set('raiz-pdv:sale-financial-data', positions);
  await assert.rejects(() => complete(500, [{ method: 'customer_credit', amountInCents: 500, customerCreditId: credit.id }]), SaleCreditFinalizationPendingError);
  assert.equal((await app.financial.snapshot()).financial.creditReservations.length, 1);
  localStorage.plan.clear(); await app.financial.recover(); await app.financial.recover();
  const snapshot = await app.financial.snapshot(); assert.equal(snapshot.sales.length, 2); assert.equal(snapshot.financial.creditReservations.length, 0); assert.equal(snapshot.financial.creditMovements.filter((m) => m.type === 'redeemed').length, 1);
});
test('Comandos concorrentes não consomem saldo duas vezes nem repetem numeração', async () => {
  const { credit, authCode } = await issue(500); await app.credits.authenticate(credit.receiptNumber, authCode);
  const results = await Promise.allSettled([complete(500, [{ method: 'customer_credit', amountInCents: 500, customerCreditId: credit.id }]), complete(500, [{ method: 'customer_credit', amountInCents: 500, customerCreditId: credit.id }])]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1); const snapshot = await app.financial.snapshot(); assert.equal(new Set(snapshot.sales.map((s) => s.number)).size, snapshot.sales.length);
});
test('Resolução concorrente não emite crédito duplicado', async () => {
  const sale = await complete(); await app.sales.cancel(sale.id, 'customer_cancelled');
  const results = await Promise.allSettled([app.settle(sale, { amounts: amounts('customer_credit', 500) }), app.settle(sale, { amounts: amounts('customer_credit', 500) })]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1); assert.equal((await app.financial.snapshot()).financial.credits.length, 1);
});
test('Backup v2 exporta/importa pelo contrato e guarda cópia; v1 permanece legível', async () => {
  await complete(); const text = await app.backups.exportJson(); const parsed = await app.backups.validateJson(text); assert.equal(parsed.backup.version, 2);
  await app.backups.import(parsed.backup); assert.ok(await app.backups.safetyCopy()); assert.equal((await app.sales.list()).length, 1);
  const { financial, ...data } = parsed.backup.data; let hash = 0x811c9dc5; for (const char of JSON.stringify(data)) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 0x01000193); }
  const legacy = { ...parsed.backup, version: 1, data, integrity: { algorithm: 'fnv1a-32', checksum: (hash >>> 0).toString(16).padStart(8, '0') } };
  const checked = await app.backups.validateJson(JSON.stringify(legacy)); assert.deepEqual(checked.backup.data.financial.creditReservations, []);
  await app.backups.import(checked.backup); assert.equal((await app.sales.list()).length, 1);
});
test('Falha de importação compensa chaves e mantém cópia sem declarar sucesso', async () => {
  const exported = await app.backups.validateJson(await app.backups.exportJson()); const before = localStorage.getItem('raiz-pdv:completed-sales'); localStorage.failure = 'raiz-pdv:sale-financial-data';
  await assert.rejects(() => app.backups.import(exported.backup), /restaur|gravar/i); assert.equal(localStorage.getItem('raiz-pdv:completed-sales'), before); assert.ok(await app.backups.safetyCopy());
});
test('Erros de persistência propagam e não informam venda concluída', async () => {
  localStorage.failure = 'raiz-pdv:completed-sales'; await assert.rejects(() => complete(), /não foi concluída/i); assert.equal((await app.sales.list()).length, 0);
  localStorage.failure = 'raiz-pdv:products'; await assert.rejects(() => app.products.replaceCatalog([product]));
  const settings = await app.settings.load(); localStorage.failure = 'raiz-pdv:settings'; await assert.rejects(() => app.settings.save(settings));
  localStorage.failure = 'raiz-pdv:draft-cart'; await assert.rejects(() => app.draft.save(cart()));
  await app.draft.save(cart()); assert.equal((await app.draft.load([product]))[0].quantity, 1);
});
test('Rascunhos são serializados; importação espera gravações pendentes', async () => {
  await Promise.all([app.draft.save(cart(500, 1)), app.draft.save(cart(500, 2))]); assert.equal((await app.draft.load([product]))[0].quantity, 2);
  const parsed = await app.backups.validateJson(await app.backups.exportJson()); const save = app.draft.save(cart()); await app.backups.import(parsed.backup); await save; assert.equal(localStorage.getItem('raiz-pdv:draft-cart'), null);
});
test('Dados legados sem lineId são consultados sem regravar documentos', async () => {
  const sale = await complete(); const legacy = { ...sale, items: sale.items.map(({ lineId, ...item }) => item) }; localStorage.setItem('raiz-pdv:completed-sales', JSON.stringify([legacy])); const raw = localStorage.getItem('raiz-pdv:completed-sales');
  await app.financial.snapshot(); assert.equal(localStorage.getItem('raiz-pdv:completed-sales'), raw);
  await app.recordReturn(legacy, { 'legacy-line-1': 1 }); assert.equal(localStorage.getItem('raiz-pdv:completed-sales'), raw);
});
test('Sem Web Locks operações financeiras rejeitam antes de gravar', async () => {
  navigator.locks = undefined; const before = localStorage.getItem('raiz-pdv:completed-sales'); await assert.rejects(() => complete(), /bloqueio|Web Locks|navegador/i); assert.equal(localStorage.getItem('raiz-pdv:completed-sales'), before);
});
test('React, aplicação e domínio não importam serviços web ou APIs de armazenamento', () => {
  const walk = (path) => readdirSync(path, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(`${path}/${entry.name}`) : /\.tsx?$/.test(entry.name) ? [`${path}/${entry.name}`] : []);
  for (const file of ['src/App.tsx', ...['src/components','src/pages','src/hooks','src/application','src/domain'].flatMap(walk)]) {
    const source = readFileSync(file, 'utf8'); assert.doesNotMatch(source, /from ['"][^'"]*services\//, file); assert.doesNotMatch(source, /\b(?:localStorage|sessionStorage)\b/, file);
  }
});

test('Caixa corrompido é sinalizado na inicialização sem impedir reparo administrativo por backup', async () => {
  const valid = await app.backups.validateJson(await app.backups.exportJson());
  localStorage.setItem('raiz-pdv:cash', '{invalid');
  const initial = await app.bootstrap(); assert.ok(initial.cashError); assert.equal(initial.operator.role, 'admin');
  await assert.rejects(() => app.cash.read());
  await app.backups.import(valid.backup); assert.equal((await app.bootstrap()).cashError, null);
});
