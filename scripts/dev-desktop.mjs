import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createServer } from 'vite';
const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const executable = require('electron');
const compilerScript = resolve(root, 'scripts', 'build-electron.mjs');
let server; let electron; let stopping = false;
const runCompile = () => new Promise((resolveResult, reject) => {
  const compiler = spawn(process.execPath, [compilerScript], { cwd: root, stdio: 'inherit', windowsHide: true });
  compiler.on('error', reject); compiler.on('exit', (code) => code === 0 ? resolveResult() : reject(new Error('Falha ao compilar main/preload.')));
});
async function stop(code = 0) {
  if (stopping) return; stopping = true;
  electron?.kill(); await server?.close(); process.exitCode = code;
}
process.on('SIGINT', () => { void stop(); }); process.on('SIGTERM', () => { void stop(); });
try {
  await runCompile();
  const { DEVELOPMENT_URL } = require('../dist-electron/main/security.cjs');
  let reusable = false;
  try { const response = await fetch(new URL('@vite/client', DEVELOPMENT_URL), { signal: AbortSignal.timeout(2000) }); reusable = response.ok && (await response.text()).includes('vite'); } catch { /* start our own server */ }
  if (!reusable) { server = await createServer({ root }); await server.listen(); }
  console.log(reusable ? 'Reutilizando Vite local na porta 5173.' : 'Vite local iniciado na porta 5173.');
  const environment = { ...process.env, RAIZ_DESKTOP_DEV_URL: DEVELOPMENT_URL }; delete environment.ELECTRON_RUN_AS_NODE;
  electron = spawn(executable, [root, ...process.argv.slice(2)], { cwd: root, env: environment, stdio: 'inherit', windowsHide: true });
  electron.on('error', () => { console.error('Não foi possível iniciar Electron.'); void stop(1); });
  electron.on('exit', (code) => { void stop(code ?? 1); });
} catch (failure) { console.error(failure instanceof Error ? failure.message : 'Falha na inicialização desktop.'); await stop(1); }
