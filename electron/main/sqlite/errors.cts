export type BackendErrorCode = 'UNAUTHORIZED' | 'INVALID_REQUEST' | 'FORBIDDEN' | 'REAUTHENTICATION_REQUIRED' | 'AUTHENTICATION_FAILED' | 'RATE_LIMITED' | 'INSTALLATION_BLOCKED' | 'CASH_UNAVAILABLE' | 'INSUFFICIENT_FUNDS' | 'SALE_INVALID' | 'ALREADY_RESOLVED' | 'CREDIT_UNAUTHORIZED' | 'RECOVERY_BLOCKED' | 'STALE_RECONCILIATION' | 'UNSUPPORTED_OPERATION' | 'PRINT_FAILED';
export type DatabaseErrorCode = BackendErrorCode | 'DATABASE_OPEN_FAILED' | 'DATABASE_CORRUPT' | 'DATABASE_BUSY' | 'DATABASE_CONSTRAINT' | 'DATABASE_VERSION_INCOMPATIBLE' | 'MIGRATION_DIGEST_MISMATCH' | 'MIGRATION_FAILED' | 'DATABASE_CONFIGURATION_FAILED' | 'DATABASE_SCHEMA_MISMATCH' | 'INSTALLATION_STATE_INVALID' | 'TRANSACTION_NESTED' | 'TRANSACTION_ASYNC_FORBIDDEN' | 'TRANSACTION_INACTIVE' | 'DATABASE_CLOSED' | 'DATABASE_ROLLBACK_FAILED' | 'INVALID_DATABASE_INPUT' | 'REQUEST_CONFLICT' | 'REQUEST_INTERRUPTED';
const failureBrand=Symbol.for('raiz-pdv:database-failure');
export class DatabaseFailure extends Error {
  static [Symbol.hasInstance](value:unknown){return value instanceof Error && (value as unknown as Record<symbol,unknown>)[failureBrand]===true;}
  constructor(readonly code: DatabaseErrorCode) { super(code); this.name = 'DatabaseFailure'; Object.defineProperty(this,failureBrand,{value:true}); }
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
