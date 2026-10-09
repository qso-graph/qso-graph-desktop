// SPDX-License-Identifier: GPL-3.0-only
// QGD-ENG-0002. Used by drizzle-kit to generate migrations from the schema;
// the application never reads this file, and no connection string lives in it
// — generating a migration compares the schema against the migrations already
// written, not against a running database.
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  // Every schema the frame brings: its own, and the reference data's
  // (QGD-ENG-0001 gives reference data its own schema, still frame-owned).
  schema: ['./src/engine/schema.ts', './src/engine/reference/schema.ts'],
  out: './drizzle',
  // Drizzle's own bookkeeping, in a schema of its own rather than in the one
  // the migrations build: the migrator creates this schema before it runs
  // anything, so sharing it meant the first migration's own CREATE SCHEMA
  // found it already there and failed.
  migrations: { schema: 'qg_meta', table: '__migrations' },
  strict: true,
  verbose: false
});
