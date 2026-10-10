import { isAbsolute, join } from 'node:path';
export const DESKTOP_URL = 'raiz://app/index.html';
export const ERROR_URL = 'raiz://app/desktop-error.html';
export const DEVELOPMENT_URL = 'http://127.0.0.1:5173/';
export function validateDevelopmentUrl(value: string | undefined, packaged: boolean): string | null {
  if (!value) return null;
  if (packaged || value !== DEVELOPMENT_URL) throw new Error('INVALID_DEVELOPMENT_URL');
  return DEVELOPMENT_URL;
}
export function trustedOrigin(developmentUrl: string | null): string {
  return developmentUrl ? new URL(developmentUrl).origin : 'raiz://app';
}
export function isTrustedDocument(value: string, developmentUrl: string | null): boolean {
  try {
    const url = new URL(value); url.hash = '';
    return url.href === (developmentUrl ?? DESKTOP_URL);
  } catch { return false; }
}
export function isAllowedRequest(value: string, developmentUrl: string | null): boolean {
  if (value === ERROR_URL) return true;
  try {
    const url = new URL(value);
    if (developmentUrl) {
      const expected = new URL(developmentUrl);
      return !url.username && !url.password && url.host === expected.host && (url.protocol === 'http:' || url.protocol === 'ws:');
    }
    return resolveAssetPath(value, 'renderer') !== null;
  } catch { return false; }
}
/** Resolve only known build paths; never turn renderer URLs into arbitrary filesystem reads. */
export function resolveAssetPath(value: string, rendererRoot: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'raiz:' || url.host !== 'app' || url.username || url.password || url.search) return null;
    const path = decodeURIComponent(url.pathname);
    if (path === '/index.html') return join(rendererRoot, 'index.html');
    if (!/^\/assets\/[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*\.(?:js|css|svg|png|webp|ico|woff|woff2)$/.test(path)) return null;
    return join(rendererRoot, 'assets', path.slice('/assets/'.length));
  } catch { return null; }
}
export function contentSecurityPolicy(developmentUrl: string | null): string {
  const script = developmentUrl ? "'self' 'unsafe-inline'" : "'self'";
  const connect = developmentUrl ? `${developmentUrl.slice(0, -1)} ws://127.0.0.1:5173` : "'self'";
  return `default-src 'none'; script-src ${script}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src ${connect}; object-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; media-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;
}
export type SenderDescriptor = { ownsContents: boolean; isMainFrame: boolean; origin: string; frameUrl: string; contentsUrl: string };
export function authorizeAppInfo(sender: SenderDescriptor, developmentUrl: string | null, args: unknown[]): 'UNAUTHORIZED' | 'INVALID_REQUEST' | null {
  if (!sender.ownsContents || !sender.isMainFrame || sender.origin !== trustedOrigin(developmentUrl) || !isTrustedDocument(sender.frameUrl, developmentUrl) || !isTrustedDocument(sender.contentsUrl, developmentUrl)) return 'UNAUTHORIZED';
  return args.length === 0 ? null : 'INVALID_REQUEST';
}
export function isAllowedBackupDownload(input: { origin: string; url: string; filename: string; mime: string; userGesture: boolean }, developmentUrl: string | null): boolean {
  const origin = trustedOrigin(developmentUrl);
  return input.origin === origin && input.userGesture && input.url.startsWith(`blob:${origin}/`)
    && /^raiz-pdv-(?:backup|seguranca-anterior)-\d{4}-\d{2}-\d{2}\.json$/.test(input.filename)
    && input.mime.split(';')[0] === 'application/json';
}
export function validateProfileArgument(value: string | undefined, packaged: boolean): string | null {
  if (!value) return null;
  if (packaged || !isAbsolute(value)) throw new Error('INVALID_PROFILE_PATH');
  return value;
}
