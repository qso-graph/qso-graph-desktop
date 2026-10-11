// SPDX-License-Identifier: GPL-3.0-only
// The storage package on its own, with no window and no process around it:
// P4-layout, P4-adapter, P4-one-writer, P4-units-of-work, P4-errors,
// P4-app-folder and P4-sorting (docs/P4.md). Each check that could pass by
// checking nothing has a control beside it that shows it can fail.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/sqlite-proxy';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { eq } from 'drizzle-orm';
import { StorageFailure, describe as describeError, reduce } from '../packages/storage/errors.js';
import { extensionFolder, layout, openState, removeExtensionFolder } from '../packages/storage/layout.js';
import { openStore, isSqliteFile } from '../packages/storage/sqlite.js';
import { UnitQueue } from '../packages/storage/queue.js';
import { extensionState, installation, INSTALLATION_ID } from '../packages/storage/schema.js';

const MIGRATIONS = resolve('drizzle/state');
const SENTINEL = 'QGD-SENTINEL-4f1c9a';
let root: string;

beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'qg-storage-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

function caught(work: () => unknown): Promise<unknown> {
  return Promise.resolve().then(work).then(() => undefined, (error: unknown) => error);
}

describe('P4-layout: what the first run creates (QGD-ENG-0001, QGD-ENG-0007)', () => {
  it('creates state.sqlite with its installation row, and nothing else', async () => {
    const paths = layout(root);
    const store = await openState(paths, MIGRATIONS, '0.0.0-test');
    try {
      const row = await store.unit((db) => db.select().from(installation).where(eq(installation.id, INSTALLATION_ID)).get());
      expect(row?.createdByVersion).toBe('0.0.0-test');
    } finally { store.close(); }
    expect(isSqliteFile(paths.state)).toBe(true);
    // No application folder and no reference file: each is made when first needed.
    expect(existsSync(paths.extensions)).toBe(false);
    expect(existsSync(paths.reference)).toBe(false);
    expect(readdirSync(root).filter((name) => name.includes('.creating'))).toEqual([]);
  });

  it('is idempotent: a second start keeps the first row', async () => {
    const paths = layout(root);
    const first = await openState(paths, MIGRATIONS, 'first');
    const before = await first.unit((db) => db.select().from(installation).get());
    first.close();
    const second = await openState(paths, MIGRATIONS, 'second');
    const after = await second.unit((db) => db.select().from(installation).get());
    second.close();
    expect(after).toEqual(before);
  });

  it('leaves nothing behind when the creation is made to fail', async () => {
    const paths = layout(root);
    const broken = join(root, 'broken-migrations');
    mkdirSync(join(broken, 'meta'), { recursive: true });
    writeFileSync(join(broken, 'meta', '_journal.json'), JSON.stringify({
      version: '7', dialect: 'sqlite', entries: [{ idx: 0, version: '6', when: 1, tag: '0000_bad', breakpoints: true }]
    }));
    writeFileSync(join(broken, '0000_bad.sql'), 'CREATE TABLE ok (x);\n--> statement-breakpoint\nTHIS IS NOT SQL;');
    const error = await caught(() => openState(paths, broken, 'x'));
    expect(error).toBeInstanceOf(StorageFailure);
    expect(existsSync(paths.state)).toBe(false);
    expect(readdirSync(root).filter((name) => name.startsWith('state.sqlite'))).toEqual([]);
    // The next start begins again and succeeds.
    const store = await openState(paths, MIGRATIONS, 'retry');
    store.close();
    expect(isSqliteFile(paths.state)).toBe(true);
  });
});

describe('P4-layout: an abandoned creation is never built on (QGD-ENG-0007)', () => {
  it('removes a leftover temporary database before creating, and starts clean', async () => {
    const paths = layout(root);
    const stale = openStore(`${paths.state}.creating`);
    stale.connection.exec("CREATE TABLE leftover (x); INSERT INTO leftover VALUES ('abandoned')");
    stale.close();
    (await openState(paths, MIGRATIONS, 'x')).close();
    const store = openStore(paths.state);
    try {
      const names = await store.unit((db) => db.values<[string]>(sql`SELECT name FROM sqlite_master WHERE type = 'table'`));
      expect(names.map((row) => row[0])).not.toContain('leftover');
    } finally { store.close(); }
    expect(existsSync(`${paths.state}.creating`)).toBe(false);
  });

  it('refuses to create when the leftover cannot be removed', async () => {
    const paths = layout(root);
    // A directory under the temporary name: rmSync without recursive cannot
    // remove it, which stands in for a removal the system refuses.
    mkdirSync(join(`${paths.state}.creating`, 'inside'), { recursive: true });
    const error = await caught(() => openState(paths, MIGRATIONS, 'x'));
    expect(error).toBeInstanceOf(StorageFailure);
    expect(existsSync(paths.state)).toBe(false);
  });
});

describe('P4-one-writer: a file that is not SQLite is refused (QGD-ENG-0008)', () => {
  it('refuses it and leaves it exactly as it was', async () => {
    const paths = layout(root);
    writeFileSync(paths.state, 'not a database, and somebody may want it');
    const before = readFileSync(paths.state);
    const error = await caught(() => openState(paths, MIGRATIONS, 'x'));
    expect(error).toBeInstanceOf(StorageFailure);
    expect((error as StorageFailure).reduced.kind).toBe('not-sqlite');
    expect(readFileSync(paths.state)).toEqual(before);
  });

  it('control: a real database at the same path opens', async () => {
    const paths = layout(root);
    (await openState(paths, MIGRATIONS, 'x')).close();
    expect(isSqliteFile(paths.state)).toBe(true);
    (await openState(paths, MIGRATIONS, 'x')).close();
  });

  it('opens read-only without creating, and refuses a write through it', async () => {
    const path = join(root, 'reference.sqlite');
    expect(((await caught(() => openStore(path, { readOnly: true }))) as StorageFailure).reduced.kind).toBe('open');
    expect(existsSync(path)).toBe(false);
    const writable = openStore(path);
    writable.connection.exec('CREATE TABLE t (x)');
    writable.close();
    const reader = openStore(path, { readOnly: true });
    try {
      const error = await caught(() => reader.unit((db) => db.run(sql`INSERT INTO t VALUES (1)`)));
      expect((error as StorageFailure).reduced.kind).toBe('query');
      expect((error as StorageFailure).reduced.code).toBe(8); // SQLITE_READONLY
    } finally { reader.close(); }
  });
});

// A table the core does not have, so each column mode is exercised.
const sample = sqliteTable('sample', {
  id: integer('id').primaryKey(),
  name: text('name').notNull(),
  active: integer('active', { mode: 'boolean' }).notNull(),
  detail: text('detail', { mode: 'json' }).$type<{ band: string; modes: string[] }>()
});

describe('P4-adapter: the contract with Drizzle (QGD-ENG-0002)', () => {
  async function store() {
    const s = openStore(join(root, 'adapter.sqlite'), { schema: { sample } });
    s.connection.exec('CREATE TABLE sample (id INTEGER PRIMARY KEY, name TEXT NOT NULL, active INTEGER NOT NULL, detail TEXT)');
    await s.unit((db) => db.insert(sample).values([
      { id: 1, name: 'W1AW', active: true, detail: { band: '20m', modes: ['CW', 'FT8'] } },
      { id: 2, name: 'K7RA', active: false, detail: null }
    ]));
    return s;
  }

  it('maps all() onto named fields, decoding booleans and JSON', async () => {
    const s = await store();
    try {
      const rows = await s.unit((db) => db.select().from(sample).orderBy(sample.id).all());
      expect(rows).toEqual([
        { id: 1, name: 'W1AW', active: true, detail: { band: '20m', modes: ['CW', 'FT8'] } },
        { id: 2, name: 'K7RA', active: false, detail: null }
      ]);
    } finally { s.close(); }
  });

  it('returns one row from get(), and undefined when there is none', async () => {
    const s = await store();
    try {
      expect(await s.unit((db) => db.select({ name: sample.name }).from(sample).where(eq(sample.id, 2)).get()))
        .toEqual({ name: 'K7RA' });
      expect(await s.unit((db) => db.select().from(sample).where(eq(sample.id, 99)).get())).toBeUndefined();
    } finally { s.close(); }
  });

  it('returns positional rows from values(), binding parameters by position', async () => {
    const s = await store();
    try {
      const rows = await s.unit((db) => db.values(sql`SELECT ${'a'}, ${2}, name FROM sample WHERE id = ${1}`));
      expect(rows).toEqual([['a', 2, 'W1AW']]);
    } finally { s.close(); }
  });

  it('control: node:sqlite\'s default object rows would map to nothing', async () => {
    // Why the adapter turns on array mode: without it the mapped record loses
    // every value. This is the defect the contract exists to prevent.
    const s = await store();
    try {
      const objectRows = drizzle(async (query, params, method) => {
        const statement = s.connection.prepare(query);
        if (method === 'get') return { rows: statement.get(...(params as never[])) as never };
        return { rows: statement.all(...(params as never[])) };
      }, { schema: { sample } });
      // Either Drizzle fails on the JSON column, or it maps the row to nothing
      // like it. Both are the defect; neither may pass for the real row.
      const outcome = await objectRows.select().from(sample).orderBy(sample.id).all()
        .then((rows) => rows[0], (error: unknown) => error);
      expect(outcome).not.toEqual({ id: 1, name: 'W1AW', active: true, detail: { band: '20m', modes: ['CW', 'FT8'] } });
    } finally { s.close(); }
  });
});

describe('P4-units-of-work: one request at a time on a connection (QGD-ENG-0020)', () => {
  const pause = () => new Promise((settle) => setTimeout(settle, 20));

  async function interleave(useQueue: boolean): Promise<string[]> {
    const s = await openState(layout(root), MIGRATIONS, 'x');
    try {
      const write = (key: string) => (db: Parameters<Parameters<typeof s.unit>[0]>[0]) =>
        db.insert(extensionState).values({ extensionId: 'test-extension', key, value: key, updatedAt: 'now' });
      // A transaction that writes, waits, and then fails, so it rolls back.
      const failing = async (db: Parameters<Parameters<typeof s.unit>[0]>[0]) => {
        await db.transaction(async (tx) => {
          await write('rolled-back')(tx as never);
          await pause();
          throw new Error('planted');
        });
      };
      // An unrelated request that arrives while the transaction is paused.
      const unrelated = async (db: Parameters<Parameters<typeof s.unit>[0]>[0]) => { await write('unrelated')(db); };
      if (useQueue) {
        const first = s.unit(failing).catch(() => undefined);
        await new Promise((settle) => setTimeout(settle, 5));
        await Promise.all([first, s.unit(unrelated)]);
      } else {
        // The control: the same two requests without the queue, sharing the
        // connection directly, as Drizzle's proxy would let them.
        let db!: Parameters<Parameters<typeof s.unit>[0]>[0];
        await s.unit((handle) => { db = handle; });
        const first = failing(db).catch(() => undefined);
        await new Promise((settle) => setTimeout(settle, 5));
        await Promise.all([first, unrelated(db)]);
      }
      const rows = await s.unit((db) => db.select({ key: extensionState.key }).from(extensionState).all());
      return rows.map((row) => row.key).sort();
    } finally { s.close(); }
  }

  it('keeps an unrelated request out of another\'s transaction', async () => {
    expect(await interleave(true)).toEqual(['unrelated']);
  });

  it('control: without the queue the unrelated write is rolled back with it', async () => {
    expect(await interleave(false)).toEqual([]);
  });

  it('runs the next unit after one that failed', async () => {
    const queue = new UnitQueue();
    const order: string[] = [];
    const first = queue.run(async () => { order.push('first'); throw new Error('x'); }).catch(() => undefined);
    const second = queue.run(() => { order.push('second'); });
    await Promise.all([first, second]);
    expect(order).toEqual(['first', 'second']);
  });
});

describe('P4-errors: a storage error carries no value (QGD-ENG-0016)', () => {
  it('reduces a failed statement to a kind, a code and SQLite\'s own string', async () => {
    const s = await openState(layout(root), MIGRATIONS, 'x');
    try {
      await s.unit((db) => db.insert(extensionState).values({ extensionId: 'test-extension', key: 'k', value: SENTINEL, updatedAt: 'now' }));
      // The same primary key again: a constraint failure, with the sentinel bound.
      const error = await caught(() =>
        s.unit((db) => db.insert(extensionState).values({ extensionId: 'test-extension', key: 'k', value: SENTINEL, updatedAt: SENTINEL })));
      expect(error).toBeInstanceOf(StorageFailure);
      const reduced = (error as StorageFailure).reduced;
      expect(reduced.kind).toBe('query');
      expect(typeof reduced.code).toBe('number');
      for (const text of [String(error), (error as Error).message, (error as Error).stack ?? '',
        JSON.stringify(reduced), describeError(reduced)]) {
        expect(text).not.toContain(SENTINEL);
      }
    } finally { s.close(); }
  });

  it('keeps nothing a caller hands in: no text survives, only a known code and its name', () => {
    const fromSqlite = reduce({ errcode: 19, errstr: `secret ${SENTINEL} password` }, 'query');
    expect(fromSqlite).toEqual({ kind: 'query', code: 19, sqlite: 'SQLITE_CONSTRAINT' });
    expect(Object.isFrozen(fromSqlite)).toBe(true);
    // An extended code reduces to its primary code.
    expect(reduce({ errcode: 2067 }, 'query')).toEqual({ kind: 'query', code: 19, sqlite: 'SQLITE_CONSTRAINT' });
    const handed = new StorageFailure({ kind: 'query', code: 'nineteen', sqlite: SENTINEL } as never);
    expect(JSON.stringify(handed.reduced) + handed.message).not.toContain(SENTINEL);
    expect(new StorageFailure({ kind: SENTINEL } as never).reduced.kind).toBe('internal');
    // And a failure already reduced is not a way to smuggle text either.
    const wrapped = Object.assign(new Error(SENTINEL), { cause: handed });
    expect(JSON.stringify(reduce(wrapped))).not.toContain(SENTINEL);
  });

  it('reduces a filesystem failure on open, too', async () => {
    const error = await caught(() => openStore(root));
    expect(error).toBeInstanceOf(StorageFailure);
    expect(String(error)).not.toContain(root);
  });

  it('control: Drizzle\'s own error does carry the bound value', async () => {
    // Why the reduction exists. A plain Drizzle error over the same connection
    // names every parameter in its message.
    const s = await openState(layout(root), MIGRATIONS, 'x');
    try {
      const raw = drizzle(async (query, params) => {
        s.connection.prepare(query).run(...(params as never[]));
        return { rows: [] };
      });
      await raw.insert(extensionState).values({ extensionId: 'a1', key: 'k', value: 'v', updatedAt: 'now' });
      const error = await caught(() => raw.insert(extensionState).values({ extensionId: 'a1', key: 'k', value: SENTINEL, updatedAt: 'now' }));
      expect(String((error as Error).message)).toContain(SENTINEL);
      // And the reduction removes it.
      expect(JSON.stringify(reduce(error, 'query'))).not.toContain(SENTINEL);
    } finally { s.close(); }
  });
});

describe('P4-app-folder: each application\'s data is a folder the core owns (QGD-ENG-0018)', () => {
  it('creates extensions/<id>/ for an identifier a manifest may carry', () => {
    const paths = layout(root);
    const folder = extensionFolder(paths, 'qg-adif', { create: true });
    expect(folder).toBe(join(paths.extensions, 'qg-adif'));
    expect(existsSync(folder)).toBe(true);
  });

  it('refuses an identifier that would leave extensions/', () => {
    const paths = layout(root);
    for (const id of ['../escape', '..', 'a/b', 'A-Upper', '', 'x', '/abs', 'qg adif', 'qg-adif/..']) {
      expect(() => extensionFolder(paths, id, { create: true }), id).toThrow(StorageFailure);
    }
    expect(existsSync(join(root, 'escape'))).toBe(false);
  });

  it('refuses a folder that a planted link points elsewhere', () => {
    const paths = layout(root);
    mkdirSync(paths.extensions, { recursive: true });
    const elsewhere = mkdtempSync(join(tmpdir(), 'qg-elsewhere-'));
    try {
      symlinkSync(elsewhere, join(paths.extensions, 'qg-club'));
      expect(() => extensionFolder(paths, 'qg-club', { create: true })).toThrow(StorageFailure);
    } finally { rmSync(elsewhere, { recursive: true, force: true }); }
  });

  it('refuses an extensions/ that is itself a link, with or without creating', () => {
    const paths = layout(root);
    const elsewhere = mkdtempSync(join(tmpdir(), 'qg-elsewhere-'));
    try {
      mkdirSync(join(elsewhere, 'qg-club'));
      symlinkSync(elsewhere, paths.extensions);
      expect(() => extensionFolder(paths, 'qg-club', { create: true })).toThrow(StorageFailure);
      expect(() => extensionFolder(paths, 'qg-club')).toThrow(StorageFailure);
      expect(() => removeExtensionFolder(paths, 'qg-club')).toThrow(StorageFailure);
      expect(existsSync(join(elsewhere, 'qg-club')), 'nothing outside was removed').toBe(true);
    } finally { rmSync(elsewhere, { recursive: true, force: true }); }
  });

  it('refuses an existing application folder that is a link, and will not remove through it', () => {
    const paths = layout(root);
    mkdirSync(paths.extensions, { recursive: true });
    const elsewhere = mkdtempSync(join(tmpdir(), 'qg-elsewhere-'));
    try {
      writeFileSync(join(elsewhere, 'precious'), 'keep');
      symlinkSync(elsewhere, join(paths.extensions, 'qg-net'));
      expect(() => extensionFolder(paths, 'qg-net')).toThrow(StorageFailure);
      expect(() => removeExtensionFolder(paths, 'qg-net')).toThrow(StorageFailure);
      expect(readFileSync(join(elsewhere, 'precious'), 'utf8')).toBe('keep');
    } finally { rmSync(elsewhere, { recursive: true, force: true }); }
  });

  it('removes the folder with the application', () => {
    const paths = layout(root);
    const folder = extensionFolder(paths, 'qg-editor', { create: true });
    writeFileSync(join(folder, 'data.sqlite'), '');
    removeExtensionFolder(paths, 'qg-editor');
    expect(existsSync(folder)).toBe(false);
  });
});

describe('P4-sorting: callsigns in SQL, names in the operator\'s language (QGD-ENG-0019)', () => {
  it('orders callsigns under BINARY: digits before letters, W1AW before W1AW/4', async () => {
    const s = openStore(join(root, 'sort.sqlite'));
    try {
      s.connection.exec('CREATE TABLE calls (call TEXT)');
      for (const call of ['W1AW/4', 'K7RA', '4X1AB', 'W1AW', '9A1A']) {
        await s.unit((db) => db.run(sql`INSERT INTO calls VALUES (${call})`));
      }
      const rows = await s.unit((db) => db.values<[string]>(sql`SELECT call FROM calls ORDER BY call`));
      expect(rows.map((row) => row[0])).toEqual(['4X1AB', '9A1A', 'K7RA', 'W1AW', 'W1AW/4']);
    } finally { s.close(); }
  });

  it('orders names by the operator\'s locale, which differs by language', () => {
    const names = ['Zulu', 'Ångström', 'Alpha'];
    expect([...names].sort(new Intl.Collator('en').compare)).toEqual(['Alpha', 'Ångström', 'Zulu']);
    expect([...names].sort(new Intl.Collator('sv').compare)).toEqual(['Alpha', 'Zulu', 'Ångström']);
  });
});
