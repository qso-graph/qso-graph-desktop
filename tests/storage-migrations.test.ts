// SPDX-License-Identifier: GPL-3.0-only
// P4-migrations (QGD-ENG-0013): the migrations apply when a store is opened,
// what has been applied is recorded in the file, and a run that fails part way
// rolls back whole. Drizzle's proxy migrator does not open a transaction of its
// own, so the "whole" is ours to prove.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import { StorageFailure } from '../packages/storage/errors.js';
import { applyMigrations, read } from '../packages/storage/migrate.js';
import { openStore } from '../packages/storage/sqlite.js';

const SHIPPED = resolve('drizzle/state');
// How many migrations ship, read from their journal rather than written here.
const SHIPPED_COUNT = (JSON.parse(readFileSync(join(SHIPPED, 'meta', '_journal.json'), 'utf8')) as { entries: unknown[] }).entries.length;
let root: string;

beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'qg-migrations-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

// A copy of the shipped migrations with more appended, so a run holds several.
function folderWith(extra: { tag: string; sql: string }[]): string {
  const folder = join(root, `migrations-${extra.map((m) => m.tag).join('-') || 'shipped'}`);
  cpSync(SHIPPED, folder, { recursive: true });
  const journalPath = join(folder, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
  let when = Math.max(...journal.entries.map((entry: { when: number }) => entry.when));
  for (const migration of extra) {
    when += 1000;
    journal.entries.push({ idx: journal.entries.length, version: '6', when, tag: migration.tag, breakpoints: true });
    writeFileSync(join(folder, `${migration.tag}.sql`), migration.sql);
  }
  writeFileSync(journalPath, JSON.stringify(journal));
  return folder;
}

async function tables(path: string): Promise<string[]> {
  const store = openStore(path);
  try {
    const rows = await store.unit((db) =>
      db.values<[string]>(sql`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`));
    return rows.map((row) => row[0]);
  } finally { store.close(); }
}

const GOOD = { tag: '0001_good', sql: 'CREATE TABLE `good_one` (`x` text);' };
const BAD = { tag: '0002_bad', sql: 'CREATE TABLE `good_two` (`x` text);\n--> statement-breakpoint\nTHIS IS NOT SQL;' };

// Each test opens a store and runs every migration on a fresh file, which a
// hosted Windows runner has taken over five seconds to do: vitest's default
// failed the rename test there with nothing wrong (CI, 2026-10-19).
describe('P4-migrations (QGD-ENG-0013)', { timeout: 30_000 }, () => {
  it('applies the shipped migrations and records them in the file', async () => {
    const path = join(root, 'state.sqlite');
    const store = openStore(path);
    try {
      const applied = await applyMigrations(store, SHIPPED);
      expect(applied.count).toBe(SHIPPED_COUNT);
      // A second application finds nothing pending and changes nothing.
      expect(await applyMigrations(store, SHIPPED)).toEqual(applied);
    } finally { store.close(); }
    expect(await tables(path)).toEqual(expect.arrayContaining(['__drizzle_migrations', 'extension_state', 'installation']));
    // 0002 renamed it: a store migrated from 0000 must not keep the old name.
    expect(await tables(path)).not.toContain('app_state');
  });

  // A store made before 0002 (existing profiles are) keeps what it
  // holds when the table is renamed. Applied as an upgrade, not a fresh run.
  it('carries an extension\'s state across the app_state to extension_state rename', async () => {
    const before = join(root, 'before-0002');
    cpSync(SHIPPED, before, { recursive: true });
    const journalPath = join(before, 'meta', '_journal.json');
    const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
    journal.entries = journal.entries.filter((entry: { tag: string }) => entry.tag < '0002');
    writeFileSync(journalPath, JSON.stringify(journal));
    const path = join(root, 'state.sqlite');
    const store = openStore(path);
    try {
      await applyMigrations(store, before);
      await store.unit((db) => db.run(sql`INSERT INTO app_state (app_id, key, value, updated_at) VALUES ('solar', 'band', '"20m"', '2026-10-11T00:00:00Z')`));
      await applyMigrations(store, SHIPPED);
      const rows = await store.unit((db) =>
        db.values<[string, string, string]>(sql`SELECT extension_id, key, value FROM extension_state`));
      expect(rows).toEqual([['solar', 'band', '"20m"']]);
    } finally { store.close(); }
    expect(await tables(path)).not.toContain('app_state');
  });

  it('rolls back a whole fresh run when its last migration fails', async () => {
    const path = join(root, 'state.sqlite');
    const store = openStore(path);
    try {
      const error = await applyMigrations(store, folderWith([GOOD, BAD])).then(() => undefined, (e: unknown) => e);
      expect(error).toBeInstanceOf(StorageFailure);
      expect((error as StorageFailure).reduced.kind).toBe('migration');
      expect((await read(store)).count).toBe(0);
    } finally { store.close(); }
    // The store is exactly as it was: empty. Not the shipped tables, not the
    // good migration, not half of the bad one, not even Drizzle's own table.
    expect(await tables(path)).toEqual([]);
  });

  it('rolls back the pending run on a store already migrated, and keeps what was there', async () => {
    const path = join(root, 'state.sqlite');
    const store = openStore(path);
    try {
      await applyMigrations(store, SHIPPED);
      await store.unit((db) => db.run(sql`INSERT INTO installation VALUES ('this', 'then', 'v1')`));
      const error = await applyMigrations(store, folderWith([GOOD, BAD])).then(() => undefined, (e: unknown) => e);
      expect(error).toBeInstanceOf(StorageFailure);
      expect((await read(store)).count).toBe(SHIPPED_COUNT);
      const row = await store.unit((db) => db.values(sql`SELECT created_by_version FROM installation`));
      expect(row).toEqual([['v1']]);
    } finally { store.close(); }
    const left = await tables(path);
    expect(left).not.toContain('good_one');
    expect(left).not.toContain('good_two');
  });

  it('control: the same run without the bad migration applies both', async () => {
    const path = join(root, 'state.sqlite');
    const store = openStore(path);
    try {
      const applied = await applyMigrations(store, folderWith([GOOD]));
      expect(applied.count).toBe(SHIPPED_COUNT + 1);
      // The latest is the one applied last, not the largest hash.
      const newest = await store.unit((db) =>
        db.values<[string]>(sql`SELECT hash FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1`));
      expect(applied.latest).toBe(newest[0][0]);
    } finally { store.close(); }
    expect(await tables(path)).toContain('good_one');
  });
});
