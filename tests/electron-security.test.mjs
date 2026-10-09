import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url);
const policy = require('../dist-electron/main/security.cjs');
const valid = { ownsContents: true, isMainFrame: true, origin: 'raiz://app', frameUrl: policy.DESKTOP_URL, contentsUrl: policy.DESKTOP_URL };
test('Desktop aceita somente Vite fixo em desenvolvimento; build empacotado rejeita override', () => {
  assert.equal(policy.validateDevelopmentUrl(undefined, false), null);
  assert.equal(policy.validateDevelopmentUrl(policy.DEVELOPMENT_URL, false), policy.DEVELOPMENT_URL);
  for (const url of ['https://example.com', 'http://localhost:5173/', 'http://127.0.0.1:5174/', 'http://127.0.0.1:5173/evil', 'http://user@127.0.0.1:5173/']) assert.throws(() => policy.validateDevelopmentUrl(url, false));
  assert.throws(() => policy.validateDevelopmentUrl(policy.DEVELOPMENT_URL, true));
});
test('Origem e documento principal são verificados, inclusive caminho, query e credenciais', () => {
  assert.ok(policy.isTrustedDocument(policy.DESKTOP_URL + '#section', null));
  for (const url of ['raiz://evil/index.html','raiz://app/other.html','raiz://app/index.html?secret=1','raiz://user@app/index.html','about:blank','blob:raiz://app/uuid','file:///C:/secret.txt']) assert.equal(policy.isTrustedDocument(url, null), false, url);
});
test('Protocolo só resolve index e assets do build, sem traversal/arquivos arbitrários', () => {
  const root = resolve('dist'); assert.equal(policy.resolveAssetPath(policy.DESKTOP_URL, root), resolve(root, 'index.html'));
  assert.equal(policy.resolveAssetPath('raiz://app/assets/index-Ab12.js', root), resolve(root, 'assets/index-Ab12.js'));
  for (const path of ['/package.json','/src/main.tsx','/assets/../../package.json','/assets/%2e%2e%5csecret.js','/assets/%2fetc%2fpasswd','/assets/C:%5csecret.js','/assets/x.js?x=1','/assets/a.js.map','/assets/sub/x.js']) assert.equal(policy.resolveAssetPath('raiz://app' + path, root), null, path);
});
test('Rede de produção é restrita ao build; dev não libera servidores remotos ou outras portas', () => {
  assert.ok(policy.isAllowedRequest('raiz://app/assets/index-X.css', null));
  for (const url of ['http://127.0.0.1:5173/','https://example.com','https://app/index.html','data:text/html,a','file:///C:/x']) assert.equal(policy.isAllowedRequest(url, null), false);
  assert.ok(policy.isAllowedRequest('ws://127.0.0.1:5173/', policy.DEVELOPMENT_URL));
  for (const url of ['http://localhost:5173/','ws://127.0.0.1:5174/','https://127.0.0.1:5173/']) assert.equal(policy.isAllowedRequest(url, policy.DEVELOPMENT_URL), false);
});
test('IPC rejeita origem falsa, iframe, outro WebContents e documento opaco', () => {
  assert.equal(policy.authorizeAppInfo(valid, null, []), null);
  for (const bad of [{ ownsContents: false },{ isMainFrame: false },{ origin: 'https://example.com' },{ origin: 'null' },{ frameUrl: 'about:blank' },{ contentsUrl: 'raiz://app/other.html' }]) assert.equal(policy.authorizeAppInfo({ ...valid, ...bad }, null, []), 'UNAUTHORIZED');
});
test('IPC de informação não aceita payload ou canais arbitrários', () => {
  for (const args of [[null],[{}],['run-sql'],['password',123]]) assert.equal(policy.authorizeAppInfo(valid, null, args), 'INVALID_REQUEST');
  const preload = readFileSync('dist-electron/preload/index.cjs', 'utf8');
  assert.doesNotMatch(preload, /require\(["'](?:node:|fs|path|child_process|\.\.)/);
  assert.match(preload, /exposeInMainWorld\(['"]raizDesktop['"]/);
  assert.doesNotMatch(preload, /exposeInMainWorld\([^;]*ipcRenderer/);
});
test('CSP de produção bloqueia script inline/eval/frame; exceção de script inline só existe em dev', () => {
  const production = policy.contentSecurityPolicy(null); assert.match(production, /script-src 'self';/); assert.doesNotMatch(production, /unsafe-eval|http:|ws:/);
  for (const directive of ["object-src 'none'", "frame-src 'none'", "base-uri 'none'", "form-action 'none'"]) assert.ok(production.includes(directive));
  assert.match(policy.contentSecurityPolicy(policy.DEVELOPMENT_URL), /script-src 'self' 'unsafe-inline'/);
});
test('Download permitido somente para JSON próprio, com origem e gesto do usuário', () => {
  const input = { origin: 'raiz://app', url: 'blob:raiz://app/uuid', filename: 'raiz-pdv-backup-2026-10-09.json', mime: 'application/json', userGesture: true };
  assert.ok(policy.isAllowedBackupDownload(input, null));
  for (const bad of [{ origin: 'null' },{ url: 'https://example.com/backup' },{ filename: 'malware.exe' },{ filename: '../raiz-pdv-backup-2026-10-09.json' },{ mime: 'application/javascript' },{ userGesture: false }]) assert.equal(policy.isAllowedBackupDownload({ ...input, ...bad }, null), false);
});
test('Perfil de desenvolvimento exige caminho absoluto e não existe override empacotado', () => {
  assert.equal(policy.validateProfileArgument(undefined, false), null); assert.equal(policy.validateProfileArgument(resolve('profile'), false), resolve('profile'));
  assert.throws(() => policy.validateProfileArgument('relative', false)); assert.throws(() => policy.validateProfileArgument(resolve('profile'), true));
});
