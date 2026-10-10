const { _electron: electron, chromium } = require('playwright');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, readFileSync, existsSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { DatabaseSync } = require('node:sqlite');
const { resolve, join } = require('node:path');
const root = resolve(__dirname, '..');
const version = require('../package.json').version;
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
(async () => {
  mkdirSync(join(root, 'outputs', 'etapa-12b'), { recursive: true });
  if (!process.argv.includes('--production-only')) {
    const web = await chromium.launch({ channel: 'msedge', headless: true });
    try {
      const context = await web.newContext(); const page = await context.newPage();
      await page.goto('http://127.0.0.1:5173/'); await page.getByRole('heading', { name: 'Entrar no Raiz PDV' }).waitFor();
      assert.equal(await page.evaluate(() => typeof window.raizDesktop), 'undefined');
      await context.close(); console.log('PASS web: React funciona sem raizDesktop.');
    } finally { await web.close(); }
  }
  for (const mode of (process.argv.includes('--production-only') ? ['production'] : ['development', 'production'])) {
    const profile = mkdtempSync(join(tmpdir(), 'raiz-electron-12b-'));
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.RAIZ_DESKTOP_DEV_URL;
    if (mode === 'development') env.RAIZ_DESKTOP_DEV_URL = 'http://127.0.0.1:5173/';
    let desktop;
    try {
      desktop = await electron.launch({ args: [root, '--raiz-profile=' + profile], env, timeout: 20000 });
      const page = await desktop.firstWindow(); page.setDefaultTimeout(15000);
      const errors = []; page.on('pageerror', (error) => errors.push(error.message));
      await page.getByRole('heading', { name: 'Configurar Raiz PDV' }).waitFor();
      const sqlitePath = join(profile,'data',...(mode === 'development' ? ['development'] : []),'raiz-pdv.sqlite');
      assert.ok(existsSync(sqlitePath));
      const sqliteBefore = new DatabaseSync(sqlitePath,{readOnly:true});
      const installationBefore = sqliteBefore.prepare('SELECT * FROM installation_state').get();
      assert.equal(installationBefore.status,'testing');
      assert.equal(sqliteBefore.prepare('SELECT count(*) AS count FROM sales').get().count,0);
      sqliteBefore.close();
      const info = await page.evaluate(() => window.raizDesktop.getAppInfo());
      assert.deepEqual(info, { name: 'Raiz PDV', version, environment: 'desktop' });
      const isolation = await page.evaluate(() => ({ require: typeof require, process: typeof process, buffer: typeof Buffer, api: Object.keys(window.raizDesktop), secure: isSecureContext, locks: !!navigator.locks, crypto: !!crypto.subtle }));
      assert.deepEqual(isolation, { require: 'undefined', process: 'undefined', buffer: 'undefined', api: ['pdv','getAppInfo'], secure: true, locks: true, crypto: true });
      assert.equal(await page.evaluate(()=>window.raizDesktop.pdv['sales.list']({}).then(()=>false,error=>error.message)), 'UNAUTHORIZED');
      const preferences = await desktop.evaluate(({ BrowserWindow, app }) => { const window = BrowserWindow.getAllWindows()[0]; const preferences = window.webContents.getLastWebPreferences(); return { sandbox: preferences.sandbox, nodeIntegration: preferences.nodeIntegration, contextIsolation: preferences.contextIsolation, webSecurity: preferences.webSecurity, title: window.getTitle(), visible: window.isVisible(), minimum: window.getMinimumSize(), path: app.getPath('userData'), noSandbox: app.commandLine.hasSwitch('no-sandbox'), maximizable: window.isMaximizable(), maximized: window.isMaximized() }; });
      assert.equal(preferences.sandbox, true); assert.equal(preferences.noSandbox, false); assert.equal(preferences.maximizable, true); assert.equal(preferences.maximized, false); assert.equal(preferences.nodeIntegration, false); assert.equal(preferences.contextIsolation, true); assert.equal(preferences.webSecurity, true); assert.equal(preferences.visible, true); assert.equal(preferences.title, 'Raiz PDV'); assert.deepEqual(preferences.minimum, [1024,720]); assert.equal(preferences.path, profile);
      assert.equal(page.url(), mode === 'development' ? 'http://127.0.0.1:5173/' : 'raiz://app/index.html');
      assert.equal(await page.evaluate(async () => { try { await fetch('https://example.com'); return true; } catch { return false; } }), false);
      assert.equal(await page.evaluate(async () => { try { await fetch('file:///C:/Windows/win.ini'); return true; } catch { return false; } }), false);
      if (mode === 'production') {
        assert.equal(await page.evaluate(async () => { try { await fetch('http://127.0.0.1:5173/'); return true; } catch { return false; } }), false);
        assert.equal(await page.evaluate(async () => { try { return (await fetch('raiz://app/package.json')).ok; } catch { return false; } }), false);
        assert.equal(await page.evaluate(() => { const script = document.createElement('script'); script.textContent = 'window.inlineLeak=true'; document.body.append(script); return window.inlineLeak ?? false; }), false);
      }
      const unauthorized = await desktop.evaluate(async ({ BrowserWindow }, preloadPath) => {
        const owner = BrowserWindow.getAllWindows()[0];
        const rogue = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, preload: preloadPath } });
        try { await rogue.loadURL('data:text/html,<h1>Untrusted test document</h1>'); return await rogue.webContents.executeJavaScript('window.raizDesktop.getAppInfo().then(() => "allowed").catch(() => "rejected")'); }
        finally { rogue.destroy(); }
      }, join(root, 'dist-electron', 'preload', 'index.cjs'));
      assert.equal(unauthorized, 'rejected');
      // Test-only sandboxed preload attacks explicit/unknown IPC from an unauthorized document.
      const attackPath = join(profile, 'attack-preload.cjs');
      writeFileSync(attackPath, `const { contextBridge, ipcRenderer } = require('electron'); contextBridge.exposeInMainWorld('probe', async () => { const denied = await ipcRenderer.invoke('raiz:desktop:app-info', { arbitrary: true }); let unknown = false; try { await ipcRenderer.invoke('raiz:sqlite:execute'); } catch { unknown = true; } return { code: denied.error.code, unknown }; });`);
      const ipc = await desktop.evaluate(async ({ BrowserWindow }, attackPath) => {
        const owner = BrowserWindow.getAllWindows()[0];
        const attacker = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, preload: attackPath } });
        try { await attacker.loadURL('data:text/html,<h1>Untrusted IPC test</h1>'); return await attacker.webContents.executeJavaScript('window.probe()'); }
        finally { attacker.destroy(); }
      }, attackPath);
      assert.deepEqual(ipc, { code: 'UNAUTHORIZED', unknown: true });
      const sqliteAfterAttack = new DatabaseSync(sqlitePath,{readOnly:true});
      assert.deepEqual(sqliteAfterAttack.prepare('SELECT * FROM installation_state').get(),installationBefore);
      assert.equal(sqliteAfterAttack.prepare('SELECT count(*) AS count FROM operation_requests').get().count,0);
      sqliteAfterAttack.close();
      await page.getByLabel('Nome do estabelecimento',{exact:true}).fill('Loja Smoke');
      await page.getByLabel('Nome do administrador',{exact:true}).fill('Mestre Smoke');
      await page.getByLabel('Usuário do administrador',{exact:true}).fill('Admin');
      await page.getByLabel('Senha do administrador',{exact:true}).fill('senha-smoke');
      await page.getByLabel('Confirmar senha',{exact:true}).fill('senha-smoke');
      await page.getByLabel('Finalidade').selectOption('testing');
      await page.getByLabel('Conferi os dados e autorizo concluir a configuração').check();
      await page.getByRole('button',{name:'Concluir configuração',exact:true}).click();
      await page.getByRole('textbox', { name: 'Operador', exact: true }).fill('Admin');
      await page.getByLabel('Senha', { exact: true }).fill('senha-smoke');
      await page.getByRole('button', { name: 'Entrar', exact: true }).click();
      await page.evaluate(()=>window.raizDesktop.pdv['catalog.save']({products:[{id:'smoke',name:'Produto Smoke',priceInCents:1000,category:'Teste',active:true,emoji:'P'}]}));
      await page.reload();await page.getByRole('textbox',{name:'Operador',exact:true}).fill('Admin');await page.getByLabel('Senha',{exact:true}).fill('senha-smoke');await page.getByRole('button',{name:'Entrar',exact:true}).click();
      await page.getByRole('button', { name: '＋ Abrir caixa', exact: true }).click();
      await page.locator('#cash-amount').fill('100');
      await page.getByRole('button', { name: 'Abrir caixa', exact: true }).click();
      await page.locator('.cash-status.is-open').waitFor();
      await page.getByRole('button', { name: 'Nova venda', exact: true }).click();
      await page.locator('[data-testid^="product-"]').first().click();
      await page.getByRole('button', { name: /^Finalizar venda/ }).click();
      await page.getByRole('button', { name: 'Adicionar pagamento', exact: true }).click();
      await page.getByRole('button', { name: 'Finalizar venda', exact: true }).click();
      await page.getByRole('heading', { name: 'Venda concluída!' }).waitFor();
      assert.equal(await page.evaluate(() => localStorage.getItem('raiz-pdv:completed-sales')),null);assert.equal(await page.evaluate(()=>window.raizDesktop.pdv['sales.list']({}).then(s=>s.length)),1);
      await page.getByRole('button', { name: /Nova venda/ }).last().click();
      await page.getByRole('button', { name: 'Configurações', exact: true }).click();
      const backupPath = join(mkdtempSync(join(tmpdir(),'raiz-smoke-backup-')),'backup.raizbackup');
      await desktop.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path});},backupPath);
      await page.getByLabel('Senha de recuperação',{exact:true}).fill('recuperacao-smoke-segura');
      await page.getByRole('button',{name:'Criar backup externo',exact:true}).click();
      await page.getByText(/Backup criado, verificado e recuperado/).waitFor();
      assert.ok(existsSync(backupPath));const backup=JSON.parse(readFileSync(backupPath,'utf8'));assert.equal(backup.format,'raiz-pdv-sqlite-backup');assert.equal(backup.version,1);assert.ok(!JSON.stringify(backup).includes('senha-smoke'));
      await page.getByRole('button', { name: 'Caixa', exact: true }).click();
      await page.locator('.cash-net-sales').waitFor();
      await page.screenshot({ path: join(root, 'outputs', 'etapa-12b', mode + '.png') });
      const before = page.url();
      await page.evaluate(() => { window.open('https://example.com'); location.href = 'https://example.com'; });
      await wait(200); assert.equal(page.url(), before); assert.equal(desktop.windows().length, 1);
      assert.deepEqual(errors, []);
      await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer());
      let failureText = '';
      for (let i = 0; i < 50 && !failureText.includes('RENDERER_EXITED'); i++) {
        await wait(100);
        failureText = await desktop.evaluate(async ({ BrowserWindow }) => { const contents = BrowserWindow.getAllWindows()[0].webContents; if (contents.isLoading() || contents.getURL() !== 'raiz://app/desktop-error.html') return ''; try { return await contents.executeJavaScript('document.body.innerText'); } catch { return ''; } });
      }
      assert.match(failureText, /Não foi possível iniciar[\s\S]*RENDERER_EXITED/);
      await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
      await desktop.close(); desktop = null;
      desktop = await electron.launch({ args: [root, '--raiz-profile=' + profile], env, timeout: 20000 });
      const reopened = await desktop.firstWindow();
      await reopened.getByRole('heading', { name: 'Entrar no Raiz PDV' }).waitFor();
      assert.equal(await reopened.evaluate(() => localStorage.getItem('raiz-pdv:completed-sales')),null);
      assert.equal(await reopened.evaluate(() => sessionStorage.getItem('raiz-pdv:operator-session')), null);
      await desktop.close(); desktop = null;
      const sqliteReopened = new DatabaseSync(sqlitePath,{readOnly:true});
      assert.deepEqual(sqliteReopened.prepare('SELECT * FROM installation_state').get(),installationBefore);
      assert.equal(sqliteReopened.prepare('SELECT count(*) AS count FROM sales').get().count,1,'A venda está somente no backend SQLite.');
      sqliteReopened.close();
      console.log('PASS Electron ' + mode + ': React, preload/IPC, sandbox/isolamento, políticas de navegação/rede, venda/backup, diagnóstico de crash e persistência após reinício com perfil isolado.');
    } finally { if (desktop) await desktop.close(); }
  }
})().catch((error) => { console.error(error); process.exit(1); });
