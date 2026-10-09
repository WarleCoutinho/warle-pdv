import { DatabaseSync } from 'node:sqlite';
import type { SQLInputValue } from 'node:sqlite';
import { mkdirSync, existsSync, lstatSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseFailure, databaseFailure } from './errors.cjs';
import { applyMigrations, validateMigrations, MIGRATIONS, MIGRATION_TABLE, digest } from './migrations.cjs';
import type { Migration } from './migrations.cjs';
import { databasePath } from './profile.cjs';
import type { DatabaseMode } from './profile.cjs';
import { parseInstallationState } from './installation.cjs';
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type Row = Record<string, unknown>;
export interface TransactionContext {
  run(sql: string, ...params: SQLInputValue[]): void;
  get(sql: string, ...params: SQLInputValue[]): Row | undefined;
  all(sql: string, ...params: SQLInputValue[]): Row[];
}
export interface RequestInput { requestId: string; kind: string; payload: JsonValue; }
/** Canonical DTOs only: never hash passwords, credit codes or backend tokens as command identity. */
export function canonicalJson(value: JsonValue): string {
  const seen = new Set<object>();
  const encode = (item: JsonValue): string => {
    if (item === null || typeof item === 'boolean' || typeof item === 'string') return JSON.stringify(item);
    if (typeof item === 'number') { if (!Number.isSafeInteger(item)) throw new DatabaseFailure('INVALID_DATABASE_INPUT'); return JSON.stringify(item); }
    if (typeof item !== 'object' || seen.has(item)) throw new DatabaseFailure('INVALID_DATABASE_INPUT');
    seen.add(item);
    let encoded: string;
    if (Array.isArray(item)) { if (Object.keys(item).length !== item.length || !Array.from({length:item.length},(_,index)=>Object.hasOwn(item,index)).every(Boolean)) throw new DatabaseFailure('INVALID_DATABASE_INPUT'); encoded = '['+item.map(encode).join(',')+']'; }
    else { if (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) throw new DatabaseFailure('INVALID_DATABASE_INPUT'); encoded = '{'+Object.keys(item).sort().map(key=>JSON.stringify(key)+':'+encode(item[key])).join(',')+'}'; }
    seen.delete(item); return encoded;
  };
  const result = encode(value);
  if (Buffer.byteLength(result)>1048576) throw new DatabaseFailure('INVALID_DATABASE_INPUT');
  return result;
}
function checkParams(params: SQLInputValue[]) {
  for (const parameter of params) {
    if (typeof parameter === 'number' && !Number.isSafeInteger(parameter)) throw new DatabaseFailure('INVALID_DATABASE_INPUT');
    if (typeof parameter === 'bigint' && (parameter>9007199254740991n || parameter< -9007199254740991n)) throw new DatabaseFailure('INVALID_DATABASE_INPUT');
  }
}
function assertIntegrity(db: DatabaseSync) {
  const structural = db.prepare('PRAGMA integrity_check').all();
  if (structural.length !== 1 || structural[0].integrity_check !== 'ok' || db.prepare('PRAGMA foreign_key_check').all().length) throw new DatabaseFailure('DATABASE_CORRUPT');
}
function assertSchema(db: DatabaseSync, migrations: readonly Migration[]) {
  const reference = new DatabaseSync(':memory:');
  try {
    reference.exec(MIGRATION_TABLE);
    for (const migration of migrations) reference.exec(migration.sql);
    const sql = "SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type,name";
    const expected = reference.prepare(sql).all(); const actual = db.prepare(sql).all();
    if (JSON.stringify(expected)!==JSON.stringify(actual)) throw new DatabaseFailure('DATABASE_SCHEMA_MISMATCH');
  } finally { reference.close(); }
}
export class SqliteFoundation {
  #db: DatabaseSync;
  #closed = false;
  #blocked: DatabaseFailure | null = null;
  #running = false;
  private constructor(db: DatabaseSync) { this.#db = db; }
  static open(options: { userData: string; mode: DatabaseMode; busyTimeoutMs?: number; migrations?: readonly Migration[] }): SqliteFoundation {
    let db: DatabaseSync | undefined;
    const migrations = options.migrations ?? MIGRATIONS;
    const timeout = options.busyTimeoutMs ?? 1500;
    if (!Number.isSafeInteger(timeout) || timeout<0 || timeout>10000) throw new DatabaseFailure('INVALID_DATABASE_INPUT');
    try {
      const path = databasePath(options.userData,options.mode);
      mkdirSync(dirname(path),{recursive:true});
      // Reject directory/symlink targets and preexisting empty files, rather than replacing them.
      if (existsSync(path)) { const file = lstatSync(path); if (!file.isFile() || file.isSymbolicLink() || file.size===0) throw new DatabaseFailure('DATABASE_OPEN_FAILED'); }
      db = new DatabaseSync(path,{ enableForeignKeyConstraints:true, enableDoubleQuotedStringLiterals:false, allowExtension:false, timeout });
      db.exec('PRAGMA foreign_keys=ON');
      if (Number(db.prepare('PRAGMA foreign_keys').get()?.foreign_keys)!==1) throw new DatabaseFailure('DATABASE_CONFIGURATION_FAILED');
      assertIntegrity(db);
      validateMigrations(db,migrations);
      db.exec(`PRAGMA busy_timeout=${timeout}`);
      const journal = db.prepare('PRAGMA journal_mode=WAL').get()?.journal_mode;
      db.exec('PRAGMA synchronous=FULL');
      if (journal!=='wal' || Number(db.prepare('PRAGMA synchronous').get()?.synchronous)!==2 || Number(db.prepare('PRAGMA busy_timeout').get()?.timeout)!==timeout) throw new DatabaseFailure('DATABASE_CONFIGURATION_FAILED');
      applyMigrations(db,migrations);
      assertIntegrity(db); assertSchema(db,migrations);
      parseInstallationState(db.prepare('SELECT * FROM installation_state').all());
      return new SqliteFoundation(db);
    } catch (error) { try { db?.close(); } catch { /* Preserve the original safe diagnostic. */ } throw databaseFailure(error); }
  }
  #assertAvailable() { if (this.#closed) throw new DatabaseFailure('DATABASE_CLOSED'); if (this.#blocked) throw this.#blocked; }
  read(sql: string, ...params: SQLInputValue[]): Row[] {
    this.#assertAvailable();
    if (!/^SELECT\s/i.test(sql.trim())) throw new DatabaseFailure('INVALID_DATABASE_INPUT');
    checkParams(params);
    try { return this.#db.prepare(sql).all(...params); } catch(error) { const failure=databaseFailure(error); if (failure.code==='DATABASE_CORRUPT') this.#blocked=failure; throw failure; }
  }
  installationState() { return parseInstallationState(this.read('SELECT * FROM installation_state')); }
  diagnostics() {
    this.#assertAvailable();
    try {
      assertIntegrity(this.#db);
      return Object.freeze({ schemaVersion:Number(this.#db.prepare('PRAGMA user_version').get()?.user_version), foreignKeys:Number(this.#db.prepare('PRAGMA foreign_keys').get()?.foreign_keys), journalMode:this.#db.prepare('PRAGMA journal_mode').get()?.journal_mode, synchronous:Number(this.#db.prepare('PRAGMA synchronous').get()?.synchronous), busyTimeoutMs:Number(this.#db.prepare('PRAGMA busy_timeout').get()?.timeout), sqliteVersion:this.#db.prepare('SELECT sqlite_version() AS version').get()?.version, installation:this.installationState(), interruptedRequests:this.read("SELECT request_id,kind,status FROM operation_requests WHERE status<>'committed'") });
    } catch(error) { const failure=databaseFailure(error,'DATABASE_CORRUPT'); this.#blocked=failure; throw failure; }
  }
  transaction<T>(work: (context: TransactionContext) => T): T {
    this.#assertAvailable();
    if (this.#running || this.#db.isTransaction) throw new DatabaseFailure('TRANSACTION_NESTED');
    let active = false;
    const statement = (sql: string, params: SQLInputValue[]) => {
      if (!active) throw new DatabaseFailure('TRANSACTION_INACTIVE');
      if (/^(?:BEGIN|COMMIT|END|ROLLBACK|SAVEPOINT|RELEASE|PRAGMA|ATTACH|DETACH|VACUUM)\b/i.test(sql.trim())) throw new DatabaseFailure('INVALID_DATABASE_INPUT');
      checkParams(params); return this.#db.prepare(sql);
    };
    const context: TransactionContext = Object.freeze({
      run:(sql:string,...params:SQLInputValue[])=>{ statement(sql,params).run(...params); },
      get:(sql:string,...params:SQLInputValue[])=>statement(sql,params).get(...params),
      all:(sql:string,...params:SQLInputValue[])=>statement(sql,params).all(...params),
    });
    try {
      this.#db.exec('BEGIN IMMEDIATE'); this.#running=true; active=true;
      const result = work(context);
      if (result && typeof (result as {then?:unknown}).then === 'function') {
        // Quarantine an accidental asynchronous callback and avoid unhandled rejection.
        void Promise.resolve(result).catch(()=>{});
        throw new DatabaseFailure('TRANSACTION_ASYNC_FORBIDDEN');
      }
      this.#db.exec('COMMIT'); return result;
    } catch (error) {
      if (this.#db.isTransaction) { try { this.#db.exec('ROLLBACK'); } catch { this.#blocked=new DatabaseFailure('DATABASE_ROLLBACK_FAILED'); throw this.#blocked; } }
      const failure=databaseFailure(error);
      if (failure.code==='DATABASE_CORRUPT') this.#blocked=failure;
      throw failure;
    } finally { active=false; this.#running=false; }
  }
  executeRequest(request: RequestInput, work: (context: TransactionContext) => JsonValue, authorize?: (context: TransactionContext) => void): JsonValue {
    if (!request.requestId || request.requestId.length>200 || !request.kind || request.kind.length>100) throw new DatabaseFailure('INVALID_DATABASE_INPUT');
    const hash = digest(canonicalJson(request.payload));
    return this.transaction(context=>{
      authorize?.(context);
      const previous = context.get('SELECT kind,payload_hash,status,result_json FROM operation_requests WHERE request_id=?',request.requestId);
      if (previous) {
        if (previous.kind!==request.kind || previous.payload_hash!==hash) throw new DatabaseFailure('REQUEST_CONFLICT');
        if (previous.status==='pending' && context.get('SELECT result_reference FROM operation_requests WHERE request_id=?',request.requestId)?.result_reference==='prepared') { /* Intent journal has no financial effects. */ }
        else {
        if (previous.status!=='committed') throw new DatabaseFailure('REQUEST_INTERRUPTED');
        try { return JSON.parse(String(previous.result_json)) as JsonValue; } catch { throw new DatabaseFailure('DATABASE_CORRUPT'); }
        }
      }
      if (!previous) context.run("INSERT INTO operation_requests(request_id,kind,status,payload_hash,created_at) VALUES(?,?,'pending',?,?)",request.requestId,request.kind,hash,new Date().toISOString());
      const result = work(context);
      if (result && typeof (result as {then?:unknown}).then === 'function') { void Promise.resolve(result).catch(()=>{}); throw new DatabaseFailure('TRANSACTION_ASYNC_FORBIDDEN'); }
      const serialized = canonicalJson(result);
      context.run("UPDATE operation_requests SET status='committed',result_json=?,completed_at=? WHERE request_id=?",serialized,new Date().toISOString(),request.requestId);
      return JSON.parse(serialized) as JsonValue;
    });
  }
  close() { if (this.#running) throw new DatabaseFailure('TRANSACTION_NESTED'); if (!this.#closed) { this.#db.close(); this.#closed=true; } }
}
