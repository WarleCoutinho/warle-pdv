import type { DomainApi } from './operational.js';
/** Public serializable API, with explicit domain commands. */
export type AppInfoChannel = 'raiz:desktop:app-info';
export type DesktopAppInfo = { name: 'Raiz PDV'; version: string; environment: 'desktop' };
export type AppInfoReply =
  | { ok: true; value: DesktopAppInfo }
  | { ok: false; error: { code: 'UNAUTHORIZED' | 'INVALID_REQUEST'; message: string } };
export interface RaizDesktopApi { getAppInfo(): Promise<DesktopAppInfo>; readonly pdv: DomainApi; }
