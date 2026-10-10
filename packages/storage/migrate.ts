// SPDX-License-Identifier: GPL-3.0-only
// Applying a store's migrations, whole or not at all (QGD-ENG-0013).
//
// Drizzle's sqlite-proxy migrator collects every pending statement, plus its
// own bookkeeping insert for each migration, and hands the whole list to a
// callback without opening a transaction. So the transaction is opened here.
// BEGIN IMMEDIATE takes the write lock before the first statement, and SQLite
// DDL is transactional, so a failure anywhere in the list rolls back every
// migration in it. The store is then exactly as it was before the run.
import { migrate } from 'drizzle-orm/sqlite-proxy/migrator';
import { sql } from 'drizzle-orm';
import { failure } from './errors.js';
import type { Store } from './sqlite.js';

export const MIGRATIONS_TABLE = '__drizzle_migrations';

export interface Applied {
  count: number;
  latest: string | undefined;
}

export async function applyMigrations<TSchema extends Record<string, unknown>>(
  store: Store<TSchema>,
  folder: string
): Promise<Applied> {
  await store.unit(async (db) => {
    const connection = store.connection;
    // Opened before Drizzle's migrator runs, because the migrator creates its
    // own bookkeeping table before it hands over the statements. A failed
    // first run must not leave even that behind.
    connection.exec('BEGIN IMMEDIATE');
    try {
      await migrate(db, async (queries: string[]) => {
        // The migration files the frame ships, and Drizzle's own bookkeeping
        // insert. Nothing in them comes from a user.
        for (const query of queries) connection.exec(query);
      }, { migrationsFolder: folder, migrationsTable: MIGRATIONS_TABLE });
      connection.exec('COMMIT');
    } catch (error) {
      try { if (connection.isTransaction) connection.exec('ROLLBACK'); } catch { /* the original failure is the one reported */ }
      throw failure(error, 'migration');
    }
  });
  return read(store);
}

export async function read<TSchema extends Record<string, unknown>>(store: Store<TSchema>): Promise<Applied> {
  return store.unit(async (db) => {
    const table = sql.identifier(MIGRATIONS_TABLE);
    const count = await db.get<[number]>(sql`SELECT count(*) FROM ${table}`).catch(() => undefined);
    // The latest is the one applied last, by Drizzle's own timestamp. A hash
    // sorts in no meaningful order.
    const latest = await db.get<[string]>(sql`SELECT hash FROM ${table} ORDER BY created_at DESC, rowid DESC LIMIT 1`)
      .catch(() => undefined);
    return { count: Number(count?.[0] ?? 0), latest: latest?.[0] ?? undefined };
  });
}
