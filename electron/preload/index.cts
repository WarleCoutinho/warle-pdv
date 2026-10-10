import { contextBridge, ipcRenderer } from 'electron';
import type { AppInfoChannel, AppInfoReply, DesktopAppInfo, RaizDesktopApi } from '../shared/contracts.cjs';
// Sandboxed preload can require Electron, but cannot require local runtime modules.
// This literal is checked against the shared channel type and compiles into one CJS file.
const channel: AppInfoChannel = 'raiz:desktop:app-info';
import { operationNames } from '../shared/operational.js';
import type { DomainApi, Reply } from '../shared/operational.js';
const pdv = Object.fromEntries(operationNames.map(name=>[name, async (input:unknown)=>{
 const reply:Reply<unknown>=await ipcRenderer.invoke(`raiz:pdv:${name}`,input);
 if(!reply||reply.ok!==true){const code=reply&&reply.ok===false?reply.error.code:'INVALID_REPLY';throw new Error(/^[A-Z_]{1,64}$/.test(code)?code:'INVALID_REPLY');}
 return reply.value;
}])) as DomainApi;
const api: RaizDesktopApi = {
  pdv:Object.freeze(pdv),
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
