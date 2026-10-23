const { chromium } = require('playwright');
const assert = require('node:assert/strict');

(async () => {
  const { createServer } = await import('vite');
  const server = await createServer({ server: { host: '127.0.0.1', port: 5187, strictPort: true } });
  await server.listen();
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto('http://127.0.0.1:5187');
    await page.getByLabel('Operador', { exact: true }).fill('Admin');
    await page.getByLabel('Senha', { exact: true }).fill('123456');
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    const launcher = page.getByRole('button', { name: 'Assistente', exact: true });
    await launcher.click();
    const input = page.getByLabel('Qual é sua dúvida?');
    assert.equal(await input.evaluate(element => element === document.activeElement), true);
    await page.getByRole('button', { name: 'O que é sangria?', exact: true }).click();
    await page.getByRole('log').getByText(/Sangria é uma retirada/).waitFor();
    await page.getByRole('button', { name: 'Relatórios', exact: true }).click();
    await page.getByText('Você está em Relatórios', { exact: true }).waitFor();
    const before = await page.evaluate(() => JSON.stringify(localStorage));
    await input.fill('O que essa tela de faturamento está me mostrando é o resultado final líquido ou bruto?');
    await input.press('Enter');
    await page.getByRole('log').getByText(/Por isso, não é lucro líquido/).waitFor();
    await input.fill('Qual é a previsão do tempo?');
    await input.press('Enter');
    await page.getByRole('log').getByText(/Ainda não tenho uma orientação local/).waitFor();
    assert.equal(await page.evaluate(() => JSON.stringify(localStorage)), before, 'Guidance must not mutate persisted data');
    await input.press('Escape');
    assert.equal(await launcher.getAttribute('aria-expanded'), 'false');
    assert.equal(await launcher.evaluate(element => element === document.activeElement), true);
    await page.setViewportSize({ width: 390, height: 760 });
    await launcher.click();
    const bounds = await page.locator('#operator-assistant-panel').boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390 && bounds.y >= 0);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByRole('button', { name: 'Fechar assistente', exact: true }).click();
    await page.getByRole('button', { name: 'Nova venda', exact: true }).click();
    await launcher.click();
    await page.getByRole('button', { name: 'Conhecer a tela de venda →' }).click();
    await page.getByRole('heading', { name: 'Primeiro, abra seu caixa' }).waitFor();
    await page.getByRole('button', { name: 'Concluir', exact: true }).click();
    await page.getByRole('button', { name: 'Abrir caixa', exact: true }).click();
    await page.getByRole('button', { name: '＋ Abrir caixa', exact: true }).click();
    await page.locator('#cash-amount').fill('0');
    await page.getByRole('button', { name: 'Abrir caixa', exact: true }).click();
    await page.locator('.cash-modal').waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'Nova venda', exact: true }).click();
    await page.getByRole('searchbox', { name: 'Buscar produto pelo nome' }).waitFor();
    await launcher.click();
    await page.getByRole('button', { name: 'Conhecer a tela de venda →' }).click();
    const tourBefore = await page.evaluate(() => JSON.stringify(localStorage));
    await page.screenshot({ path: 'outputs/assistant-tour-desktop.png' });
    assert.equal(await page.getByRole('button', { name: 'Anterior', exact: true }).isDisabled(), true);
    for (let step = 1; step <= 6; step++) {
      await page.getByText(`Assistente Raiz · ${step} de 6`, { exact: true }).waitFor();
      await page.locator('.guide-highlight').waitFor();
      const box = await page.locator('.guide-coach').boundingBox();
      assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= 1280 && box.y + box.height <= 900);
      if (step === 2) {
        await page.getByRole('button', { name: 'Anterior', exact: true }).click();
        await page.getByRole('heading', { name: 'Sua tela de venda', exact: true }).waitFor();
        await page.getByRole('button', { name: 'Próximo', exact: true }).click();
      }
      await page.getByRole('button', { name: step === 6 ? 'Concluir' : 'Próximo', exact: true }).click();
    }
    assert.equal(await page.evaluate(() => JSON.stringify(localStorage)), tourBefore);
    assert.equal(await page.locator('.guide-highlight').count(), 0);
    await page.setViewportSize({ width: 390, height: 760 });
    await launcher.click();
    await page.getByRole('button', { name: 'Conhecer a tela de venda →' }).click();
    await page.getByRole('button', { name: 'Próximo', exact: true }).click();
    await page.waitForTimeout(100);
    const mobileGuide = await page.locator('.guide-coach').boundingBox();
    await page.screenshot({ path: 'outputs/assistant-tour-mobile.png' });
    assert.ok(mobileGuide.x >= 0 && mobileGuide.x + mobileGuide.width <= 390 && mobileGuide.y >= 0 && mobileGuide.y + mobileGuide.height <= 760);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.sale-guide').count(), 0);
    await page.setViewportSize({ width: 1280, height: 900 });
    await launcher.click();
    await page.getByRole('button', { name: 'Conhecer a tela de venda →' }).click();
    await page.getByRole('button', { name: 'Tenho uma dúvida' }).click();
    await input.waitFor();
    assert.equal(await page.locator('.sale-guide').count(), 0);
    await page.getByRole('button', { name: 'Fechar assistente', exact: true }).click();
    for (const [name, minimum] of [['Início', 4], ['Relatórios', 4], ['Produtos', 3], ['Histórico', 3], ['Caixa', 5], ['Configurações', 4]]) {
      await page.getByRole('button', { name, exact: true }).click();
      // Wait for asynchronous financial sections before taking the available-step snapshot.
      if (['Início', 'Relatórios', 'Histórico'].includes(name)) await page.locator('.analytics-financial-summary').waitFor();
      if (name === 'Caixa') await page.locator('.cash-payment-summary').waitFor();
      await launcher.click();
      await page.getByRole('button', { name: 'Conhecer esta tela →', exact: true }).click();
      const persisted = await page.evaluate(() => JSON.stringify(localStorage));
      let count = 0;
      while (true) {
        await page.locator('.guide-highlight').waitFor();
        assert.equal(await page.locator('.guide-missing').count(), 0, `${name}: guide target available`);
        count++;
        if (await page.getByRole('button', { name: 'Concluir', exact: true }).count()) {
          await page.getByRole('button', { name: 'Concluir', exact: true }).click();
          break;
        }
        assert.ok(count < 10, 'Tour must terminate');
        await page.getByRole('button', { name: 'Próximo', exact: true }).click();
      }
      assert.ok(count >= minimum, `${name}: expected at least ${minimum} steps, got ${count}`);
      assert.equal(await page.evaluate(() => JSON.stringify(localStorage)), persisted, `${name}: no data mutations`);
      assert.equal(await page.locator('.guide-highlight').count(), 0);
    }
    await page.getByRole('button', { name: 'Relatórios', exact: true }).click();
    await launcher.click();
    await page.getByRole('button', { name: 'Conhecer esta tela →', exact: true }).click();
    await page.getByRole('button', { name: 'Início', exact: true }).click();
    assert.equal(await page.locator('.sale-guide').count(), 0, 'Navigation closes the previous screen tour');
    await page.getByRole('button', { name: 'Sair / trocar operador', exact: true }).click();
    await page.getByRole('heading', { name: 'Entrar no Raiz PDV' }).waitFor();
    assert.equal(await page.locator('.operator-assistant').count(), 0);
    console.log('Assistant UI: all seven screen tours, chat, blocked cash, previous/next, highlight cleanup, no mutations, keyboard, mobile, navigation, question handoff and logout passed.');
  } finally {
    await browser?.close();
    await server.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
