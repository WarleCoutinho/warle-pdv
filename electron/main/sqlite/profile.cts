import { isAbsolute, join } from 'node:path';
import { DatabaseFailure } from './errors.cjs';
export type DatabaseMode = 'development' | 'production' | 'test';
/** Main-only configuration derived from Electron userData; never from an IPC payload. */
export function databasePath(userData: string, mode: DatabaseMode) {
  if (!isAbsolute(userData) || !['development','production','test'].includes(mode)) throw new DatabaseFailure('INVALID_DATABASE_INPUT');
  return join(userData,'data', ...(mode === 'production' ? [] : [mode]),'raiz-pdv.sqlite');
}
