import { app, BrowserWindow, ipcMain, protocol, session } from 'electron';
import { existsSync, mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import type { AppInfoChannel, AppInfoReply } from '../shared/contracts.cjs';
import { authorizeAppInfo, contentSecurityPolicy, DESKTOP_URL, ERROR_URL, isAllowedBackupDownload, isAllowedRequest, isTrustedDocument, resolveAssetPath, validateDevelopmentUrl, validateProfileArgument } from './security.cjs';
const APP_INFO_CHANNEL: AppInfoChannel = 'raiz:desktop:app-info';
app.setName('Raiz PDV');
app.enableSandbox();
protocol.registerSchemesAsPrivileged([{ scheme: 'raiz', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
let mainWindow: BrowserWindow | null = null;
let failing = false;
let developmentUrl: string | null = null;
let failureCode = 'STARTUP_FAILED';
let configurationError = false;
try {
  developmentUrl = validateDevelopmentUrl(process.env.RAIZ_DESKTOP_DEV_URL, app.isPackaged);
  const profile = validateProfileArgument(process.argv.find((arg) => arg.startsWith('--raiz-profile='))?.slice('--raiz-profile='.length), app.isPackaged);
  const dataPath = profile ?? join(app.getPath('appData'), 'Raiz PDV');
  mkdirSync(dataPath, { recursive: true }); app.setPath('userData', dataPath);
  app.setPath('sessionData', dataPath);
} catch { configurationError = true; }
const diagnostics = new Set(['STARTUP_FAILED', 'MISSING_RENDERER', 'MISSING_PRELOAD', 'PRELOAD_ERROR', 'IPC_FAILED', 'LOAD_FAILED', 'RENDERER_EXITED', 'UNRESPONSIVE']);
function diagnose(code: string) { console.error(`[RaizDesktop] ${code}`); }
async function showFailure(code: string) {
  if (failing) return; failing = true;
  failureCode = diagnostics.has(code) ? code : 'STARTUP_FAILED'; diagnose(failureCode);
  if (!mainWindow || mainWindow.isDestroyed()) { app.exit(1); return; }
  const failedWindow = mainWindow;
  // A broken preload must not run again in the diagnostic window.
  const diagnosticWindow = new BrowserWindow({ title: 'Raiz PDV', width: 1280, height: 900, minWidth: 1024, minHeight: 720, show: false, autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, allowRunningInsecureContent: false, webviewTag: false, session: failedWindow.webContents.session } });
  mainWindow = diagnosticWindow;
  diagnosticWindow.removeMenu();
  diagnosticWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  diagnosticWindow.webContents.on('will-navigate', (event, url) => { if (url !== ERROR_URL) event.preventDefault(); });
  diagnosticWindow.webContents.on('will-frame-navigate', (event) => { if (!event.isMainFrame || event.url !== ERROR_URL) event.preventDefault(); });
  diagnosticWindow.webContents.on('will-redirect', (event) => { event.preventDefault(); });
  diagnosticWindow.on('closed', () => { if (mainWindow === diagnosticWindow) mainWindow = null; });
  try { await diagnosticWindow.loadURL(ERROR_URL); diagnosticWindow.show(); failedWindow.destroy(); }
  catch { diagnose('ERROR_PAGE_LOAD_FAILED'); app.exit(1); }
}
async function initialize() {
  if (configurationError) throw new Error('STARTUP_FAILED');
  const rendererRoot = join(app.getAppPath(), 'dist');
  const preloadPath = join(app.getAppPath(), 'dist-electron', 'preload', 'index.cjs');
  const desktopSession = session.fromPartition(developmentUrl ? 'persist:raiz-development' : 'persist:raiz-desktop');
  desktopSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  desktopSession.setPermissionCheckHandler(() => false);
  desktopSession.on('will-download', (event, item, contents) => {
    const allowed = mainWindow && contents === mainWindow.webContents && isTrustedDocument(contents.getURL(), developmentUrl)
      && isAllowedBackupDownload({ origin: item.getInitiatorOrigin(), url: item.getURL(), filename: item.getFilename(), mime: item.getMimeType(), userGesture: item.hasUserGesture() }, developmentUrl);
    if (!allowed) { event.preventDefault(); diagnose('DOWNLOAD_BLOCKED'); return; }
    item.setSaveDialogOptions({ title: 'Salvar backup do Raiz PDV', filters: [{ name: 'Backup JSON', extensions: ['json'] }] });
    item.once('done', (_event, state) => { if (state === 'interrupted') diagnose('BACKUP_DOWNLOAD_FAILED'); });
  });
  desktopSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !isAllowedRequest(details.url, developmentUrl) }));
  desktopSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders };
    for (const key of Object.keys(headers)) if (key.toLowerCase() === 'content-security-policy') delete headers[key];
    callback({ responseHeaders: { ...headers, 'Content-Security-Policy': [contentSecurityPolicy(developmentUrl)], 'X-Content-Type-Options': ['nosniff'] } });
  });
  desktopSession.protocol.handle('raiz', async (request) => {
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
    if (request.url === ERROR_URL) return new Response(`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Raiz PDV</title><h1>Não foi possível iniciar o Raiz PDV</h1><p>Código: ${failureCode}</p><p>Feche e abra o aplicativo novamente. Se persistir, confira o build e o suporte técnico. Os dados não foram apagados.</p></html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': contentSecurityPolicy(null) } });
    const file = resolveAssetPath(request.url, rendererRoot);
    if (!file) return new Response('Forbidden', { status: 403 });
    const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2' };
    try { return new Response(await readFile(file), { headers: { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream', 'Content-Security-Policy': contentSecurityPolicy(null), 'X-Content-Type-Options': 'nosniff' } }); }
    catch { return new Response('Not found', { status: 404 }); }
  });
  mainWindow = new BrowserWindow({ title: 'Raiz PDV', width: 1280, height: 900, minWidth: 1024, minHeight: 720, show: false, autoHideMenuBar: true,
    webPreferences: { preload: preloadPath, contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, allowRunningInsecureContent: false, webviewTag: false, session: desktopSession } });
  mainWindow.removeMenu();
  const contents = mainWindow.webContents;
  mainWindow.on('page-title-updated', (event) => { event.preventDefault(); });
  contents.setWindowOpenHandler(() => { diagnose('WINDOW_BLOCKED'); return { action: 'deny' }; });
  contents.on('will-navigate', (event, url) => { if (!isTrustedDocument(url, developmentUrl)) { event.preventDefault(); diagnose('NAVIGATION_BLOCKED'); } });
  contents.on('will-frame-navigate', (event) => { if (!event.isMainFrame || !isTrustedDocument(event.url, developmentUrl)) { event.preventDefault(); diagnose('FRAME_NAVIGATION_BLOCKED'); } });
  contents.on('will-redirect', (event, url) => { if (!isTrustedDocument(url, developmentUrl)) { event.preventDefault(); diagnose('REDIRECT_BLOCKED'); } });
  contents.on('will-attach-webview', (event) => { event.preventDefault(); });
  contents.on('preload-error', () => { void showFailure('PRELOAD_ERROR'); });
  contents.on('render-process-gone', () => { if (!failing) void showFailure('RENDERER_EXITED'); });
  mainWindow.on('unresponsive', () => { void showFailure('UNRESPONSIVE'); });
  contents.on('did-fail-load', (_event, code, _description, _url, isMainFrame) => { if (isMainFrame && code !== -3) void showFailure('LOAD_FAILED'); });
  contents.on('did-finish-load', async () => {
    if (failing) return;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const info = await Promise.race([contents.executeJavaScript('window.raizDesktop.getAppInfo()'), new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => reject(new Error('IPC_TIMEOUT')), 5000); })]);
      if (info?.name !== 'Raiz PDV' || info?.version !== app.getVersion() || info?.environment !== 'desktop') throw new Error('INVALID_INFO');
      let rendered = false;
      for (let attempt = 0; attempt < 50 && !rendered && !failing; attempt++) {
        rendered = await contents.executeJavaScript("Boolean(document.getElementById('root')?.childElementCount)");
        if (!rendered) await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (!rendered) { await showFailure('LOAD_FAILED'); return; }
      if (!failing) { mainWindow?.setTitle('Raiz PDV'); mainWindow?.show(); }
    } catch { void showFailure('IPC_FAILED'); }
    finally { if (timeout) clearTimeout(timeout); }
  });
  const applicationWindow = mainWindow;
  applicationWindow.on('closed', () => { if (mainWindow === applicationWindow) mainWindow = null; });
  ipcMain.handle(APP_INFO_CHANNEL, (event, ...args: unknown[]): AppInfoReply => {
    const frame = event.senderFrame;
    const code = authorizeAppInfo({ ownsContents: mainWindow?.webContents === event.sender, isMainFrame: frame === event.sender.mainFrame, origin: frame?.origin ?? '', frameUrl: frame?.url ?? '', contentsUrl: event.sender.getURL() }, developmentUrl, args);
    if (code) return { ok: false, error: { code, message: 'Solicitação desktop rejeitada.' } };
    return { ok: true, value: { name: 'Raiz PDV', version: app.getVersion(), environment: 'desktop' } };
  });
  if (!existsSync(preloadPath)) { await showFailure('MISSING_PRELOAD'); return; }
  if (!developmentUrl && !existsSync(join(rendererRoot, 'index.html'))) { await showFailure('MISSING_RENDERER'); return; }
  if (!failing) await mainWindow.loadURL(developmentUrl ?? DESKTOP_URL);
}
app.whenReady().then(initialize).catch(() => { void showFailure('STARTUP_FAILED'); });
app.on('window-all-closed', () => { app.quit(); });
// Windows is the target: closing the last window always ends the application.
