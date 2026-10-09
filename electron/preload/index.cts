import { contextBridge, ipcRenderer } from 'electron';
import type { AppInfoChannel, AppInfoReply, DesktopAppInfo, RaizDesktopApi } from '../shared/contracts.cjs';
// Sandboxed preload can require Electron, but cannot require local runtime modules.
// This literal is checked against the shared channel type and compiles into one CJS file.
const channel: AppInfoChannel = 'raiz:desktop:app-info';
const api: RaizDesktopApi = {
  async getAppInfo() {
    try {
      const reply: AppInfoReply = await ipcRenderer.invoke(channel);
      if (!reply || reply.ok !== true || !reply.value || reply.value.name !== 'Raiz PDV' || reply.value.environment !== 'desktop' || typeof reply.value.version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(reply.value.version)) throw new Error('INVALID_REPLY');
      const value: DesktopAppInfo = { name: reply.value.name, version: reply.value.version, environment: reply.value.environment };
      return Object.freeze(value);
    } catch { throw new Error('Não foi possível consultar o aplicativo desktop.'); }
  },
};
contextBridge.exposeInMainWorld('raizDesktop', Object.freeze(api));
