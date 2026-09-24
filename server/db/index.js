/**
 * Database connection + migration runner.
 *
 * Uses the SQLite engine built into Node 22 (`node:sqlite`). The database is a
 * real file on disk; every persistent feature in QuickSense reads and writes
 * through here, so nothing important lives only in frontend state.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import config from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

let handle = null;

export function applySchema(database) {
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
  database.exec(schema);
}

export function initDatabase(dbPath = config.dbPath) {
  const resolved = path.resolve(dbPath);
  if (resolved !== ':memory:') {
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
  }
  const database = new DatabaseSync(resolved);
  database.exec('PRAGMA journal_mode = WAL');
  database.exec('PRAGMA foreign_keys = ON');
  database.exec('PRAGMA busy_timeout = 5000');
  applySchema(database);
  handle = database;
  return handle;
}

export function db() {
  if (!handle) initDatabase();
  return handle;
}

export function setDatabase(database) {
  handle = database;
  return database;
}

export function closeDatabase() {
  if (handle) {
    handle.close();
    handle = null;
  }
}

/** Run a function inside a transaction, rolling back on any throw. */
export function transaction(fn) {
  const database = db();
  database.exec('BEGIN');
  try {
    const result = fn(database);
    database.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      database.exec('ROLLBACK');
    } catch {
      /* connection already unusable; original error is more useful */
    }
    throw error;
  }
}

/** SELECT many. Returns a plain array of plain objects. */
export function all(sql, params = []) {
  return db().prepare(sql).all(...params).map((row) => ({ ...row }));
}

/** SELECT one, or null. */
export function get(sql, params = []) {
  const row = db().prepare(sql).get(...params);
  return row ? { ...row } : null;
}

/** INSERT/UPDATE/DELETE. */
export function run(sql, params = []) {
  return db().prepare(sql).run(...params);
}

/**
 * Returns true when the schema is present and at least the `users` table exists.
 * Used by the startup self-check.
 */
export function verifySchema() {
  const table = get(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='users'"
  );
  return Boolean(table);
}
