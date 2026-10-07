import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from '../config.js';
import { migrate } from './migrations.js';

export type DB = Database.Database;
export type SqlParams = unknown[] | [Record<string, unknown>];

let instance: DB | null = null;
const statements = new Map<string, Database.Statement>();

export function openDatabase(file: string = config.databasePath): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const database = new Database(file);
  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');
  database.pragma('busy_timeout = 5000');
  database.pragma('synchronous = NORMAL');
  migrate(database);
  return database;
}

/** Shared connection. better-sqlite3 is synchronous, so a single connection serializes all writes. */
export function db(): DB {
  if (!instance) instance = openDatabase();
  return instance;
}

export function closeDatabase(): void {
  statements.clear();
  instance?.close();
  instance = null;
}

function prepared(sql: string): Database.Statement {
  let statement = statements.get(sql);
  if (!statement) {
    statement = db().prepare(sql);
    statements.set(sql, statement);
  }
  return statement;
}

export function get<T>(sql: string, ...params: unknown[]): T | undefined {
  return prepared(sql).get(...params) as T | undefined;
}

export function all<T>(sql: string, ...params: unknown[]): T[] {
  return prepared(sql).all(...params) as T[];
}

export function run(sql: string, ...params: unknown[]): Database.RunResult {
  return prepared(sql).run(...params);
}

let afterCommitQueue: Array<() => void> | null = null;

/**
 * Runs fn inside a transaction; nested calls become savepoints. Callbacks registered with afterCommit()
 * run once the outermost transaction commits and are dropped if it rolls back.
 */
export function transaction<T>(fn: () => T): T {
  const outermost = !db().inTransaction;
  if (!outermost) return db().transaction(fn)();
  afterCommitQueue = [];
  try {
    const result = db().transaction(fn)();
    const queue = afterCommitQueue;
    afterCommitQueue = null;
    for (const callback of queue) {
      try {
        callback();
      } catch (err) {
        console.error('afterCommit callback failed', err);
      }
    }
    return result;
  } catch (err) {
    afterCommitQueue = null;
    throw err;
  }
}

/** Defers side effects (events, pushes) until the current transaction commits. */
export function afterCommit(callback: () => void): void {
  if (afterCommitQueue && db().inTransaction) afterCommitQueue.push(callback);
  else callback();
}

/** Builds "a = ?, b = ?" assignments for a partial update, skipping undefined values. */
export function assignments(values: Record<string, unknown>): { sql: string; params: unknown[] } {
  const keys = Object.keys(values).filter((key) => values[key] !== undefined);
  return {
    sql: keys.map((key) => `${key} = ?`).join(', '),
    params: keys.map((key) => {
      const value = values[key];
      return typeof value === 'boolean' ? Number(value) : value;
    }),
  };
}
