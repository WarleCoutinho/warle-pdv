import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { INITIAL_SCHEMA } from './schema.cjs';
import { DatabaseFailure, databaseFailure } from './errors.cjs';
export interface Migration { readonly version: number; readonly sql: string; }
export const MIGRATIONS: readonly Migration[] = Object.freeze([Object.freeze({ version: 1, sql: INITIAL_SCHEMA })]);
export const MIGRATION_TABLE = `CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY CHECK(version>0), applied_at TEXT NOT NULL, migration_digest TEXT NOT NULL CHECK(length(migration_digest)=64)) STRICT`;
export const digest = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
export function validateMigrations(db: DatabaseSync, migrations: readonly Migration[]) {
  if (!migrations.length) throw new DatabaseFailure('DATABASE_VERSION_INCOMPATIBLE');
  migrations.forEach((migration, index) => { if (migration.version !== index + 1 || !migration.sql.trim()) throw new DatabaseFailure('DATABASE_VERSION_INCOMPATIBLE'); });
  const exists = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name='schema_migrations'").get();
  if (!exists) {
    if (db.prepare("SELECT name FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' LIMIT 1").get() || Number(db.prepare('PRAGMA user_version').get()?.user_version) !== 0) throw new DatabaseFailure('DATABASE_VERSION_INCOMPATIBLE');
    return 0;
  }
  const applied = db.prepare('SELECT version,migration_digest FROM schema_migrations ORDER BY version').all();
  for (let index = 0; index < applied.length; index++) {
    const row = applied[index]; const expected = migrations[index];
    if (!expected || row.version !== expected.version) throw new DatabaseFailure('DATABASE_VERSION_INCOMPATIBLE');
    if (row.migration_digest !== digest(expected.sql)) throw new DatabaseFailure('MIGRATION_DIGEST_MISMATCH');
  }
  if (Number(db.prepare('PRAGMA user_version').get()?.user_version) !== applied.length) throw new DatabaseFailure('DATABASE_VERSION_INCOMPATIBLE');
  return applied.length;
}
export function applyMigrations(db: DatabaseSync, migrations: readonly Migration[] = MIGRATIONS) {
  const applied = validateMigrations(db, migrations);
  if (applied === migrations.length) return;
  if (db.isTransaction) throw new DatabaseFailure('TRANSACTION_NESTED');
  try {
    db.exec('BEGIN IMMEDIATE');
    // Revalidate under the writer lock: another connection may have initialized meanwhile.
    const lockedApplied = validateMigrations(db,migrations);
    if (!db.prepare("SELECT name FROM sqlite_schema WHERE name='schema_migrations'").get()) db.exec(MIGRATION_TABLE);
    for (const migration of migrations.slice(lockedApplied)) {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations(version,applied_at,migration_digest) VALUES(?,?,?)').run(migration.version,new Date().toISOString(),digest(migration.sql));
      db.exec(`PRAGMA user_version = ${migration.version}`);
    }
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new DatabaseFailure('DATABASE_CORRUPT');
    db.exec('COMMIT');
  } catch (error) {
    if (db.isTransaction) { try { db.exec('ROLLBACK'); } catch { throw new DatabaseFailure('DATABASE_ROLLBACK_FAILED'); } }
    throw databaseFailure(error,'MIGRATION_FAILED');
  }
}
