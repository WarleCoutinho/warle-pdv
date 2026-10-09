export type DatabaseErrorCode = 'DATABASE_OPEN_FAILED' | 'DATABASE_CORRUPT' | 'DATABASE_BUSY' | 'DATABASE_CONSTRAINT' | 'DATABASE_VERSION_INCOMPATIBLE' | 'MIGRATION_DIGEST_MISMATCH' | 'MIGRATION_FAILED' | 'DATABASE_CONFIGURATION_FAILED' | 'DATABASE_SCHEMA_MISMATCH' | 'INSTALLATION_STATE_INVALID' | 'TRANSACTION_NESTED' | 'TRANSACTION_ASYNC_FORBIDDEN' | 'TRANSACTION_INACTIVE' | 'DATABASE_CLOSED' | 'DATABASE_ROLLBACK_FAILED' | 'INVALID_DATABASE_INPUT' | 'REQUEST_CONFLICT' | 'REQUEST_INTERRUPTED';
export class DatabaseFailure extends Error {
  constructor(readonly code: DatabaseErrorCode) { super(code); this.name = 'DatabaseFailure'; }
}
export function databaseFailure(error: unknown, fallback: DatabaseErrorCode = 'DATABASE_OPEN_FAILED'): DatabaseFailure {
  if (error instanceof DatabaseFailure) return error;
  const native = error as { errcode?: number } | null;
  const code = typeof native?.errcode === 'number' ? native.errcode & 255 : 0;
  if (code === 5 || code === 6) return new DatabaseFailure('DATABASE_BUSY');
  if (code === 11 || code === 26) return new DatabaseFailure('DATABASE_CORRUPT');
  if (code === 19) return new DatabaseFailure('DATABASE_CONSTRAINT');
  return new DatabaseFailure(fallback);
}
