const { _electron: electron } = require('playwright');
const { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, cpSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  for (const code of ['MISSING_PRELOAD','MISSING_RENDERER','PRELOAD_ERROR','IPC_FAILED','LOAD_FAILED']) {
    const bundle = mkdtempSync(join(tmpdir(), 'raiz startup 12b '));
    mkdirSync(join(bundle, 'dist-electron', 'main'), { recursive: true });
    for (const file of ['index.cjs','security.cjs']) copyFileSync(resolve('dist-electron','main',file), join(bundle,'dist-electron','main',file));
    cpSync(resolve('dist-electron','main','sqlite'),join(bundle,'dist-electron','main','sqlite'),{recursive:true});
    if (code !== 'MISSING_PRELOAD') { mkdirSync(join(bundle,'dist-electron','preload'), { recursive: true }); copyFileSync(resolve('dist-electron','preload','index.cjs'), join(bundle,'dist-electron','preload','index.cjs')); }
    if (['PRELOAD_ERROR','IPC_FAILED','LOAD_FAILED'].includes(code)) {
      mkdirSync(join(bundle,'dist'), { recursive: true });
      writeFileSync(join(bundle,'dist','index.html'), code === 'LOAD_FAILED' ? '<div id="root"></div>' : '<div id="root"><p>Test startup</p></div>');
      if (code === 'PRELOAD_ERROR') writeFileSync(join(bundle,'dist-electron','preload','index.cjs'), 'throw new Error("TEST_PRELOAD_FAILURE")');
      if (code === 'IPC_FAILED') writeFileSync(join(bundle,'dist-electron','preload','index.cjs'), `const { contextBridge } = require('electron'); contextBridge.exposeInMainWorld('raizDesktop', { getAppInfo: async () => { throw new Error('TEST_IPC_FAILURE'); } });`);
    }
    writeFileSync(join(bundle,'package.json'), JSON.stringify({ name: 'raiz-startup-test', version: '0.1.0', main: 'dist-electron/main/index.cjs' }));
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.RAIZ_DESKTOP_DEV_URL;
    const desktop = await electron.launch({ args: [bundle, '--raiz-profile=' + join(bundle,'profile')], env, timeout: 20000 });
    let diagnostic = ''; desktop.process().stderr.on('data', (data) => { diagnostic += data.toString(); });
    try {
      let body = '';
      for (let attempt = 0; attempt < 100; attempt++) {
        body = await desktop.evaluate(async ({ BrowserWindow }) => {
          const window = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL() === 'raiz://app/desktop-error.html');
          if (!window || !window.isVisible()) return '';
          return window.webContents.executeJavaScript('document.body.innerText');
        });
        if (body.includes(code)) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.match(body, /Não foi possível iniciar/);
      assert.match(body, new RegExp(code));
      console.log('PASS startup: ' + code + ' é mostrado sem apagar dados ou liberar acesso remoto.');
    } catch (error) { console.error('Startup fixture ' + code + ': ' + diagnostic); throw error; } finally { await desktop.close(); }
  }
})().catch((error) => { console.error(error); process.exit(1); });
