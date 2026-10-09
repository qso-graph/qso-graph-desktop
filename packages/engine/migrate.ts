// SPDX-License-Identifier: GPL-3.0-only
// Applying the migrations, at every start.
//
// QGD-ENG-0013. Drizzle generates them from packages/engine/schema.ts and records
// which have been applied in the database itself, so the answer to "is this
// database up to date" comes from the database and not from a file beside it.
//
// A migration that fails stops the engine. Carrying on would leave a database
// that is neither the old shape nor the new one, which is the state nothing
// can recover from automatically — and the application above it would be
// writing into it meanwhile.
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { sql } from 'drizzle-orm';
import type { Client } from 'pg';
import { FRAME_SCHEMA, INSTALLATION_ID } from './schema.js';

// Drizzle's own, kept apart from the schema the migrations build. The
// migrator creates this one before running anything, so sharing it would mean
// the first migration's CREATE SCHEMA found it already there.
export const MIGRATIONS_SCHEMA = 'qg_meta';
export const MIGRATIONS_TABLE = '__migrations';

export interface Applied {
  count: number;
  latest: string | undefined;
}

export async function applyMigrations(client: Client, folder: string): Promise<Applied> {
  const db = drizzle(client);
  // Drizzle creates the schema and its own table if they are missing, takes a
  // lock, and applies in order. A failure throws, and this does not catch it:
  // the caller stops the engine.
  await migrate(db, { migrationsFolder: folder, migrationsSchema: MIGRATIONS_SCHEMA, migrationsTable: MIGRATIONS_TABLE });
  return read(client);
}

export async function read(client: Client): Promise<Applied> {
  const result = await client.query<{ count: string; latest: string | null }>(
    `SELECT count(*)::text AS count, max(hash) AS latest FROM ${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}`
  );
  const row = result.rows[0];
  return { count: Number(row?.count ?? 0), latest: row?.latest ?? undefined };
}

// The one row that says which database this is. Written after the migrations,
// because the table it goes in is made by one.
export async function recordInstallation(
  client: Client,
  postgresMajor: number,
  version: string
): Promise<void> {
  const db = drizzle(client);
  // Inserted once and never rewritten: the row records when this database was
  // made and by what, and a later start must not quietly restate it.
  await db.execute(sql`
    INSERT INTO ${sql.identifier(FRAME_SCHEMA)}.installation (id, postgres_major, created_by_version)
    VALUES (${INSTALLATION_ID}, ${postgresMajor}, ${version})
    ON CONFLICT (id) DO NOTHING
  `);
}

export interface Installation {
  id: string;
  createdAt: Date;
  postgresMajor: number;
  createdByVersion: string;
}

export async function installation(client: Client): Promise<Installation | undefined> {
  const result = await client.query<{
    id: string; created_at: Date; postgres_major: number; created_by_version: string;
  }>(`SELECT id, created_at, postgres_major, created_by_version FROM ${FRAME_SCHEMA}.installation WHERE id = $1`,
    [INSTALLATION_ID]);
  const row = result.rows[0];
  return row && {
    id: row.id,
    createdAt: row.created_at,
    postgresMajor: Number(row.postgres_major),
    createdByVersion: row.created_by_version
  };
}
