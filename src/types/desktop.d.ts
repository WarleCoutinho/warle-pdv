import type { RaizDesktopApi } from '../../electron/shared/contracts.cjs';
declare global { interface Window { readonly raizDesktop?: RaizDesktopApi; } }
export {};
