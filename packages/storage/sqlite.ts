// SPDX-License-Identifier: GPL-3.0-only
// The adapter between Drizzle and node:sqlite (QGD-ENG-0002).
//
// Drizzle 0.45 has no driver for node:sqlite, so the core uses its generic
// sqlite-proxy driver and answers its callback here. This file and migrate.ts
// are the only places that hand SQL text to SQLite: the text is what Drizzle
// generated, or a migration file the core ships. security-lint holds that
// nothing else calls prepare() or exec() with anything but a literal.
//
// The contract, each part of it tested in tests/storage.test.ts:
// - all and values return an array of positional rows; get returns one
//   positional row, or undefined when there is none. Drizzle maps positional
//   rows onto its fields; node:sqlite's default object rows would map to
//   empty records.
// - parameters bind by position, as Drizzle numbers them
// - a failure leaves as a StorageFailure carrying no value (QGD-ENG-0016)
// - Drizzle's query logger stays off: it would be handed every bound value
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { closeSync, openSync, readSync, statSync } from 'node:fs';
import { drizzle, type SqliteRemoteDatabase } from 'drizzle-orm/sqlite-proxy';
import { StorageFailure, failure } from './errors.js';
import { UnitQueue } from './queue.js';

// The first 16 bytes of every SQLite database file.
const SQLITE_HEADER = Buffer.from('SQLite format 3\0', 'latin1');

export interface StoreOptions {
  // Everything except a reference build opens reference.sqlite read-only
  // (QGD-ENG-0015). A read-only open never creates the file.
  readOnly?: boolean;
  // 'wal' for a store written while it is read (the default). 'delete' for a
  // file built once and then only read: a reference build writes in
  // rollback-journal mode, so no -wal or -shm is left beside it (QGD-ENG-0015).
  journal?: 'wal' | 'delete';
}

export interface Store<TSchema extends Record<string, unknown> = Record<string, never>> {
  readonly path: string;
  readonly readOnly: boolean;
  // Every request is one unit on this store's queue (QGD-ENG-0020). Nothing
  // touches the connection outside one.
  unit<T>(work: (db: SqliteRemoteDatabase<TSchema>) => Promise<T> | T): Promise<T>;
  close(): void;
  // For migrate.ts only: the migrator needs the raw connection to run a whole
  // pending set inside one transaction.
  readonly connection: DatabaseSync;
}

// QGD-ENG-0008: a file at a store's path that is not a SQLite database is
// refused and left exactly as it is. An empty file is what SQLite itself
// creates before its first write, so it is accepted.
export function isSqliteFile(path: string): boolean {
  let size: number;
  try { size = statSync(path).size; } catch { return false; }
  if (size === 0) return true;
  if (size < SQLITE_HEADER.length) return false;
  const head = Buffer.alloc(SQLITE_HEADER.length);
  const fd = openSync(path, 'r');
  try { readSync(fd, head, 0, head.length, 0); } finally { closeSync(fd); }
  return head.equals(SQLITE_HEADER);
}

function exists(path: string): boolean {
  try { statSync(path); return true; } catch { return false; }
}

export function openStore<TSchema extends Record<string, unknown> = Record<string, never>>(
  path: string,
  options: StoreOptions & { schema?: TSchema } = {}
): Store<TSchema> {
  const readOnly = options.readOnly === true;
  let present: boolean;
  let sqlite: boolean;
  try {
    present = exists(path);
    sqlite = present && isSqliteFile(path);
  } catch (error) {
    // A directory, a permission failure: reduced like any other, never raw.
    throw failure(error, 'open');
  }
  if (present && !sqlite) throw new StorageFailure({ kind: 'not-sqlite' });
  if (readOnly && !present) throw new StorageFailure({ kind: 'open' });

  let connection: DatabaseSync;
  try {
    // Foreign keys are enforced on every connection; it is node:sqlite's
    // default, and it is said here so that nobody turns it off by accident.
    connection = new DatabaseSync(path, { readOnly, enableForeignKeyConstraints: true });
    if (!readOnly) {
      connection.exec(options.journal === 'delete' ? 'PRAGMA journal_mode = DELETE' : 'PRAGMA journal_mode = WAL');
    }
  } catch (error) {
    throw failure(error, 'open');
  }

  const queue = new UnitQueue();
  const db = drizzle<TSchema>(
    async (sql: string, params: unknown[], method) => {
      try {
        const statement = connection.prepare(sql);
        const bound = params as SQLInputValue[];
        if (method === 'run') {
          statement.run(...bound);
          return { rows: [] };
        }
        statement.setReturnArrays(true);
        if (method === 'get') {
          // Drizzle's proxy takes `rows` here as the one row itself.
          return { rows: statement.get(...bound) as unknown as unknown[] };
        }
        return { rows: statement.all(...bound) };
      } catch (error) {
        throw failure(error, 'query');
      }
    },
    { schema: options.schema, logger: false }
  );

  return {
    path,
    readOnly,
    connection,
    // Whatever a unit throws leaves reduced (QGD-ENG-0016): the caller never
    // holds Drizzle's own error, whose message names every bound value.
    unit: (work) => queue.run(async () => {
      try { return await work(db); } catch (error) { throw failure(error, 'query'); }
    }),
    close: () => {
      if (connection.isOpen) connection.close();
    }
  };
}
