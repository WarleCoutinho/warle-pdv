const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const profile = mkdtempSync(join(tmpdir(), 'raiz-launcher-12b-'));
  const root = resolve(__dirname, '..');
  const child = spawn(process.execPath, ['scripts/dev-desktop.mjs', '--raiz-profile=' + profile, '--remote-debugging-port=0'], { cwd: root, windowsHide: true, stdio: ['ignore','pipe','pipe'] });
  let browser; let finished = false;
  const exit = new Promise((done) => child.on('exit', (code) => { finished = true; done(code); }));
  try {
    const endpoint = await new Promise((done, reject) => {
      let output = ''; const timer = setTimeout(() => reject(new Error('O launcher desktop não abriu a janela.')), 20000);
      const read = (data) => { output += data.toString(); const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) { clearTimeout(timer); done(match[1]); } };
      child.stdout.on('data', read); child.stderr.on('data', read); child.on('error', reject); child.on('exit', () => { clearTimeout(timer); reject(new Error('Launcher encerrou antes de abrir a janela: ' + output)); });
    });
    browser = await chromium.connectOverCDP(endpoint);
    const context = browser.contexts()[0]; const page = context.pages()[0] ?? await context.waitForEvent('page');
    await page.getByRole('heading', { name: 'Configurar Raiz PDV' }).waitFor();
    assert.equal((await page.evaluate(() => window.raizDesktop.getAppInfo())).name, 'Raiz PDV');
    await page.evaluate(() => window.close());
    const code = await Promise.race([exit, new Promise((_, reject) => setTimeout(() => reject(new Error('Launcher não encerrou após fechar a janela.')), 10000))]);
    assert.equal(code, 0); console.log('PASS launcher dev: compilação, Vite local, abertura Electron e encerramento ao fechar a janela.');
  } finally { if (!finished) child.kill(); await browser?.close().catch(() => {}); }
})().catch((error) => { console.error(error); process.exit(1); });
