import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

class MemoryStorage {
  data = new Map(); failKey = null; failPlan = new Map();
  failOnWrites(key, positions) { this.failPlan.set(key, { positions, count: 0 }); }
  getItem(key) { return this.data.has(key) ? this.data.get(key) : null; }
  setItem(key, value) { const plan = this.failPlan.get(key); if (plan && plan.positions.includes(++plan.count)) throw new Error('quota'); if (this.failKey === key) { this.failKey = null; throw new Error('quota'); } this.data.set(key, String(value)); }
  removeItem(key) { this.data.delete(key); }
  clear() { this.data.clear(); this.failKey = null; this.failPlan.clear(); }
}
globalThis.localStorage = new MemoryStorage();
globalThis.sessionStorage = new MemoryStorage();
let lockTail = Promise.resolve();
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: { request: (_name, _options, callback) => { const next = lockTail.then(callback); lockTail = next.catch(() => {}); return next; } } } });
const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true, hmr: false }, appType: 'custom' });
const finance = await vite.ssrLoadModule('/src/services/saleFinancialStorage.ts');
const saleStorage = await vite.ssrLoadModule('/src/services/saleStorage.ts');
const cash = await vite.ssrLoadModule('/src/utils/cash.ts');
const cashStorage = await vite.ssrLoadModule('/src/services/cashStorage.ts');
const backup = await vite.ssrLoadModule('/src/services/backupStorage.ts');
const saleLines = await vite.ssrLoadModule('/src/utils/saleLines.ts');
const analytics = await vite.ssrLoadModule('/src/utils/salesAnalytics.ts');
const access = await vite.ssrLoadModule('/src/services/operatorAccess.ts');
const adminAuth = () => sessionStorage.setItem(access.OPERATOR_SESSION_KEY, JSON.stringify({ id: access.DEFAULT_ADMIN.id, credential: access.DEFAULT_ADMIN.passwordDigest }));
const operatorAuth = (id) => sessionStorage.setItem(access.OPERATOR_SESSION_KEY, JSON.stringify({ id, credential: access.DEFAULT_ADMIN.passwordDigest }));
after(() => vite.close());
beforeEach((t) => { t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-08T12:00:00.000Z') }); localStorage.clear(); sessionStorage.clear(); adminAuth(); localStorage.setItem('raiz-pdv:cash', JSON.stringify({ sessions: [{ id: 'session-1', operatorId: 'raiz-admin', operatorName: 'Administrador Mestre', openedAt: '2026-10-08T10:00:00.000Z', openingAmountInCents: 10000, status: 'open' }], movements: [] })); });

function makeSale({ id = 'sale-1', number = 1, total = 1000, status = 'completed', method = 'pix', session = 'session-1', items } = {}) {
  const lines = items ?? [{ productId: 'p1', productName: 'Produto', unitPriceInCents: total, quantity: 1, subtotalInCents: total }];
  const payment = method === 'cash' ? { method, amountInCents: total, amountReceivedInCents: total, changeInCents: 0 } : { method, amountInCents: total };
  return { id, number, date: '2026-10-08T11:00:00.000Z', cashSessionId: session,
    ...(status === 'cancelled' ? { status, cancelledAt: '2026-10-08T11:10:00.000Z', cancellationReason: 'customer_cancelled' } : { status }),
    items: lines, totalInCents: total, payments: [payment] };
}

function cashSession(id = 'session-1', opening = 0) { return { id, operatorId: 'raiz-admin', operatorName: 'Administrador Mestre', openedAt: '2026-10-08T10:00:00.000Z', openingAmountInCents: opening, status: 'open' }; }

async function issueCredit(sale, cents) {
  const result = await finance.settleSaleBalance(sale, { amounts: { cash: 0, pix: 0, debit: 0, credit: 0, customer_credit: cents }, cashSessionId: sale.cashSessionId });
  for (const { credit, authCode } of result.issuedCredits) await finance.lookupCustomerCredit(credit.receiptNumber, authCode);
  return result;
}

test('Cancelamento integral permite resolver o total, mas só uma saída em dinheiro concluída reduz o físico', async () => {
  const sale = makeSale({ status: 'cancelled', method: 'cash', total: 2500 });
  const { data } = await finance.settleSaleBalance(sale, { amounts: { cash: 2500, pix: 0, debit: 0, credit: 0, customer_credit: 0 }, cashSessionId: 'session-1' });
  assert.equal(data.refunds[0].status, 'completed');
  const summary = cash.getCashSummary(cashSession('session-1', 1000), [], [sale]);
  assert.equal(summary.expectedInCents, 1000);
  assert.equal(summary.refundsInCents, 2500);
});

test('Devolução parcial limita crédito ao valor dos itens devolvidos e preserva o restante sem alteração', async () => {
  const sale = makeSale({ total: 1500, items: [
    { productId: 'p1', productName: 'Água', unitPriceInCents: 500, quantity: 1, subtotalInCents: 500 },
    { productId: 'p2', productName: 'Suco', unitPriceInCents: 1000, quantity: 1, subtotalInCents: 1000 },
  ] });
  await finance.recordMerchandiseReturn(sale, { p1: 1 });
  assert.equal(finance.getSaleEligibleAmount(sale), 500);
  await assert.rejects(() => finance.settleSaleBalance(sale, { amounts: { cash: 0, pix: 501, debit: 0, credit: 0, customer_credit: 0 } }), /saldo elegível/);
  const result = await issueCredit(sale, 500);
  assert.equal(result.issuedCredits[0].credit.balanceInCents, 500);
  assert.equal(finance.getSaleUnresolvedAmount(sale), 0);
  await assert.rejects(() => finance.settleSaleBalance(sale, { amounts: { cash: 1, pix: 0, debit: 0, credit: 0, customer_credit: 0 }, cashSessionId: 'session-1' }), /saldo elegível/);
});

test('Código SHA-256 autoriza o crédito; busca por número da venda não revela o código', async () => {
  const sale = makeSale({ status: 'cancelled' });
  const { issuedCredits } = await issueCredit(sale, 800);
  const { credit, authCode } = issuedCredits[0];
  assert.equal(credit.authCodeHash.length, 64);
  assert.equal((await finance.lookupCustomerCredit(String(sale.number), 'codigo-incorreto')), undefined);
  assert.equal((await finance.lookupCustomerCredit(credit.receiptNumber, authCode)).balanceInCents, 800);
  const result = finance.searchCustomerCredits(String(sale.number));
  assert.equal(result.length, 1);
  assert.equal(Object.hasOwn(result[0], 'authCodeHash'), false);
});

test('Resgate parcial misto consome apenas após a venda persistir e não permite saldo duplicado', async () => {
  const original = makeSale({ id: 'cancelled-original', number: 4, status: 'cancelled', total: 1000 });
  localStorage.setItem(saleStorage.SALES_STORAGE_KEY, JSON.stringify([original]));
  const { credit, authCode } = (await issueCredit(original, 500)).issuedCredits[0];
  const item = { product: { id: 'p2', name: 'Novo', priceInCents: 500, category: 'Geral', active: true, emoji: '📦' }, quantity: 1, unitPriceInCents: 500, subtotalInCents: 500 };
  const sale = await saleStorage.saveCompletedSaleWithCustomerCredit([item], 500, [
    { method: 'customer_credit', amountInCents: 300, customerCreditId: credit.id },
    { method: 'cash', amountInCents: 200, amountReceivedInCents: 200, changeInCents: 0 },
  ], 'session-1');
  assert.equal(finance.loadSaleFinancialData().credits[0].balanceInCents, 200);
  assert.ok(sale.payments.every((payment) => payment.capturedAt));
  const tooMuch = { ...item, unitPriceInCents: 300, subtotalInCents: 300, product: { ...item.product, priceInCents: 300 } };
  await assert.rejects(() => saleStorage.saveCompletedSaleWithCustomerCredit([tooMuch], 300, [{ method: 'customer_credit', amountInCents: 300, customerCreditId: credit.id }], 'session-1'), /saldo mudou|indisponível/);
  assert.equal(saleStorage.listSales().length, 2);
  const cancelled = await saleStorage.cancelSaleAndRestoreCustomerCredit(sale.id, 'customer_cancelled');
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(finance.getSaleUnresolvedAmount(cancelled), 200);
  await assert.rejects(() => issueCredit(cancelled, 201), /saldo elegível/);
  assert.equal(finance.loadSaleFinancialData().credits[0].balanceInCents, 500);
  assert.equal((await finance.lookupCustomerCredit(credit.receiptNumber, authCode)).balanceInCents, 500);
  await assert.rejects(() => saleStorage.cancelSaleAndRestoreCustomerCredit(sale.id, 'customer_cancelled'), /cancelada/);
});

test('Reembolsos pendentes reservam o saldo, falha os libera e não afetam o caixa', async () => {
  const sale = makeSale({ status: 'cancelled', total: 900 });
  const { data } = await finance.settleSaleBalance(sale, { amounts: { cash: 0, pix: 600, debit: 0, credit: 0, customer_credit: 0 }, statuses: { pix: 'pending' }, cashSessionId: 'session-1' });
  assert.equal(data.refunds[0].status, 'pending');
  assert.equal(finance.getSaleUnresolvedAmount(sale), 300);
  assert.equal(finance.getSessionRefundTotals('session-1').pix, 0);
  await finance.updatePendingRefund(data.refunds[0].id, 'failed');
  assert.equal(finance.getSaleUnresolvedAmount(sale), 900);
  await assert.rejects(() => finance.updatePendingRefund(data.refunds[0].id, 'completed'), /pendente/);
});

test('Fechamento separa recebimentos brutos, reembolsos efetivos e crédito de cliente', async () => {
  const sale = makeSale({ id: 'sale-mixed', total: 1500, method: 'pix', items: [
    { productId: 'p1', productName: 'Produto', unitPriceInCents: 1500, quantity: 1, subtotalInCents: 1500 },
  ] });
  sale.payments = [{ method: 'pix', amountInCents: 1500 }, { method: 'customer_credit', amountInCents: 200, customerCreditId: 'credit-1' }];
  sale.totalInCents = 1700; sale.items[0].unitPriceInCents = 1700; sale.items[0].subtotalInCents = 1700;
  await finance.settleSaleBalance(makeSale({ id: 'old-cancel', number: 8, status: 'cancelled', total: 500 }), { amounts: { cash: 0, pix: 300, debit: 0, credit: 0, customer_credit: 0 }, cashSessionId: 'session-1' });
  const draft = cash.getCashReconciliationDraft(cashSession(), [], [sale]);
  assert.equal(draft.paymentTotalsInCents.pix, 1500);
  assert.equal(draft.expectedByMethodInCents.pix, 1200);
  assert.equal(draft.refundTotalsInCents.pix, 300);
  assert.equal(draft.customerCreditConsumedInCents, 200);
});

test('Falha na gravação do ledger não confirma resolução parcial', async () => {
  const sale = makeSale({ status: 'cancelled' });
  localStorage.failKey = finance.FINANCIAL_STORAGE_KEY;
  await assert.rejects(() => issueCredit(sale, 500), /Não foi possível gravar/);
  assert.deepEqual(finance.loadSaleFinancialData(), { returns: [], refunds: [], credits: [], creditMovements: [], creditReservations: [] });
});


test('Devolução total libera o valor integral e impede devolver unidades novamente', async () => {
  const sale = makeSale({ total: 1200, items: [{ productId: 'p1', productName: 'Produto', unitPriceInCents: 400, quantity: 3, subtotalInCents: 1200 }] });
  await finance.recordMerchandiseReturn(sale, { p1: 1 });
  await finance.recordMerchandiseReturn(sale, { p1: 2 });
  assert.equal(finance.getSaleEligibleAmount(sale), 1200);
  await assert.rejects(() => finance.recordMerchandiseReturn(sale, { p1: 1 }), /excede/);
  await issueCredit(sale, 1200);
  assert.equal(finance.getSaleUnresolvedAmount(sale), 0);
});

test('Conclusão de pendência usa caixa atual e não modifica fechamento anterior', async () => {
  const sale = makeSale({ status: 'cancelled', total: 900 });
  const { data } = await finance.settleSaleBalance(sale, { amounts: { cash: 900, pix: 0, debit: 0, credit: 0, customer_credit: 0 }, statuses: { cash: 'pending' }, cashSessionId: 'session-1' });
  const old = { id: 'session-1', openedAt: '2026-10-08T10:00:00.000Z', status: 'closed', openingAmountInCents: 1000, closedAt: '2026-10-08T12:00:00.000Z', countedAmountInCents: 1000, expectedAmountInCents: 1000, differenceInCents: 0 };
  const current = cashSession('session-2', 1000);
  localStorage.setItem('raiz-pdv:cash', JSON.stringify({ sessions: [old, current], movements: [] }));
  await assert.rejects(() => finance.updatePendingRefund(data.refunds[0].id, 'completed', 'session-1'), /atual aberto/);
  await finance.updatePendingRefund(data.refunds[0].id, 'completed', 'session-2');
  assert.equal(finance.getSessionRefundTotals('session-1').cash, 0);
  assert.equal(finance.getSessionRefundTotals('session-2').cash, 900);
  assert.deepEqual(JSON.parse(localStorage.getItem('raiz-pdv:cash')).sessions[0], old);
  await assert.rejects(() => finance.updatePendingRefund(data.refunds[0].id, 'completed', 'session-2'), /pendente/);
});

test('Reembolso realizado não excede dinheiro físico; pendente não é saída', async () => {
  localStorage.setItem('raiz-pdv:cash', JSON.stringify({ sessions: [cashSession('session-1', 100)], movements: [] }));
  const sale = makeSale({ status: 'cancelled', total: 500 });
  await assert.rejects(() => finance.settleSaleBalance(sale, { amounts: { cash: 500, pix: 0, debit: 0, credit: 0, customer_credit: 0 }, cashSessionId: 'session-1' }), /saldo físico/);
  const { data } = await finance.settleSaleBalance(sale, { amounts: { cash: 500, pix: 0, debit: 0, credit: 0, customer_credit: 0 }, statuses: { cash: 'pending' }, cashSessionId: 'session-1' });
  assert.equal(finance.getSessionRefundTotals('session-1').cash, 0);
  await assert.rejects(() => finance.updatePendingRefund(data.refunds[0].id, 'completed', 'session-1'), /saldo físico/);
});

test('Falha ao salvar venda com crédito libera reserva e preserva saldo', async () => {
  const original = makeSale({ status: 'cancelled' });
  const { credit } = (await issueCredit(original, 500)).issuedCredits[0];
  const item = { product: { id: 'p1', name: 'Produto', priceInCents: 500, category: 'Geral', active: true, emoji: 'X' }, quantity: 1, unitPriceInCents: 500, subtotalInCents: 500 };
  localStorage.failKey = saleStorage.SALES_STORAGE_KEY;
  await assert.rejects(() => saleStorage.saveCompletedSaleWithCustomerCredit([item], 500, [{ method: 'customer_credit', customerCreditId: credit.id, amountInCents: 500 }], 'session-1'), /nenhum crédito/);
  assert.equal(finance.loadSaleFinancialData().credits[0].balanceInCents, 500);
  assert.equal(finance.loadSaleFinancialData().creditReservations.length, 0);
  assert.equal(saleStorage.listSales().length, 0);
});


test('Faturamento mantém a venda original e separa devoluções sem duplicar crédito', async () => {
  const sale = makeSale({ total: 1500, items: [{ productId: 'p1', productName: 'Produto', unitPriceInCents: 500, quantity: 3, subtotalInCents: 1500 }] });
  await finance.recordMerchandiseReturn(sale, { p1: 1 });
  await issueCredit(sale, 500);
  const data = finance.loadSaleFinancialData();
  const metrics = analytics.getSalesMetrics([sale], data);
  assert.equal(metrics.revenueInCents, 1500);
  assert.equal(metrics.netSalesInCents, 1000);
  assert.equal(metrics.averageTicketInCents, 1500);
  assert.equal(metrics.biggestSaleInCents, 1500);
  assert.equal(metrics.saleCount, 1);
  assert.equal(sale.totalInCents, 1500);
  assert.equal(analytics.getPaymentTotals([sale]).pix, 1500);
  const trend = analytics.getSalesTrend([sale], 'today', new Date(sale.date), data);
  assert.equal(trend.reduce((sum, bucket) => sum + bucket.revenueInCents, 0), 1500);
});

test('Gráficos excluem cancelamentos e vendas fora do período; devolução total mantém faturamento original', async () => {
  const sale = makeSale({ total: 500 });
  await finance.recordMerchandiseReturn(sale, { p1: 1 });
  const cancelled = makeSale({ id: 'cancelled', status: 'cancelled', total: 2000 });
  const older = { ...makeSale({ id: 'older', total: 3000 }), date: '2026-09-01T12:00:00.000Z' };
  const data = finance.loadSaleFinancialData();
  const metrics = analytics.getSalesMetrics([sale, cancelled], data);
  assert.equal(metrics.revenueInCents, 500);
  assert.equal(metrics.netSalesInCents, 0);
  assert.equal(metrics.saleCount, 1);
  for (const period of ['today', 'week', 'month']) assert.equal(analytics.getSalesTrend([sale, cancelled, older], period, new Date(sale.date), data).reduce((sum, bucket) => sum + bucket.revenueInCents, 0), 500);
});

test('Distribuição inclui crédito de cliente e mantém modalidade e troco corretos', async () => {
  const sale = makeSale({ total: 1000 });
  sale.payments = [{ method: 'customer_credit', customerCreditId: 'credit', amountInCents: 300 }, { method: 'cash', amountInCents: 700, amountReceivedInCents: 1000, changeInCents: 300 }];
  assert.deepEqual(analytics.getPaymentTotals([sale]), { cash: 700, pix: 0, debit: 0, credit: 0, customer_credit: 300 });
});

test('Resumo usa data efetiva do reembolso e separa pendência, falha e emissão de crédito', async () => {
  const financial = { returns: [], credits: [{ issuedAt: '2026-10-08T12:00:00', originalAmountInCents: 200 }], creditMovements: [], creditReservations: [], refunds: [
    { method: 'pix', status: 'completed', amountInCents: 500, createdAt: '2026-10-07T12:00:00', completedAt: '2026-10-08T12:00:00' },
    { method: 'debit', status: 'pending', amountInCents: 300, createdAt: '2026-10-08T12:00:00' },
    { method: 'cash', status: 'failed', amountInCents: 900, createdAt: '2026-10-08T12:00:00' },
    { method: 'customer_credit', status: 'completed', amountInCents: 200, createdAt: '2026-10-08T12:00:00', completedAt: '2026-10-08T12:00:00' },
  ] };
  assert.deepEqual(analytics.getFinancialPeriodSummary(financial, 'today', new Date('2026-10-08T15:00:00')), { refundedInCents: 500, pendingInCents: 300, issuedCreditInCents: 200 });
  assert.equal(analytics.getFinancialPeriodSummary(financial, 'today', new Date('2026-10-07T15:00:00')).refundedInCents, 0);
});

test('Vendas legadas sem status continuam nos indicadores sem eventos inventados', async () => {
  const sale = makeSale(); delete sale.status;
  const metrics = analytics.getSalesMetrics([sale]);
  assert.equal(metrics.revenueInCents, 1000);
  assert.equal(metrics.saleCount, 1);
  assert.equal(analytics.getSalesMetrics([]).averageTicketInCents, 0);
});


test('Duas vendas de 25 e 10 com devoluções em crédito mantêm faturamento 35', async () => {
  const first = makeSale({ id: 'first', number: 1, total: 2500, items: [{ productId: 'p1', productName: 'Produto', unitPriceInCents: 500, quantity: 5, subtotalInCents: 2500 }] });
  const second = makeSale({ id: 'second', number: 2, total: 1000 });
  await finance.recordMerchandiseReturn(first, { p1: 2 });
  await finance.recordMerchandiseReturn(second, { p1: 1 });
  await issueCredit(first, 1000); await issueCredit(second, 1000);
  const metrics = analytics.getSalesMetrics([first, second], finance.loadSaleFinancialData());
  assert.equal(metrics.revenueInCents, 3500);
  assert.equal(metrics.netSalesInCents, 1500);
  assert.equal(metrics.saleCount, 2);
  assert.equal(metrics.averageTicketInCents, 1750);
});


test('Histórico, caixa e relatório conciliam duas vendas 35 com 20 em crédito emitido', async () => {
  const first = makeSale({ id: 'a', number: 1, total: 2500, items: [{ productId: 'p1', productName: 'Produto', unitPriceInCents: 500, quantity: 5, subtotalInCents: 2500 }] });
  const second = makeSale({ id: 'b', number: 2, total: 1000 });
  await finance.recordMerchandiseReturn(first, { p1: 2 }); await finance.recordMerchandiseReturn(second, { p1: 1 });
  await issueCredit(first, 1000); await issueCredit(second, 1000);
  const data = finance.loadSaleFinancialData(), sales = [first, second];
  const historical = analytics.getReceivedSummary(sales, data.refunds);
  const draft = cash.getCashReconciliationDraft(cashSession(), [], sales);
  const report = analytics.getPeriodReceivedSummary(sales, data, 'today', new Date(first.date));
  for (const summary of [historical, report]) { assert.equal(summary.saleCount, 2); assert.equal(summary.revenueInCents, 3500); assert.equal(summary.netReceivedInCents, 3500); }
  assert.equal(draft.saleCount, 2); assert.equal(draft.totalNetSalesInCents, 3500); assert.equal(draft.netReceivedInCents, 3500);
  const snapshot = cash.createCashReconciliation(draft, draft.expectedByMethodInCents);
  assert.equal(snapshot.summaryVersion, 2); assert.equal(snapshot.saleCount, 2); assert.equal(snapshot.netReceivedInCents, 3500);
});

test('Somente reembolso realizado reduz recebido líquido; pendente e falha não reduzem', async () => {
  const sale = makeSale({ total: 3500 });
  const refunds = [{ method: 'customer_credit', status: 'completed', amountInCents: 1000 }, { method: 'pix', status: 'pending', amountInCents: 500 }, { method: 'cash', status: 'failed', amountInCents: 200 }, { method: 'debit', status: 'completed', amountInCents: 300 }];
  const summary = analytics.getReceivedSummary([sale], refunds);
  assert.equal(summary.refundedInCents, 300); assert.equal(summary.netReceivedInCents, 3200);
});

test('Cancelada permanece em recebimentos até reembolso e crédito usado não é dinheiro novo', async () => {
  const cancelled = makeSale({ status: 'cancelled', total: 2500 });
  const creditSale = makeSale({ id: 'credit-sale', total: 1000 });
  creditSale.payments = [{ method: 'customer_credit', customerCreditId: 'credit', amountInCents: 600 }, { method: 'pix', amountInCents: 400 }];
  const result = analytics.getReceivedSummary([cancelled, creditSale], []);
  assert.equal(result.saleCount, 1); assert.equal(result.cancelledCount, 1); assert.equal(result.revenueInCents, 1000); assert.equal(result.netReceivedInCents, 2900);
  assert.equal(analytics.getPaymentTotals([cancelled, creditSale], true).pix, 2900);
});


test('Reembolso de venda antiga maior que recebimento eletrônico atual mantém total negativo correto', async () => {
  const old = makeSale({ id: 'old', status: 'cancelled', total: 1000, session: 'old-session' });
  await finance.settleSaleBalance(old, { amounts: { cash: 0, pix: 1000, debit: 0, credit: 0, customer_credit: 0 }, cashSessionId: 'session-1' });
  const current = makeSale({ total: 300 });
  const draft = cash.getCashReconciliationDraft(cashSession(), [], [old, current]);
  assert.equal(draft.expectedByMethodInCents.pix, -700);
  assert.equal(draft.netReceivedInCents, -700);
});


const cartItem = (cents = 500) => ({ product: { id: 'p1', name: 'Produto', priceInCents: cents, category: 'Geral', active: true, emoji: 'X' }, quantity: 1, unitPriceInCents: cents, subtotalInCents: cents });
const creditPayment = (credit, cents) => ({ method: 'customer_credit', customerCreditId: credit.id, amountInCents: cents });
const moneyPayment = (cents) => ({ method: 'cash', amountInCents: cents, amountReceivedInCents: cents, changeInCents: 0 });
async function storedCredit(cents = 500) {
  const original = makeSale({ status: 'cancelled', total: cents });
  localStorage.setItem(saleStorage.SALES_STORAGE_KEY, JSON.stringify([original]));
  return (await issueCredit(original, cents)).issuedCredits[0].credit;
}

test('Linhas repetidas com preços distintos devolvem em momentos diferentes sem alterar snapshots', async () => {
  const sale = makeSale({ total: 1700, items: [
    { productId: 'p', productName: 'Produto', unitPriceInCents: 500, quantity: 2, subtotalInCents: 1000 },
    { productId: 'p', productName: 'Produto', unitPriceInCents: 700, quantity: 1, subtotalInCents: 700 },
  ] });
  const original = JSON.stringify(sale);
  localStorage.setItem(saleStorage.SALES_STORAGE_KEY, JSON.stringify([sale]));
  await assert.rejects(() => finance.recordMerchandiseReturn(sale, { p: 1 }), /linha original/);
  await finance.recordMerchandiseReturn(sale, { 'legacy-line-2': 1 });
  await finance.recordMerchandiseReturn(sale, { 'legacy-line-1': 1 });
  assert.equal(finance.getSaleEligibleAmount(sale), 1200);
  await finance.recordMerchandiseReturn(sale, { 'legacy-line-1': 1 });
  assert.equal(finance.getSaleEligibleAmount(sale), 1700);
  await assert.rejects(() => finance.recordMerchandiseReturn(sale, { 'legacy-line-2': 1 }), /excede/);
  await assert.rejects(() => finance.recordMerchandiseReturn(sale, { unknown: 1 }), /linha original/);
  assert.equal(JSON.stringify(saleStorage.listSales()[0]), original);
  assert.deepEqual(finance.loadSaleFinancialData().returns.map(item=>item.items[0].unitPriceInCents), [700,500,500]);
  assert.equal(backup.parseBackupJson(backup.createBackupJson()).summary.returns, 3);
});

test('Devolução antiga sem lineId usa preço snapshot e ordem original sem regravar histórico', async () => {
  const sale = makeSale({ total: 1700, items: [
    { productId: 'p', productName: 'Produto', unitPriceInCents: 500, quantity: 2, subtotalInCents: 1000 },
    { productId: 'p', productName: 'Produto', unitPriceInCents: 700, quantity: 1, subtotalInCents: 700 },
  ] });
  const data = { returns: [{ id:'old',saleId:sale.id,saleNumber:1,createdAt:sale.date,amountInCents:700,items:[{productId:'p',productName:'Produto',quantity:1,amountInCents:700}] }], refunds:[],credits:[],creditMovements:[],creditReservations:[] };
  const snapshot = JSON.stringify(data.returns[0]);
  localStorage.setItem(finance.FINANCIAL_STORAGE_KEY, JSON.stringify(data));
  localStorage.setItem(saleStorage.SALES_STORAGE_KEY, JSON.stringify([sale]));
  assert.deepEqual(saleLines.getReturnedLineQuantities(sale, data), { 'legacy-line-2': 1 });
  await finance.recordMerchandiseReturn(sale, { 'legacy-line-1': 2 });
  assert.equal(JSON.stringify(finance.loadSaleFinancialData().returns[0]), snapshot);
  assert.equal(backup.parseBackupJson(backup.createBackupJson()).summary.returns, 2);
});

test('Cancelamento persistido invalida tela antiga de devolução', async () => {
  const stale = makeSale();
  localStorage.setItem(saleStorage.SALES_STORAGE_KEY, JSON.stringify([makeSale({status:'cancelled'})]));
  await assert.rejects(() => finance.recordMerchandiseReturn(stale, {p1:1}), /cancelada/);
  assert.equal(finance.loadSaleFinancialData().returns.length, 0);
});

test('Código não validado no serviço impede concluir crédito apenas pelo identificador', async () => {
  const original = makeSale({status:'cancelled'});
  localStorage.setItem(saleStorage.SALES_STORAGE_KEY, JSON.stringify([original]));
  const {credit,authCode} = (await finance.settleSaleBalance(original, {amounts:{cash:0,pix:0,debit:0,credit:0,customer_credit:500}})).issuedCredits[0];
  assert.equal(Object.hasOwn(await finance.lookupCustomerCredit(credit.receiptNumber), 'authCodeHash'),false);
  assert.equal(await finance.lookupCustomerCredit(credit.receiptNumber,''),undefined);
  assert.equal(await finance.lookupCustomerCredit(credit.receiptNumber,'INVALIDO'),undefined);
  await assert.rejects(()=>saleStorage.saveCompletedSaleWithCustomerCredit([cartItem()],500,[creditPayment(credit,500)],'session-1'),/autorização/);
  await finance.lookupCustomerCredit(credit.receiptNumber,authCode);
  await saleStorage.saveCompletedSaleWithCustomerCredit([cartItem()],500,[creditPayment(credit,500)],'session-1');
  assert.equal(finance.loadSaleFinancialData().credits[0].status,'redeemed');
  await assert.rejects(()=>saleStorage.saveCompletedSaleWithCustomerCredit([cartItem()],500,[creditPayment(credit,500)],'session-1'),/indisponível|saldo mudou/);
  assert.equal(finance.searchCustomerCredits(credit.receiptNumber).length,1);
});

test('Dois créditos, várias parcelas do mesmo crédito e dinheiro são baixados e restaurados uma única vez', async () => {
  const a = makeSale({id:'a',number:1,status:'cancelled',total:2000});
  const b = makeSale({id:'b',number:2,status:'cancelled',total:3000});
  localStorage.setItem(saleStorage.SALES_STORAGE_KEY, JSON.stringify([a,b]));
  const ca=(await issueCredit(a,2000)).issuedCredits[0].credit;
  const cb=(await issueCredit(b,3000)).issuedCredits[0].credit;
  const sale=await saleStorage.saveCompletedSaleWithCustomerCredit([cartItem(6500)],6500,[creditPayment(ca,1000),creditPayment(ca,1000),creditPayment(cb,2500),moneyPayment(2000)],'session-1');
  assert.deepEqual(finance.loadSaleFinancialData().credits.map(item=>item.balanceInCents),[0,500]);
  assert.equal(cash.getCashSummary(cashSession('session-1',10000),[],saleStorage.listSales()).expectedInCents,12000);
  finance.commitCreditRedemptions(sale);
  assert.equal(finance.loadSaleFinancialData().creditMovements.filter(item=>item.type==='redeemed').length,2);
  await saleStorage.cancelSaleAndRestoreCustomerCredit(sale.id,'customer_cancelled');
  await finance.recoverCreditReservations(); await finance.recoverCreditReservations();
  assert.deepEqual(finance.loadSaleFinancialData().credits.map(item=>item.balanceInCents),[2000,3000]);
  assert.equal(finance.loadSaleFinancialData().creditMovements.filter(item=>item.type==='restored').length,2);
  const parsed=backup.parseBackupJson(backup.createBackupJson()).backup;
  await backup.restoreBackup(parsed);
  assert.deepEqual(finance.loadSaleFinancialData().credits.map(item=>item.balanceInCents),[2000,3000]);
  assert.ok(backup.getRestoreSafetyCopy());
});

test('Falha antes de reservar não grava venda nem consome saldo', async () => {
  const credit = await storedCredit();
  localStorage.failOnWrites(finance.FINANCIAL_STORAGE_KEY,[1]);
  await assert.rejects(()=>saleStorage.saveCompletedSaleWithCustomerCredit([cartItem()],500,[creditPayment(credit,500)],'session-1'),/gravar/);
  assert.equal(saleStorage.listSales().length,1);
  assert.equal(finance.loadSaleFinancialData().creditReservations.length,0);
  assert.equal(finance.loadSaleFinancialData().credits[0].balanceInCents,500);
});

test('Venda gravada com falha na baixa conserva reserva, bloqueia novas operações e recupera sem duplicar', async () => {
  const credit = await storedCredit();
  localStorage.failOnWrites(finance.FINANCIAL_STORAGE_KEY,[2,3]);
  await assert.rejects(()=>saleStorage.saveCompletedSaleWithCustomerCredit([cartItem()],500,[creditPayment(credit,500)],'session-1'),/venda foi salva.*pendente/);
  const saved=saleStorage.listSales()[1];
  assert.equal(finance.loadSaleFinancialData().creditReservations.length,1);
  assert.equal(finance.loadSaleFinancialData().credits[0].balanceInCents,500);
  assert.equal((await finance.lookupCustomerCredit(credit.receiptNumber)).balanceInCents,0);
  await assert.rejects(()=>saleStorage.saveCompletedSale([cartItem()],500,[moneyPayment(500)],'session-1'),/pendente/);
  const draft=cash.getCashReconciliationDraft(cashSession('session-1',10000),[],saleStorage.listSales());
  await assert.rejects(()=>cashStorage.closeCashSession('session-1',draft.expectedByMethodInCents,draft.sourceFingerprint),/pendente/);
  await assert.rejects(()=>finance.recoverCreditReservations([]),/gravar/);
  assert.equal(finance.loadSaleFinancialData().creditReservations.length,1);
  await finance.recoverCreditReservations([]); await finance.recoverCreditReservations([]);
  assert.equal(saleStorage.listSales()[1].id,saved.id);
  assert.equal(saleStorage.listSales().length,2);
  assert.equal(finance.loadSaleFinancialData().credits[0].balanceInCents,0);
  assert.equal(finance.loadSaleFinancialData().creditMovements.filter(item=>item.type==='redeemed').length,1);
});

test('Falha na venda e na liberação mantém reserva órfã até recuperação autenticada', async () => {
  const credit=await storedCredit();
  localStorage.failKey=saleStorage.SALES_STORAGE_KEY;
  localStorage.failOnWrites(finance.FINANCIAL_STORAGE_KEY,[2]);
  await assert.rejects(()=>saleStorage.saveCompletedSaleWithCustomerCredit([cartItem()],500,[creditPayment(credit,500)],'session-1'),/reserva foi preservada/);
  assert.equal(saleStorage.listSales().length,1);
  assert.equal(finance.loadSaleFinancialData().creditReservations.length,1);
  sessionStorage.clear();
  await assert.rejects(()=>finance.recoverCreditReservations(),/Entre/);
  assert.equal(finance.loadSaleFinancialData().creditReservations.length,1);
  adminAuth(); await finance.recoverCreditReservations();
  assert.equal(finance.loadSaleFinancialData().creditReservations.length,0);
  assert.equal(finance.loadSaleFinancialData().credits[0].balanceInCents,500);
});

test('Falha na restauração após cancelamento conserva status e restaura no reinício', async () => {
  const credit=await storedCredit();
  const sale=await saleStorage.saveCompletedSaleWithCustomerCredit([cartItem()],500,[creditPayment(credit,500)],'session-1');
  localStorage.failOnWrites(finance.FINANCIAL_STORAGE_KEY,[1]);
  await assert.rejects(()=>saleStorage.cancelSaleAndRestoreCustomerCredit(sale.id,'customer_cancelled'),/cancelamento foi gravado.*pendente/);
  assert.equal(saleStorage.getSaleById(sale.id).status,'cancelled');
  assert.equal(finance.loadSaleFinancialData().credits[0].balanceInCents,0);
  await assert.rejects(()=>issueCredit(saleStorage.getSaleById(sale.id),500),/pendente/);
  await finance.recoverCreditReservations(); await finance.recoverCreditReservations();
  assert.equal(finance.loadSaleFinancialData().credits[0].balanceInCents,500);
  assert.equal(finance.loadSaleFinancialData().creditMovements.filter(item=>item.type==='restored').length,1);
});

test('Reserva de venda cancelada interrompida é baixada e restaurada, sem simplesmente liberar evidências', async () => {
  const credit=await storedCredit();
  const sale=makeSale({id:'interrupted',number:2,status:'cancelled',total:500});
  sale.payments=[creditPayment(credit,500)];
  finance.reserveCreditRedemptions(sale.id,[{creditId:credit.id,amountInCents:500}]);
  localStorage.setItem(saleStorage.SALES_STORAGE_KEY,JSON.stringify([...saleStorage.listSales(),sale]));
  assert.throws(()=>finance.releaseCreditReservations(sale.id),/venda gravada/);
  await finance.recoverCreditReservations([]);
  assert.equal(finance.loadSaleFinancialData().credits[0].balanceInCents,500);
  assert.deepEqual(finance.loadSaleFinancialData().creditMovements.filter(item=>item.saleId===sale.id).map(item=>item.type),['redeemed','restored']);
});

test('Reserva incompatível permanece bloqueada para auditoria e não confirma consumo', async () => {
  const credit=await storedCredit();
  const sale=makeSale({id:'bad-reservation',number:2,total:500}); sale.payments=[creditPayment(credit,500)];
  finance.reserveCreditRedemptions(sale.id,[{creditId:credit.id,amountInCents:400}]);
  assert.throws(()=>finance.reserveCreditRedemptions(sale.id,[{creditId:credit.id,amountInCents:100}]),/já possui/);
  localStorage.setItem(saleStorage.SALES_STORAGE_KEY,JSON.stringify([...saleStorage.listSales(),sale]));
  await assert.rejects(()=>finance.recoverCreditReservations(),/não corresponde/);
  assert.equal(finance.loadSaleFinancialData().creditReservations.length,1);
  assert.equal(finance.loadSaleFinancialData().credits[0].balanceInCents,500);
  assert.throws(()=>backup.createBackupJson(),/relações/);
});

test('Concorrência de emissão em duas operações não duplica crédito nem excede elegível', async () => {
  const sale=makeSale({status:'cancelled',total:500});
  localStorage.setItem(saleStorage.SALES_STORAGE_KEY,JSON.stringify([sale]));
  const results=await Promise.allSettled([issueCredit(sale,500),issueCredit(sale,500)]);
  assert.equal(results.filter(item=>item.status==='fulfilled').length,1);
  assert.equal(finance.loadSaleFinancialData().credits.length,1);
  assert.equal(finance.getSaleResolvedAmount(sale.id),500);
});

test('Cenário A: caixa 100 + venda 40 mantém 140 ao cancelar, reembolso efetivo retorna a 100', async () => {
  const sale=await saleStorage.saveCompletedSale([cartItem(4000)],4000,[moneyPayment(4000)],'session-1');
  const session=cashSession('session-1',10000);
  assert.equal(cash.getCashSummary(session,[],saleStorage.listSales()).expectedInCents,14000);
  const cancelled=await saleStorage.cancelSaleAndRestoreCustomerCredit(sale.id,'customer_cancelled');
  assert.equal(cash.getCashSummary(session,[],saleStorage.listSales()).expectedInCents,14000);
  await finance.settleSaleBalance(cancelled,{amounts:{cash:4000,pix:0,debit:0,credit:0,customer_credit:0},cashSessionId:'session-1'});
  const draft=cash.getCashReconciliationDraft(session,[],saleStorage.listSales());
  assert.equal(draft.cashSummary.expectedInCents,10000);
  assert.equal(draft.netReceivedInCents,0);
  const closed=await cashStorage.closeCashSession('session-1',draft.expectedByMethodInCents,draft.sourceFingerprint);
  assert.equal(closed.sessions[0].reconciliation.refundTotalsInCents.cash,4000);
});

test('Cenário B: crédito emitido mantém 140, compra 65 com crédito 30 + dinheiro 35 resulta em 175 e crédito 10', async () => {
  const sale=await saleStorage.saveCompletedSale([cartItem(4000)],4000,[moneyPayment(4000)],'session-1');
  const cancelled=await saleStorage.cancelSaleAndRestoreCustomerCredit(sale.id,'customer_cancelled');
  const credit=(await issueCredit(cancelled,4000)).issuedCredits[0].credit;
  const session=cashSession('session-1',10000);
  assert.equal(cash.getCashSummary(session,[],saleStorage.listSales()).expectedInCents,14000);
  await saleStorage.saveCompletedSaleWithCustomerCredit([cartItem(6500)],6500,[creditPayment(credit,3000),moneyPayment(3500)],'session-1');
  const draft=cash.getCashReconciliationDraft(session,[],saleStorage.listSales());
  assert.equal(draft.cashSummary.expectedInCents,17500);
  assert.equal(draft.customerCreditConsumedInCents,3000);
  assert.equal(draft.paymentTotalsInCents.cash,7500);
  assert.equal(draft.netReceivedInCents,7500);
  assert.equal(finance.loadSaleFinancialData().credits[0].balanceInCents,1000);
  const incoming=backup.parseBackupJson(backup.createBackupJson()).backup;
  await backup.restoreBackup(incoming);
  assert.equal(finance.loadSaleFinancialData().credits[0].balanceInCents,1000);
  const closed=await cashStorage.closeCashSession('session-1',draft.expectedByMethodInCents,draft.sourceFingerprint);
  assert.equal(closed.sessions[0].reconciliation.customerCreditConsumedInCents,3000);
  assert.equal(closed.sessions[0].reconciliation.cashSummary.expectedInCents,17500);
});


function signedBackup(document) {
  let hash=0x811c9dc5;
  const raw=JSON.stringify(document.data);
  for(let index=0;index<raw.length;index++){hash^=raw.charCodeAt(index);hash=Math.imul(hash,0x01000193);}
  document.integrity.checksum=(hash>>>0).toString(16).padStart(8,'0');
  return JSON.stringify(document);
}

test('Backup rejeita crédito pago sem baixa ou reserva mesmo quando checksum e saldo conferem', async () => {
  const credit=await storedCredit();
  await saleStorage.saveCompletedSaleWithCustomerCredit([cartItem(300)],300,[creditPayment(credit,300)],'session-1');
  const document=JSON.parse(backup.createBackupJson());
  document.data.financial.creditMovements=document.data.financial.creditMovements.filter(item=>item.type!=='redeemed');
  document.data.financial.credits[0].balanceInCents=500; document.data.financial.credits[0].status='available';
  await assert.rejects(()=>backup.restoreBackup({...document,integrity:JSON.parse(signedBackup(document)).integrity}),/relações/);
  assert.equal(finance.loadSaleFinancialData().credits[0].balanceInCents,200);
});

test('Backup preserva reserva necessária após interrupção e recupera baixa após restaurar', async () => {
  const credit=await storedCredit();
  localStorage.failOnWrites(finance.FINANCIAL_STORAGE_KEY,[2]);
  await assert.rejects(()=>saleStorage.saveCompletedSaleWithCustomerCredit([cartItem(300)],300,[creditPayment(credit,300)],'session-1'),/pendente/);
  const document=backup.parseBackupJson(backup.createBackupJson()).backup;
  assert.equal(document.data.financial.creditReservations.length,1);
  await backup.restoreBackup(document);
  assert.equal(finance.loadSaleFinancialData().creditReservations.length,1);
  await finance.recoverCreditReservations();
  assert.equal(finance.loadSaleFinancialData().credits[0].balanceInCents,200);
  assert.equal(saleStorage.listSales().length,2);
});

test('Saldo de crédito repartido entre múltiplas vendas concorrentes usa números únicos e não perde baixa', async () => {
  const credit=await storedCredit();
  const results=await Promise.all([
    saleStorage.saveCompletedSaleWithCustomerCredit([cartItem(200)],200,[creditPayment(credit,200)],'session-1'),
    saleStorage.saveCompletedSaleWithCustomerCredit([cartItem(300)],300,[creditPayment(credit,300)],'session-1'),
  ]);
  assert.deepEqual(results.map(item=>item.number),[2,3]);
  assert.equal(finance.loadSaleFinancialData().credits[0].balanceInCents,0);
  await saleStorage.cancelSaleAndRestoreCustomerCredit(results[0].id,'customer_cancelled');
  assert.equal(finance.loadSaleFinancialData().credits[0].balanceInCents,200);
  await saleStorage.cancelSaleAndRestoreCustomerCredit(results[1].id,'customer_cancelled');
  assert.equal(finance.loadSaleFinancialData().credits[0].balanceInCents,500);
});

test('Não há fallback inseguro sem Web Locks e nenhum dado financeiro é alterado', async () => {
  const originalNavigator=globalThis.navigator;
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{}});
  try {
    await assert.rejects(()=>saleStorage.saveCompletedSale([cartItem()],500,[moneyPayment(500)],'session-1'),/bloqueio seguro/);
    assert.equal(saleStorage.listSales().length,0);
    assert.equal(finance.loadSaleFinancialData().creditReservations.length,0);
  } finally {Object.defineProperty(globalThis,'navigator',{configurable:true,value:originalNavigator});}
});


test('Reinício não oferece novamente o rascunho exato de venda já gravada com baixa interrompida', async () => {
  const credit=await storedCredit();
  localStorage.setItem('raiz-pdv:draft-cart',JSON.stringify([{productId:'p1',quantity:1,unitPriceInCents:300}]));
  localStorage.failOnWrites(finance.FINANCIAL_STORAGE_KEY,[2]);
  await assert.rejects(()=>saleStorage.saveCompletedSaleWithCustomerCredit([cartItem(300)],300,[creditPayment(credit,300)],'session-1'),/pendente/);
  await finance.recoverCreditReservations();
  assert.equal(localStorage.getItem('raiz-pdv:draft-cart'),null);
  assert.equal(saleStorage.listSales().length,2);
  assert.equal(finance.loadSaleFinancialData().credits[0].balanceInCents,200);
});

test('Recuperação preserva rascunho diferente do snapshot da venda interrompida', async () => {
  const credit=await storedCredit();
  const draft=JSON.stringify([{productId:'other',quantity:1,unitPriceInCents:123}]);
  localStorage.setItem('raiz-pdv:draft-cart',draft);
  localStorage.failOnWrites(finance.FINANCIAL_STORAGE_KEY,[2]);
  await assert.rejects(()=>saleStorage.saveCompletedSaleWithCustomerCredit([cartItem(300)],300,[creditPayment(credit,300)],'session-1'),/pendente/);
  await finance.recoverCreditReservations();
  assert.equal(localStorage.getItem('raiz-pdv:draft-cart'),draft);
});


test('Autorização expirada exige código novamente sem gravar venda nem reserva', async (t) => {
  const credit=await storedCredit();
  t.mock.timers.tick(6*60*1000);
  await assert.rejects(()=>saleStorage.saveCompletedSaleWithCustomerCredit([cartItem()],500,[creditPayment(credit,500)],'session-1'),/autorização/);
  assert.equal(saleStorage.listSales().length,1);
  assert.equal(finance.loadSaleFinancialData().creditReservations.length,0);
});
