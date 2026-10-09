import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

class MemoryStorage {
  data = new Map(); failKey = null;
  getItem(key) { return this.data.has(key) ? this.data.get(key) : null; }
  setItem(key, value) { if (this.failKey === key) { this.failKey = null; throw new Error('quota'); } this.data.set(key, String(value)); }
  removeItem(key) { this.data.delete(key); }
  clear() { this.data.clear(); this.failKey = null; }
}
globalThis.localStorage = new MemoryStorage();
globalThis.sessionStorage = new MemoryStorage();
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: { request: async (_name, _options, callback) => callback() } } });
const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true, hmr: false }, appType: 'custom' });
const finance = await vite.ssrLoadModule('/src/services/saleFinancialStorage.ts');
const saleStorage = await vite.ssrLoadModule('/src/services/saleStorage.ts');
const cash = await vite.ssrLoadModule('/src/utils/cash.ts');
const analytics = await vite.ssrLoadModule('/src/utils/salesAnalytics.ts');
const access = await vite.ssrLoadModule('/src/services/operatorAccess.ts');
const adminAuth = () => sessionStorage.setItem(access.OPERATOR_SESSION_KEY, JSON.stringify({ id: access.DEFAULT_ADMIN.id, credential: access.DEFAULT_ADMIN.passwordDigest }));
const operatorAuth = (id) => sessionStorage.setItem(access.OPERATOR_SESSION_KEY, JSON.stringify({ id, credential: access.DEFAULT_ADMIN.passwordDigest }));
after(() => vite.close());
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); adminAuth(); localStorage.setItem('raiz-pdv:cash', JSON.stringify({ sessions: [{ id: 'session-1', operatorId: 'raiz-admin', operatorName: 'Administrador Mestre', openedAt: '2026-10-08T10:00:00.000Z', openingAmountInCents: 10000, status: 'open' }], movements: [] })); });

function makeSale({ id = 'sale-1', number = 1, total = 1000, status = 'completed', method = 'pix', session = 'session-1', items } = {}) {
  const lines = items ?? [{ productId: 'p1', productName: 'Produto', unitPriceInCents: total, quantity: 1, subtotalInCents: total }];
  const payment = method === 'cash' ? { method, amountInCents: total, amountReceivedInCents: total, changeInCents: 0 } : { method, amountInCents: total };
  return { id, number, date: '2026-10-08T11:00:00.000Z', cashSessionId: session,
    ...(status === 'cancelled' ? { status, cancelledAt: '2026-10-08T11:10:00.000Z', cancellationReason: 'customer_cancelled' } : { status }),
    items: lines, totalInCents: total, payments: [payment] };
}

function cashSession(id = 'session-1', opening = 0) { return { id, operatorId: 'raiz-admin', operatorName: 'Administrador Mestre', openedAt: '2026-10-08T10:00:00.000Z', openingAmountInCents: opening, status: 'open' }; }

async function issueCredit(sale, cents) {
  return finance.settleSaleBalance(sale, { amounts: { cash: 0, pix: 0, debit: 0, credit: 0, customer_credit: cents }, cashSessionId: sale.cashSessionId });
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
  finance.recordMerchandiseReturn(sale, { p1: 1 });
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
  finance.updatePendingRefund(data.refunds[0].id, 'failed');
  assert.equal(finance.getSaleUnresolvedAmount(sale), 900);
  assert.throws(() => finance.updatePendingRefund(data.refunds[0].id, 'completed'), /pendente/);
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
  finance.recordMerchandiseReturn(sale, { p1: 1 });
  finance.recordMerchandiseReturn(sale, { p1: 2 });
  assert.equal(finance.getSaleEligibleAmount(sale), 1200);
  assert.throws(() => finance.recordMerchandiseReturn(sale, { p1: 1 }), /excede/);
  await issueCredit(sale, 1200);
  assert.equal(finance.getSaleUnresolvedAmount(sale), 0);
});

test('Conclusão de pendência usa caixa atual e não modifica fechamento anterior', async () => {
  const sale = makeSale({ status: 'cancelled', total: 900 });
  const { data } = await finance.settleSaleBalance(sale, { amounts: { cash: 900, pix: 0, debit: 0, credit: 0, customer_credit: 0 }, statuses: { cash: 'pending' }, cashSessionId: 'session-1' });
  const old = { id: 'session-1', openedAt: '2026-10-08T10:00:00.000Z', status: 'closed', openingAmountInCents: 1000, closedAt: '2026-10-08T12:00:00.000Z', countedAmountInCents: 1000, expectedAmountInCents: 1000, differenceInCents: 0 };
  const current = cashSession('session-2', 1000);
  localStorage.setItem('raiz-pdv:cash', JSON.stringify({ sessions: [old, current], movements: [] }));
  assert.throws(() => finance.updatePendingRefund(data.refunds[0].id, 'completed', 'session-1'), /atual aberto/);
  finance.updatePendingRefund(data.refunds[0].id, 'completed', 'session-2');
  assert.equal(finance.getSessionRefundTotals('session-1').cash, 0);
  assert.equal(finance.getSessionRefundTotals('session-2').cash, 900);
  assert.deepEqual(JSON.parse(localStorage.getItem('raiz-pdv:cash')).sessions[0], old);
  assert.throws(() => finance.updatePendingRefund(data.refunds[0].id, 'completed', 'session-2'), /pendente/);
});

test('Reembolso realizado não excede dinheiro físico; pendente não é saída', async () => {
  localStorage.setItem('raiz-pdv:cash', JSON.stringify({ sessions: [cashSession('session-1', 100)], movements: [] }));
  const sale = makeSale({ status: 'cancelled', total: 500 });
  await assert.rejects(() => finance.settleSaleBalance(sale, { amounts: { cash: 500, pix: 0, debit: 0, credit: 0, customer_credit: 0 }, cashSessionId: 'session-1' }), /saldo físico/);
  const { data } = await finance.settleSaleBalance(sale, { amounts: { cash: 500, pix: 0, debit: 0, credit: 0, customer_credit: 0 }, statuses: { cash: 'pending' }, cashSessionId: 'session-1' });
  assert.equal(finance.getSessionRefundTotals('session-1').cash, 0);
  assert.throws(() => finance.updatePendingRefund(data.refunds[0].id, 'completed', 'session-1'), /saldo físico/);
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
  finance.recordMerchandiseReturn(sale, { p1: 1 });
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

test('Gráficos excluem cancelamentos e vendas fora do período; devolução total mantém faturamento original', () => {
  const sale = makeSale({ total: 500 });
  finance.recordMerchandiseReturn(sale, { p1: 1 });
  const cancelled = makeSale({ id: 'cancelled', status: 'cancelled', total: 2000 });
  const older = { ...makeSale({ id: 'older', total: 3000 }), date: '2026-09-01T12:00:00.000Z' };
  const data = finance.loadSaleFinancialData();
  const metrics = analytics.getSalesMetrics([sale, cancelled], data);
  assert.equal(metrics.revenueInCents, 500);
  assert.equal(metrics.netSalesInCents, 0);
  assert.equal(metrics.saleCount, 1);
  for (const period of ['today', 'week', 'month']) assert.equal(analytics.getSalesTrend([sale, cancelled, older], period, new Date(sale.date), data).reduce((sum, bucket) => sum + bucket.revenueInCents, 0), 500);
});

test('Distribuição inclui crédito de cliente e mantém modalidade e troco corretos', () => {
  const sale = makeSale({ total: 1000 });
  sale.payments = [{ method: 'customer_credit', customerCreditId: 'credit', amountInCents: 300 }, { method: 'cash', amountInCents: 700, amountReceivedInCents: 1000, changeInCents: 300 }];
  assert.deepEqual(analytics.getPaymentTotals([sale]), { cash: 700, pix: 0, debit: 0, credit: 0, customer_credit: 300 });
});

test('Resumo usa data efetiva do reembolso e separa pendência, falha e emissão de crédito', () => {
  const financial = { returns: [], credits: [{ issuedAt: '2026-10-08T12:00:00', originalAmountInCents: 200 }], creditMovements: [], creditReservations: [], refunds: [
    { method: 'pix', status: 'completed', amountInCents: 500, createdAt: '2026-10-07T12:00:00', completedAt: '2026-10-08T12:00:00' },
    { method: 'debit', status: 'pending', amountInCents: 300, createdAt: '2026-10-08T12:00:00' },
    { method: 'cash', status: 'failed', amountInCents: 900, createdAt: '2026-10-08T12:00:00' },
    { method: 'customer_credit', status: 'completed', amountInCents: 200, createdAt: '2026-10-08T12:00:00', completedAt: '2026-10-08T12:00:00' },
  ] };
  assert.deepEqual(analytics.getFinancialPeriodSummary(financial, 'today', new Date('2026-10-08T15:00:00')), { refundedInCents: 500, pendingInCents: 300, issuedCreditInCents: 200 });
  assert.equal(analytics.getFinancialPeriodSummary(financial, 'today', new Date('2026-10-07T15:00:00')).refundedInCents, 0);
});

test('Vendas legadas sem status continuam nos indicadores sem eventos inventados', () => {
  const sale = makeSale(); delete sale.status;
  const metrics = analytics.getSalesMetrics([sale]);
  assert.equal(metrics.revenueInCents, 1000);
  assert.equal(metrics.saleCount, 1);
  assert.equal(analytics.getSalesMetrics([]).averageTicketInCents, 0);
});


test('Duas vendas de 25 e 10 com devoluções em crédito mantêm faturamento 35', async () => {
  const first = makeSale({ id: 'first', number: 1, total: 2500, items: [{ productId: 'p1', productName: 'Produto', unitPriceInCents: 500, quantity: 5, subtotalInCents: 2500 }] });
  const second = makeSale({ id: 'second', number: 2, total: 1000 });
  finance.recordMerchandiseReturn(first, { p1: 2 });
  finance.recordMerchandiseReturn(second, { p1: 1 });
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
  finance.recordMerchandiseReturn(first, { p1: 2 }); finance.recordMerchandiseReturn(second, { p1: 1 });
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

test('Somente reembolso realizado reduz recebido líquido; pendente e falha não reduzem', () => {
  const sale = makeSale({ total: 3500 });
  const refunds = [{ method: 'customer_credit', status: 'completed', amountInCents: 1000 }, { method: 'pix', status: 'pending', amountInCents: 500 }, { method: 'cash', status: 'failed', amountInCents: 200 }, { method: 'debit', status: 'completed', amountInCents: 300 }];
  const summary = analytics.getReceivedSummary([sale], refunds);
  assert.equal(summary.refundedInCents, 300); assert.equal(summary.netReceivedInCents, 3200);
});

test('Cancelada permanece em recebimentos até reembolso e crédito usado não é dinheiro novo', () => {
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
