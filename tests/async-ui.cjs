const { chromium } = require('playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const errors = [];
  try {
    const context = await browser.newContext({ timezoneId: 'America/Sao_Paulo', viewport: { width: 1280, height: 950 } });
    const page = await context.newPage(); page.setDefaultTimeout(10000); page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
      window.harnessOptions = { failProducts: true, holdDraft: true };
      if (localStorage.getItem('async-seeded')) return;
      localStorage.setItem('async-seeded', 'yes');
      const now = new Date().toISOString();
      const digest = 'pbkdf2$210000$f0b1c2d3e4a5968778695a4b3c2d1e0f$b84de8daef4e4446728eae9b4538c581263a0016be025069784688ab3df51d56';
      localStorage.setItem('raiz-pdv:products', JSON.stringify([{ id: 'p', name: 'Produto', category: 'Categoria', emoji: 'X', active: true, priceInCents: 500 }]));
      localStorage.setItem('raiz-pdv:cash', JSON.stringify({ sessions: [{ id: 'today', operatorId: 'raiz-admin', operatorName: 'Admin', openedAt: now, openingAmountInCents: 10000, status: 'open' }], movements: [] }));
      localStorage.setItem('raiz-pdv:draft-cart', JSON.stringify([{ productId: 'p', quantity: 2, unitPriceInCents: 500 }]));
      sessionStorage.setItem('raiz-pdv:operator-session', JSON.stringify({ id: 'raiz-admin', credential: digest }));
    });
    await page.goto('http://127.0.0.1:5173/tests/async-harness.html');
    await page.getByRole('alert').filter({ hasText: 'Falha de carregamento simulada' }).waitFor();
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('raiz-pdv:draft-cart'))[0].quantity), 2);
    await page.evaluate(() => { window.harness.failProducts = false; });
    await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Carregando carrinho' }).waitFor();
    assert.equal(await page.getByTestId('product-p').count(), 0);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('raiz-pdv:draft-cart'))[0].quantity), 2);
    await page.waitForFunction(() => window.harness.draftPending);
    await page.evaluate(() => window.harness.draftPending());
    await page.getByTestId('product-p').waitFor();
    await page.getByRole('button', { name: /^Finalizar venda/ }).click();
    await page.getByRole('button', { name: 'Adicionar pagamento', exact: true }).click();
    await page.evaluate(() => { window.harness.failComplete = true; });
    await page.getByRole('button', { name: 'Finalizar venda', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Falha de persistência simulada' }).waitFor();
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('raiz-pdv:draft-cart'))[0].quantity), 2);
    assert.equal(await page.evaluate(() => localStorage.getItem('raiz-pdv:completed-sales')), null);
    await page.evaluate(() => { window.harness.failComplete = false; window.harness.holdComplete = true; });
    await page.getByRole('button', { name: 'Finalizar venda', exact: true }).evaluate((button) => { button.click(); button.click(); });
    await page.waitForFunction(() => window.harness.savePending);
    assert.equal(await page.evaluate(() => window.harness.completeCalls), 2); // one failed command + one double-clicked command
    assert.equal(await page.evaluate(() => localStorage.getItem('raiz-pdv:completed-sales')), null);
    await page.evaluate(() => window.harness.savePending());
    await page.getByRole('heading', { name: /Venda concluída/ }).waitFor();
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('raiz-pdv:completed-sales')).length), 1);
    await page.getByRole('button', { name: /Nova venda|Iniciar nova/ }).last().click();
    await page.evaluate(() => { window.harness.holdSnapshots = true; });
    await page.getByRole('button', { name: 'Histórico', exact: true }).click();
    await page.waitForFunction(() => window.harness.pending.length === 1);
    await page.evaluate(() => window.dispatchEvent(new Event('raiz-pdv:data-changed')));
    await page.waitForFunction(() => window.harness.pending.length === 2);
    await page.evaluate(() => { const request = window.harness.pending[1]; request.value.sales[0].number = 999; request.resolve(request.value); });
    await page.getByRole('button', { name: 'Ver detalhes' }).waitFor();
    assert.match(await page.locator('.history-table-card').innerText(), /999/);
    await page.evaluate(() => window.harness.pending[0].resolve(window.harness.pending[0].value));
    // A task boundary lets the obsolete promise settle; the latest result must remain visible.
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    assert.match(await page.locator('.history-table-card').innerText(), /999/);
    await page.evaluate(() => window.dispatchEvent(new Event('raiz-pdv:data-changed')));
    await page.waitForFunction(() => window.harness.pending.length === 3);
    await page.getByRole('button', { name: 'Produtos', exact: true }).click();
    await page.getByRole('heading', { name: 'Produtos', exact: true }).waitFor();
    await page.evaluate(() => window.harness.pending[2].reject(new Error('Resposta após desmontagem')));
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    assert.equal(await page.getByRole('alert').count(), 0);
    // Two actual browser tabs call the new ports, sharing the real Web Lock.
    const issued = await page.evaluate(async () => {
      const repos = window.harness.repositories;
      const sale = (await repos.sales.list())[0];
      await repos.financial.recordReturn(sale, { [sale.items[0].lineId]: 2 }, 'today');
      const result = await repos.financial.settle(sale, { amounts: { cash: 0, pix: 0, debit: 0, credit: 0, customer_credit: 1000 }, cashSessionId: 'today' });
      const { credit, authCode } = result.issuedCredits[0]; return { credit, authCode };
    });
    const other = await context.newPage(); other.on('pageerror', (error) => errors.push(error.message));
    await other.goto('http://127.0.0.1:5173/');
    await other.evaluate(async () => {
      const { createWebRepositories } = await import('/src/persistence/index.ts');
      window.testRepositories = createWebRepositories(); await window.testRepositories.operators.login('Admin', '123456');
    });
    const redeem = (tab, useHarness) => tab.evaluate(async ({ issued, useHarness }) => {
      const repos = useHarness ? window.harness.repositories : window.testRepositories;
      await repos.credits.authenticate(issued.credit.receiptNumber, issued.authCode);
      const product = (await repos.products.list())[0];
      try {
        await repos.sales.complete({ items: [{ product, quantity: 2, unitPriceInCents: 500, subtotalInCents: 1000 }], totalInCents: 1000, cashSessionId: 'today', payments: [{ method: 'customer_credit', amountInCents: 1000, customerCreditId: issued.credit.id }] });
        return true;
      } catch { return false; }
    }, { issued, useHarness });
    await page.evaluate(() => { window.harness.holdComplete = false; });
    const redemptions = await Promise.all([redeem(page, true), redeem(other, false)]);
    assert.equal(redemptions.filter(Boolean).length, 1);
    const ledger = await other.evaluate(async () => window.testRepositories.financial.snapshot());
    assert.equal(ledger.financial.creditMovements.filter((movement) => movement.type === 'redeemed').length, 1);
    assert.equal(ledger.financial.credits[0].balanceInCents, 0);
    assert.equal(new Set(ledger.sales.map((sale) => sale.number)).size, ledger.sales.length);
    await other.close();
    assert.deepEqual(errors, []);
    await context.close();
    console.log('PASS: falha/retry na inicialização, hidratação preserva carrinho, persistência pendente não mostra sucesso, dupla submissão, resposta obsoleta, desmontagem e baixa concorrente por contratos em duas abas.');
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exit(1); });
