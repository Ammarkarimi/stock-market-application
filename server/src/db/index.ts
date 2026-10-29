import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import { PGlite, types as pgliteTypes } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { attachDatabasePool } from '@vercel/functions';
import pg from 'pg';
import { config } from '../config.js';
import { migrate } from './migrations.js';

/**
 * Postgres access for the whole server. In production this is a connection pool to Neon; without a
 * DATABASE_URL (local development and tests) it is PGlite, Postgres compiled to WebAssembly and run in-process.
 *
 * Queries use `?` placeholders, numbered for Postgres here. BIGINT and NUMERIC values come back as numbers:
 * money is stored as integer paise, well within the safe integer range.
 */

export interface RunResult {
  changes: number;
  /** id of the row an INSERT created, for tables with an id column (0 otherwise). */
  lastInsertRowid: number;
}

interface Rows<T> {
  rows: T[];
  rowCount: number;
}

export interface Connection {
  query<T>(sql: string, params: unknown[]): Promise<Rows<T>>;
  /** Runs several statements without parameters (migrations). */
  exec(sql: string): Promise<void>;
}

export interface Driver extends Connection {
  readonly kind: 'postgres' | 'pglite';
  /** Runs fn with a single connection held for its duration. */
  withConnection<T>(fn: (connection: Connection) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

const BIGINT_OID = 20;
const NUMERIC_OID = 1700;

/** Every write transaction holds this advisory lock, so writes run one at a time (see transaction()). */
const WRITE_LOCK = 7_306_001;

function postgresDriver(connectionString: string): Driver {
  pg.types.setTypeParser(BIGINT_OID, Number);
  pg.types.setTypeParser(NUMERIC_OID, Number);
  const pool = new pg.Pool({
    connectionString,
    max: config.databasePoolSize,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });
  pool.on('error', (err) => console.error('Idle database connection failed', err));
  // Lets Vercel close idle connections before it suspends an instance.
  if (process.env.VERCEL) attachDatabasePool(pool);
  const toRows = <T>(result: pg.QueryResult): Rows<T> => ({ rows: result.rows as T[], rowCount: result.rowCount ?? 0 });
  return {
    kind: 'postgres',
    async query<T>(sql: string, params: unknown[]) {
      return toRows<T>(await pool.query(sql, params));
    },
    async exec(sql) {
      await pool.query(sql);
    },
    async withConnection(fn) {
      const client = await pool.connect();
      try {
        return await fn({
          query: async <T>(sql: string, params: unknown[]) => toRows<T>(await client.query(sql, params)),
          exec: async (sql) => void (await client.query(sql)),
        });
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

function pgliteDriver(dataDir: string): Driver {
  if (dataDir !== ':memory:') fs.mkdirSync(dataDir, { recursive: true });
  // PGlite ignores its options when the data folder argument is undefined, so name the in-memory store.
  const db = new PGlite(dataDir === ':memory:' ? 'memory://' : dataDir, {
    extensions: { citext },
    parsers: { [pgliteTypes.INT8]: Number, [pgliteTypes.NUMERIC]: Number },
  });
  // PGlite has a single connection: queue everything, so a transaction never sees another request's statements.
  let queue: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(fn: () => Promise<T>): Promise<T> => {
    const result = queue.then(fn, fn);
    queue = result.catch(() => {});
    return result;
  };
  const connection: Connection = {
    async query<T>(sql: string, params: unknown[]) {
      const result = await db.query<T>(sql, params);
      return { rows: result.rows, rowCount: result.affectedRows ?? 0 };
    },
    exec: async (sql) => void (await db.exec(sql)),
  };
  return {
    kind: 'pglite',
    query: (sql, params) => exclusive(() => connection.query(sql, params)),
    exec: (sql) => exclusive(() => connection.exec(sql)),
    withConnection: (fn) => exclusive(() => fn(connection)),
    close: () => db.close(),
  };
}

let driverPromise: Promise<Driver> | null = null;

async function openDriver(): Promise<Driver> {
  const driver = config.databaseUrl ? postgresDriver(config.databaseUrl) : pgliteDriver(config.databasePath);
  await migrate(driver);
  return driver;
}

/** The shared database, connected and migrated on first use. */
export function database(): Promise<Driver> {
  driverPromise ??= openDriver().catch((err) => {
    driverPromise = null;
    throw err;
  });
  return driverPromise;
}

export async function closeDatabase(): Promise<void> {
  const pending = driverPromise;
  driverPromise = null;
  if (pending) await (await pending).close();
}

// ---- Transactions ----

interface TransactionContext {
  connection: Connection;
  active: boolean;
  savepoints: number;
  afterCommit: Array<() => unknown>;
}

const context = new AsyncLocalStorage<TransactionContext>();

function currentTransaction(): TransactionContext | undefined {
  const ctx = context.getStore();
  return ctx?.active ? ctx : undefined;
}

/**
 * Runs fn in a transaction; nested calls become savepoints. Callbacks registered with afterCommit() run once
 * the outermost transaction commits and are dropped if it rolls back.
 *
 * Every transaction first takes one advisory lock, held until it commits, so write transactions run one at a
 * time as they did on SQLite. Each statement after the lock sees everything committed before it, which keeps
 * read-then-write logic (available funds, the audit hash chain) correct with many concurrent requests.
 */
export async function transaction<T>(fn: () => Promise<T>): Promise<T> {
  const outer = currentTransaction();
  if (outer) {
    const name = `sp_${++outer.savepoints}`;
    await outer.connection.query(`SAVEPOINT ${name}`, []);
    try {
      const result = await fn();
      await outer.connection.query(`RELEASE SAVEPOINT ${name}`, []);
      return result;
    } catch (err) {
      // If even the rollback fails, the original error is the one worth reporting.
      await outer.connection.query(`ROLLBACK TO SAVEPOINT ${name}`, []).catch(() => {});
      throw err;
    }
  }

  const driver = await database();
  const { result, callbacks } = await driver.withConnection(async (connection) => {
    const ctx: TransactionContext = { connection, active: true, savepoints: 0, afterCommit: [] };
    await connection.query('BEGIN', []);
    try {
      await connection.query('SELECT pg_advisory_xact_lock($1)', [WRITE_LOCK]);
      const value = await context.run(ctx, fn);
      await connection.query('COMMIT', []);
      return { result: value, callbacks: ctx.afterCommit };
    } catch (err) {
      await connection.query('ROLLBACK', []).catch(() => {});
      throw err;
    } finally {
      ctx.active = false;
    }
  });
  for (const callback of callbacks) {
    try {
      await callback();
    } catch (err) {
      console.error('afterCommit callback failed', err);
    }
  }
  return result;
}

/** Defers side effects until the current transaction commits; runs them right away outside a transaction. */
export function afterCommit(callback: () => unknown): void {
  const ctx = currentTransaction();
  if (ctx) {
    ctx.afterCommit.push(callback);
    return;
  }
  void Promise.resolve()
    .then(callback)
    .catch((err) => console.error('afterCommit callback failed', err));
}

export function inTransaction(): boolean {
  return currentTransaction() !== undefined;
}

// ---- Queries ----

const converted = new Map<string, string>();

/** Turns `?` placeholders into $1, $2, … — skipping quoted strings, identifiers and comments. */
export function toPostgres(sql: string): string {
  const cached = converted.get(sql);
  if (cached !== undefined) return cached;
  let out = '';
  let n = 0;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i]!;
    if (c === "'" || c === '"') {
      const end = sql.indexOf(c, i + 1);
      const stop = end === -1 ? sql.length - 1 : end;
      out += sql.slice(i, stop + 1);
      i = stop;
    } else if (c === '-' && sql[i + 1] === '-') {
      const end = sql.indexOf('\n', i);
      const stop = end === -1 ? sql.length - 1 : end;
      out += sql.slice(i, stop + 1);
      i = stop;
    } else if (c === '?') {
      out += `$${++n}`;
    } else {
      out += c;
    }
  }
  converted.set(sql, out);
  return out;
}

function normalize(params: unknown[]): unknown[] {
  return params.map((value) => (value === undefined ? null : typeof value === 'boolean' ? Number(value) : value));
}

async function execute<T>(sql: string, params: unknown[]): Promise<Rows<T>> {
  const text = toPostgres(sql);
  const values = normalize(params);
  const ctx = currentTransaction();
  if (ctx) return ctx.connection.query<T>(text, values);
  return (await database()).query<T>(text, values);
}

export async function get<T>(sql: string, ...params: unknown[]): Promise<T | undefined> {
  return (await execute<T>(sql, params)).rows[0];
}

export async function all<T>(sql: string, ...params: unknown[]): Promise<T[]> {
  return (await execute<T>(sql, params)).rows;
}

/** Tables whose rows are numbered by an identity id column, returned by run() as lastInsertRowid. */
const TABLES_WITH_ID = new Set([
  'users',
  'securities',
  'orders',
  'trades',
  'ledger_entries',
  'fund_transactions',
  'watchlists',
  'price_alerts',
  'notifications',
  'ipos',
  'ipo_applications',
  'audit_logs',
]);
const INSERT_INTO = /^\s*INSERT\s+INTO\s+([a-z_]+)/i;

export async function run(sql: string, ...params: unknown[]): Promise<RunResult> {
  const table = INSERT_INTO.exec(sql)?.[1]?.toLowerCase();
  const returning = table !== undefined && TABLES_WITH_ID.has(table) && !/\bRETURNING\b/i.test(sql);
  const result = await execute<{ id: number }>(returning ? `${sql} RETURNING id` : sql, params);
  return { changes: result.rowCount, lastInsertRowid: returning ? (result.rows[0]?.id ?? 0) : 0 };
}

/** Builds "a = ?, b = ?" assignments for a partial update, skipping undefined values. */
export function assignments(values: Record<string, unknown>): { sql: string; params: unknown[] } {
  const keys = Object.keys(values).filter((key) => values[key] !== undefined);
  return {
    sql: keys.map((key) => `${key} = ?`).join(', '),
    params: keys.map((key) => values[key]),
  };
}

/**
 * Inserts many rows with as few statements as possible (Postgres allows 65,535 parameters per statement), so
 * bulk writes such as price history take a handful of round trips instead of one per row. `suffix` is added
 * to each statement, e.g. an ON CONFLICT clause; rows in one call must not conflict with each other.
 */
export async function insertMany(table: string, columns: string[], rows: unknown[][], suffix = ''): Promise<void> {
  const perStatement = Math.max(1, Math.min(1000, Math.floor(65_000 / columns.length)));
  const tuple = `(${columns.map(() => '?').join(', ')})`;
  for (let i = 0; i < rows.length; i += perStatement) {
    const chunk = rows.slice(i, i + perStatement);
    await execute(`INSERT INTO ${table} (${columns.join(', ')}) VALUES ${chunk.map(() => tuple).join(', ')} ${suffix}`, chunk.flat());
  }
}
