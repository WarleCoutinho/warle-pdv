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
    await page.getByRole('button', { name: 'Sair / trocar operador', exact: true }).click();
    await page.getByRole('heading', { name: 'Entrar no Raiz PDV' }).waitFor();
    assert.equal(await page.locator('.operator-assistant').count(), 0);
    console.log('Assistant UI: context, answers, fallback, no mutations, keyboard, mobile and logout passed.');
  } finally {
    await browser?.close();
    await server.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
