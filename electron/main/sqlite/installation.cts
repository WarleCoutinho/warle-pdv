import { DatabaseFailure } from './errors.cjs';
export type InstallationStatus = 'testing' | 'ready_for_setup' | 'production';
export interface InstallationState { id: 1; status: InstallationStatus; created_at: string; activated_at: string | null; generation: number; }
export function parseInstallationState(rows: Record<string, unknown>[]): InstallationState {
  const value = rows[0];
  if (rows.length !== 1 || value?.id !== 1 || !['testing','ready_for_setup','production'].includes(String(value.status)) || !Number.isSafeInteger(value.generation) || Number(value.generation)<1 || typeof value.created_at !== 'string' || !validUtc(value.created_at) || (value.status === 'production' ? typeof value.activated_at !== 'string' || !validUtc(value.activated_at) : value.activated_at !== null)) throw new DatabaseFailure('INSTALLATION_STATE_INVALID');
  return Object.freeze({ ...value }) as unknown as InstallationState;
}
export function validUtc(value: string) { try { return new Date(value).toISOString() === value; } catch { return false; } }
export function commercialDate(instant: string): string {
  if (!validUtc(instant)) throw new DatabaseFailure('INVALID_DATABASE_INPUT');
  const parts = new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(instant));
  return ['year','month','day'].map(kind=>parts.find(part=>part.type===kind)?.value).join('-');
}
/** Planning only; no mutation/reset/authorization endpoint exists in 12C.1. */
export function planInstallationTransition(state: InstallationState, action: 'prepare_for_setup' | 'activate', evidence: { authorizedAdmin: boolean; recentReauthentication: boolean; verifiedExternalBackup?: boolean; doubleConfirmation?: boolean; phrase?: string; setupComplete?: boolean }) {
  if (!evidence.authorizedAdmin || !evidence.recentReauthentication || state.status === 'production') throw new DatabaseFailure('INSTALLATION_STATE_INVALID');
  if (action === 'prepare_for_setup' && state.status === 'testing' && evidence.verifiedExternalBackup && evidence.doubleConfirmation && evidence.phrase === 'ZERAR RAIZ PDV' && Number.isSafeInteger(state.generation+1)) return Object.freeze({ status: 'ready_for_setup' as const, generation: state.generation+1 });
  if (action === 'activate' && state.status === 'ready_for_setup' && evidence.setupComplete) return Object.freeze({ status: 'production' as const, generation: state.generation });
  throw new DatabaseFailure('INSTALLATION_STATE_INVALID');
}
