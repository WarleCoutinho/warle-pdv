/** Public, serializable DTO only. No persistence or financial IPC in 12B. */
export type AppInfoChannel = 'raiz:desktop:app-info';
export type DesktopAppInfo = { name: 'Raiz PDV'; version: string; environment: 'desktop' };
export type AppInfoReply =
  | { ok: true; value: DesktopAppInfo }
  | { ok: false; error: { code: 'UNAUTHORIZED' | 'INVALID_REQUEST'; message: string } };
export interface RaizDesktopApi { getAppInfo(): Promise<DesktopAppInfo>; }
