// SPDX-License-Identifier: GPL-3.0-only
// reference.sqlite: built, checked, swapped and refreshed (docs/P5.md,
// re-registered 2026-10-10). P5-loads, P5-not-loaded, P5-partial,
// P5-build-checks, P5-build-fails-safe, P5-swap, P5-reconcile,
// P5-pota-freshness, P5-mixed-refresh, P5-pota-cache-crash,
// P5-pota-cache-cleanup, P5-answers-during-build and P5-errors-kept-path.
//
// The data is ADIF's real archive and POTA's real lists, from `make setup`. The
// park list is cut to its first 3,000 rows so each build takes a fraction of a
// second. What a full list does is the pota-load suite's business. Like the
// reader suite, this one is skipped when the vendor directory is missing.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sql } from 'drizzle-orm';
import { generateSQLiteDrizzleJson, generateSQLiteMigration } from 'drizzle-kit/api';
import type { Fetched } from '../packages/reference/fetch.js';
import { StorageFailure } from '../packages/storage/errors.js';
import { layout, openState } from '../packages/storage/layout.js';
import { buildReference, referenceDdl } from '../packages/storage/reference-build.js';
import { POTA_LISTS, commit, potaDirectory, readRecord } from '../packages/storage/reference-cache.js';
import * as referenceSchema from '../packages/storage/reference-schema.js';
import { Reference, workerBuild, type RunBuild } from '../packages/storage/reference.js';
import { readReferenceRuleset } from '../packages/storage/reference-read.js';
import { openStore } from '../packages/storage/sqlite.js';
import { referenceRefresh } from '../packages/storage/schema.js';

const register = JSON.parse(readFileSync('data/reference-sources.json', 'utf8'));
const DDL = resolve('drizzle/reference');
const STATE = resolve('drizzle/state');
const archivePath = `vendor/.cache/adif-${register.adif.version}.zip`;
const have = existsSync(archivePath) && existsSync('vendor/pota/parks.csv');
const withData = have ? describe : describe.skip;
const SENTINEL = 'QGD-SENTINEL-77ad01';

const archive = have ? readFileSync(archivePath) : Buffer.alloc(0);
const PARKS = have ? readFileSync('vendor/pota/parks.csv', 'utf8').split('\n').slice(0, 3001).join('\n') + '\n' : '';
const BODIES: Record<string, string> = have ? {
  [register.pota.sources.parks.url]: PARKS,
  [register.pota.sources.programs.url]: readFileSync('vendor/pota/programs.json', 'utf8'),
  [register.pota.sources.locations.url]: readFileSync('vendor/pota/locations.json', 'utf8')
} : {};

// POTA, as a server that answers conditionally: its ETag is the body's hash.
function pota(bodies: Record<string, string> = BODIES, failing: string[] = [], calls: string[] = []) {
  return async (url: string, conditional: { etag?: string | null }): Promise<Fetched> => {
    calls.push(url);
    if (failing.includes(url)) throw new Error(`refused ${SENTINEL}`);
    const body = bodies[url];
    const etag = createHash('sha256').update(body).digest('hex');
    if (conditional.etag === etag) return { status: 'unchanged' };
    return { status: 'fresh', body, etag, lastModified: 'Sat, 10 Oct 2026 00:00:00 GMT' };
  };
}
const adifOnline = async () => archive;
const offline = async (): Promise<Buffer> => { throw new Error(`offline ${SENTINEL}`); };
const inline: RunBuild = (target, ddl, inputs) => buildReference(target, ddl, inputs);

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'qg-reference-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

let clock = Date.parse('2026-10-10T12:00:00Z');
async function reference(options: Partial<ConstructorParameters<typeof Reference>[0]> = {}) {
  const paths = layout(root);
  const state = await openState(paths, STATE, 'test');
  const ref = new Reference({
    paths, ddl: DDL, register, state, fetchArchive: adifOnline, fetchText: pota(),
    now: () => new Date(clock), build: inline, ...options
  });
  return { paths, state, ref, done: () => { ref.close(); state.close(); } };
}
const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

// The DDL each schema version was rendered to. A change to reference-schema.ts
// changes the DDL, and this test then fails until REFERENCE_SCHEMA_VERSION is
// raised and the new fingerprint recorded here. Without that, a file of the old
// shape would pass the version check and fail on its first read.
const DDL_BY_VERSION: Record<number, string> = {
  2: 'a62e6f5fd8824c3583e8cf88439b98361b66bca6f4d0d4b904c095a8b94e8820'
};

describe('P5-loads: the schema rendered from its declaration (QGD-ENG-0015)', () => {
  it('a change to the DDL raises the schema version', () => {
    const fingerprint = createHash('sha256')
      .update(referenceDdl(DDL).map((s) => s.replace(/\s+/g, ' ').trim()).sort().join('\n')).digest('hex');
    expect(DDL_BY_VERSION[referenceSchema.REFERENCE_SCHEMA_VERSION],
      'the schema changed: raise REFERENCE_SCHEMA_VERSION and record the new fingerprint').toBe(fingerprint);
  });

  it('the shipped DDL is exactly what the declaration renders', async () => {
    const rendered = await generateSQLiteMigration(await generateSQLiteDrizzleJson({}),
      await generateSQLiteDrizzleJson({ ...referenceSchema }));
    const normal = (statements: string[]) => statements.map((s) => s.replace(/\s+/g, ' ').trim()).sort();
    expect(normal(referenceDdl(DDL))).toEqual(normal(rendered));
  });
});

withData('reference.sqlite, end to end', () => {
  it('P5-loads: a first refresh builds the file from every source', async () => {
    const { paths, ref, done } = await reference();
    try {
      const outcome = await ref.refresh();
      expect(outcome.built).toBe(true);
      expect(outcome.status.adif).toMatchObject({ state: 'loaded', version: register.adif.version });
      for (const list of POTA_LISTS) expect(outcome.status.pota[list].state).toBe('loaded');
      expect(outcome.summary?.pota.parks).toBe(3000);
      expect(existsSync(paths.reference)).toBe(true);
    } finally { done(); }
  });

  it('P5-not-loaded: offline with nothing cached reaches a working state with no file', async () => {
    const { paths, state, ref, done } = await reference({ fetchArchive: offline, fetchText: pota(BODIES, Object.keys(BODIES)) });
    try {
      const outcome = await ref.refresh();
      expect(outcome.built).toBe(false);
      expect(outcome.adif.state).toBe('kept');
      expect(outcome.status.adif.state).toBe('not loaded');
      for (const list of POTA_LISTS) expect(outcome.status.pota[list].state).toBe('not loaded');
      expect(existsSync(paths.reference)).toBe(false);
      const rows = await state.unit((db) => db.select().from(referenceRefresh).all());
      expect(rows.find((row) => row.sourceId === 'adif')?.lastFailure).toBe('fetch');
    } finally { done(); }
  });

  it('P5-partial: ADIF without POTA publishes', async () => {
    const { ref, done } = await reference({ fetchText: pota(BODIES, Object.keys(BODIES)) });
    try {
      const outcome = await ref.refresh();
      expect(outcome.built).toBe(true);
      expect(outcome.status.adif.state).toBe('loaded');
      for (const list of POTA_LISTS) expect(outcome.status.pota[list].state).toBe('not loaded');
    } finally { done(); }
  });

  it('P5-partial: POTA without ADIF publishes, with every ADIF link empty', async () => {
    const { ref, done } = await reference({ fetchArchive: offline });
    try {
      const outcome = await ref.refresh();
      expect(outcome.built).toBe(true);
      expect(outcome.status.adif.state).toBe('not loaded');
      expect(outcome.status.pota.parks.state).toBe('loaded');
      const linked = await ref.reader()!.unit((db) =>
        db.values<[number]>(sql`SELECT count(*) FROM pota_park WHERE adif_entity IS NOT NULL`));
      expect(linked[0][0]).toBe(0);
    } finally { done(); }
  });

  it('P5-partial: without ADIF, the ruleset answers not loaded instead of throwing', async () => {
    const { ref, done } = await reference({ fetchArchive: offline });
    try {
      await ref.refresh();
      expect(await readReferenceRuleset(ref.reader())).toBe('not loaded');
      expect(await readReferenceRuleset(undefined)).toBe('not loaded');
    } finally { done(); }
  });

  it('control: with ADIF, the ruleset reads back and parks are linked', async () => {
    const { ref, done } = await reference();
    try {
      const outcome = await ref.refresh();
      const ruleset = await readReferenceRuleset(ref.reader());
      expect(ruleset).not.toBe('not loaded');
      if (ruleset !== 'not loaded') {
        expect(ruleset.version).toBe(register.adif.version);
        expect(ruleset.fields.size).toBe(outcome.summary?.adif?.fields);
        expect(ruleset.fields.get('CREDIT_GRANTED')?.dataTypes.length).toBeGreaterThan(1);
      }
      expect(outcome.summary?.adifLinked).toBeGreaterThan(0);
    } finally { done(); }
  });

  it('control: with ADIF, parks are linked', async () => {
    const { ref, done } = await reference();
    try {
      const outcome = await ref.refresh();
      expect(outcome.summary?.adifLinked).toBeGreaterThan(0);
    } finally { done(); }
  });
});

withData('P5-build-checks: a file is checked before it may be published (QGD-ENG-0015)', () => {
  async function inputs() {
    const { ref, paths, done } = await reference();
    await ref.refresh();
    done();
    const { openArchive } = await import('../packages/reference/fetch.js');
    const opened = await openArchive(register.adif, paths.referenceCache, offline);
    const pota = Object.fromEntries(POTA_LISTS.map((list) => {
      const record = readRecord(paths.referenceCache, list)!;
      return [list, { record, body: readFileSync(join(potaDirectory(paths.referenceCache), `${record.sha256}.body`), 'utf8') }];
    }));
    return { register, adif: { definitions: opened.definitions, fetchedAt: '2026-10-10T00:00:00.000Z' }, pota };
  }

  it('refuses an orphaned foreign key that integrity_check alone passes', async () => {
    const target = join(root, 'planted.sqlite');
    let integrity = '';
    const error = await buildReference(target, DDL, await inputs(), {
      beforeChecks: (store) => {
        store.connection.exec('PRAGMA foreign_keys = OFF');
        store.connection.exec("INSERT INTO enumeration_value VALUES ('No_Such_Enumeration', 'X', '{}', 0, 0)");
        integrity = (store.connection.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check;
      }
    }).then(() => undefined, (e: unknown) => e);
    expect(integrity, 'the planted defect is one integrity_check does not see').toBe('ok');
    expect(error).toBeInstanceOf(StorageFailure);
    expect(existsSync(target), 'a refused build leaves no file').toBe(false);
  });

  it('refuses a count that does not match what was read', async () => {
    const target = join(root, 'short.sqlite');
    const error = await buildReference(target, DDL, await inputs(), {
      beforeChecks: (store) => { store.connection.exec("DELETE FROM pota_program WHERE rowid IN (SELECT rowid FROM pota_program LIMIT 1)"); }
    }).then(() => undefined, (e: unknown) => e);
    expect(error).toBeInstanceOf(StorageFailure);
  });

  it('control: the same inputs with nothing planted build', async () => {
    const summary = await buildReference(join(root, 'clean.sqlite'), DDL, await inputs());
    expect(summary.adif?.fields).toBeGreaterThan(0);
  });
});

withData('P5-build-fails-safe and P5-swap (QGD-ENG-0015)', () => {
  it('a build that throws leaves the live file exactly as it was', async () => {
    const first = await reference();
    await first.ref.refresh();
    first.done();
    const before = hash(first.paths.reference);
    clock += 25 * 3600 * 1000;
    const failing: RunBuild = async () => { throw new Error(`build ${SENTINEL}`); };
    // A real change, so a build is needed: the park list a few rows shorter.
    const changed = { ...BODIES, [register.pota.sources.parks.url]: PARKS.split('\n').slice(0, 2801).join('\n') + '\n' };
    const second = await reference({ build: failing, fetchText: pota(changed) });
    try {
      const outcome = await second.ref.refresh();
      expect(outcome.built).toBe(false);
      expect(outcome.buildFailure?.kind).toBe('build');
      expect(JSON.stringify(outcome)).not.toContain(SENTINEL);
      expect(hash(second.paths.reference)).toBe(before);
      expect(readdirSync(root).filter((name) => name.includes('.building'))).toEqual([]);
    } finally { second.done(); }
  });

  it('an archive whose hash does not match is refused, and the live file stands', async () => {
    const first = await reference();
    await first.ref.refresh();
    first.done();
    const before = hash(first.paths.reference);
    rmSync(join(first.paths.referenceCache, `adif-${register.adif.version}.zip`));
    const second = await reference({ fetchArchive: async () => Buffer.from('not the archive') });
    try {
      // Forced, so POTA is asked again too: the build that follows must still
      // not publish a file without the ADIF the live one holds.
      const outcome = await second.ref.refresh({ force: true });
      expect(outcome.adif.state).toBe('kept');
      expect(outcome.deferred).toBe(true);
      expect(hash(second.paths.reference)).toBe(before);
      expect((await second.ref.status()).adif.state).toBe('loaded');
    } finally { second.done(); }
  });

  it('a worker that dies without answering is a failed build, not a hang', async () => {
    const dying = join(root, 'dying-worker.mjs');
    writeFileSync(dying, 'process.exit(3);\n');
    const run = workerBuild(pathToFileURL(dying));
    const error = await run(join(root, 'x.sqlite'), DDL, { register, pota: {} }).then(() => undefined, (e: unknown) => e);
    expect(error).toBeInstanceOf(StorageFailure);
  });

  it('the published file has no journal beside it, and opens read-only', async () => {
    const { paths, ref, done } = await reference();
    try {
      await ref.refresh();
      for (const side of ['-wal', '-shm', '-journal']) expect(existsSync(`${paths.reference}${side}`), side).toBe(false);
      expect(readdirSync(root).filter((name) => name.includes('.building'))).toEqual([]);
      const reader = ref.reader()!;
      expect(reader.readOnly).toBe(true);
      const error = await reader.unit((db) => db.run(sql`DELETE FROM pota_park`)).then(() => undefined, (e: unknown) => e);
      expect((error as StorageFailure).reduced.code).toBe(8); // SQLITE_READONLY
    } finally { done(); }
  });
});

withData('defects found in review, each held by a test', () => {
  const later = () => { clock += 25 * 3600 * 1000; };

  it('a file of another schema version still counts: a rebuild that would drop its POTA is deferred', async () => {
    const first = await reference();
    await first.ref.refresh();
    first.done();
    const writable = openStore(first.paths.reference, { journal: 'delete' });
    writable.connection.exec('PRAGMA user_version = 99');
    writable.close();
    rmSync(potaDirectory(first.paths.referenceCache), { recursive: true, force: true });
    const before = hash(first.paths.reference);
    later();
    const second = await reference({ fetchText: pota(BODIES, Object.keys(BODIES)) });
    try {
      const outcome = await second.ref.refresh();
      expect(outcome.deferred).toBe(true);
      expect(hash(second.paths.reference)).toBe(before);
    } finally { second.done(); }
  });

  it('a file of an older schema version is rebuilt, not read', async () => {
    const first = await reference();
    await first.ref.refresh();
    first.done();
    // The shape the first version had: no content_sha256, version 1.
    const old = openStore(first.paths.reference, { journal: 'delete' });
    old.connection.exec('ALTER TABLE source DROP COLUMN content_sha256');
    old.connection.exec('PRAGMA user_version = 1');
    old.close();
    const second = await reference();
    try {
      expect((await second.ref.status()).adif.state, 'an older file is not read').toBe('not loaded');
      const outcome = await second.ref.refresh();
      expect(outcome.built).toBe(true);
      expect(outcome.status.adif.state).toBe('loaded');
      expect(outcome.status.pota.parks.state).toBe('loaded');
    } finally { second.done(); }
  });

  it('refreshes run one at a time: two builds never overlap', async () => {
    const spans: [number, number][] = [];
    const slow: RunBuild = async (target, ddl, inputs) => {
      const began = Date.now();
      await new Promise((settle) => setTimeout(settle, 60));
      const summary = await buildReference(target, ddl, inputs);
      spans.push([began, Date.now()]);
      return summary;
    };
    let bodies = BODIES;
    // The park list changes once the first refresh has read it, not after a
    // guessed delay: on a slow runner the first refresh had not fetched yet
    // after 10 ms, read the changed list itself, and left the second nothing
    // to build.
    let parksRead: () => void = () => {};
    const firstReadParks = new Promise<void>((settle) => { parksRead = settle; });
    const parksUrl = register.pota.sources.parks.url;
    const { ref, paths, done } = await reference({ build: slow, fetchText: (url, c) => {
      const answer = pota(bodies)(url, c);
      if (url === parksUrl) parksRead();
      return answer;
    } });
    try {
      const first = ref.refresh();
      // Asked while the first is still building (it waits 60 ms before it
      // builds), with a park list that has changed, so the second must build too.
      await firstReadParks;
      bodies = { ...BODIES, [register.pota.sources.parks.url]: PARKS.split('\n').slice(0, 2701).join('\n') + '\n' };
      const second = ref.refresh({ force: true });
      const [a, b] = await Promise.all([first, second]);
      // Why a build did not happen, if one did not: reduced errors and input
      // states only, so nothing here can carry a value (QGD-ENG-0016).
      const why = (o: typeof a) => JSON.stringify({ deferred: o.deferred, failure: o.buildFailure, adif: o.adif, pota: o.pota });
      expect([a.built, b.built], `first ${why(a)}; second ${why(b)}`).toEqual([true, true]);
      expect(spans.length, 'two builds happened').toBe(2);
      expect(spans[1][0], 'the second began after the first ended').toBeGreaterThanOrEqual(spans[0][1]);
      expect(b.status.pota.parks).toMatchObject({ rows: 2700 });
      const check = openStore(paths.reference, { readOnly: true });
      try { expect((check.connection.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check).toBe('ok'); }
      finally { check.close(); }
    } finally { done(); }
  });

  it('a lost cache record does not switch off the truncation check: the live count stands in', async () => {
    const first = await reference();
    await first.ref.refresh();
    first.done();
    rmSync(join(potaDirectory(first.paths.referenceCache), 'parks.json'));
    const before = hash(first.paths.reference);
    later();
    const tiny = { ...BODIES, [register.pota.sources.parks.url]: PARKS.split('\n').slice(0, 3).join('\n') + '\n' };
    const second = await reference({ fetchText: pota(tiny) });
    try {
      const outcome = await second.ref.refresh({ force: true });
      expect(outcome.pota.parks).toEqual({ state: 'kept', failure: { kind: 'shape' } });
      expect(hash(second.paths.reference)).toBe(before);
    } finally { second.done(); }
  });

  it('a list repeating an id is refused before it can replace the cached one', async () => {
    const first = await reference();
    await first.ref.refresh();
    const record = readRecord(first.paths.referenceCache, 'programs');
    first.done();
    later();
    const programs = JSON.parse(BODIES[register.pota.sources.programs.url]) as unknown[];
    const repeated = { ...BODIES, [register.pota.sources.programs.url]: JSON.stringify([...programs, programs[0]]) };
    const second = await reference({ fetchText: pota(repeated) });
    try {
      const outcome = await second.ref.refresh({ force: true });
      expect(outcome.pota.programs).toEqual({ state: 'kept', failure: { kind: 'shape' } });
      expect(readRecord(second.paths.referenceCache, 'programs')).toEqual(record);
    } finally { second.done(); }
  });

  it('a corrupt cached body is fetched again unconditionally, and repaired', async () => {
    const calls: string[] = [];
    const conditionals: (string | null | undefined)[] = [];
    const first = await reference();
    await first.ref.refresh();
    first.done();
    const record = readRecord(layout(root).referenceCache, 'parks')!;
    writeFileSync(join(potaDirectory(layout(root).referenceCache), `${record.sha256}.body`), 'damaged');
    const watching = pota(BODIES, [], calls);
    const second = await reference({ fetchText: (url, conditional) => { conditionals.push(conditional.etag); return watching(url, conditional); } });
    try {
      // Within the day: a usable record would be "fresh enough". This one is not usable.
      const outcome = await second.ref.refresh();
      expect(outcome.pota.parks.state).toBe('loaded');
      expect(conditionals[calls.indexOf(register.pota.sources.parks.url)], 'asked without validators').toBeNull();
      const repaired = readRecord(second.paths.referenceCache, 'parks')!;
      expect(readFileSync(join(potaDirectory(second.paths.referenceCache), `${repaired.sha256}.body`), 'utf8')).toBe(PARKS);
    } finally { second.done(); }
  });

  it('a swap that fails is not reported as built', async () => {
    const { ref, paths, done } = await reference({ hooks: { beforeSwap: () => { throw new Error(`swap ${SENTINEL}`); } } });
    try {
      const outcome = await ref.refresh();
      expect(outcome.built).toBe(false);
      expect(outcome.summary).toBeUndefined();
      expect(outcome.buildFailure?.kind).toBe('build');
      expect(existsSync(paths.reference)).toBe(false);
      expect(JSON.stringify(outcome)).not.toContain(SENTINEL);
    } finally { done(); }
  });

  it('a live file that cannot be read fails reduced, naming no path', async () => {
    const { ref, paths, done } = await reference();
    try {
      // A directory where the file should be: stat works, reading does not.
      mkdirSync(join(paths.reference, 'inside'), { recursive: true });
      const error = await ref.status().then(() => undefined, (e: unknown) => e);
      expect(error).toBeInstanceOf(StorageFailure);
      expect(String(error)).not.toContain(root);
    } finally { done(); }
  });
});

withData('P5-reconcile: the file is the record of what is loaded (QGD-ENG-0015.1)', () => {
  it('a crash between the swap and the outcome is read correctly from the file', async () => {
    const first = await reference({ hooks: { afterSwap: () => { throw new Error('crash after swap'); } } });
    await first.ref.refresh().catch(() => undefined);
    first.done();
    const next = await reference();
    try {
      const status = await next.ref.status();
      expect(status.adif.state).toBe('loaded');
      expect(status.pota.parks.state).toBe('loaded');
      expect(status.pota.parks).toMatchObject({ fetchedAt: new Date(clock).toISOString() });
    } finally { next.done(); }
  });
});

withData('POTA refreshes (QGD-REF-0010)', () => {
  it('P5-pota-freshness: within the day nothing is asked; after it, a 304 rebuilds nothing', async () => {
    const calls: string[] = [];
    const first = await reference({ fetchText: pota(BODIES, [], calls) });
    await first.ref.refresh();
    first.done();
    expect(calls.length).toBe(3);

    clock += 3600 * 1000;
    const second = await reference({ fetchText: pota(BODIES, [], calls) });
    const fresh = await second.ref.refresh();
    second.done();
    expect(calls.length, 'nothing asked again within the day').toBe(3);
    for (const list of POTA_LISTS) expect(fresh.pota[list].state).toBe('fresh enough');

    clock += 25 * 3600 * 1000;
    const third = await reference({ fetchText: pota(BODIES, [], calls) });
    try {
      const before = hash(third.paths.reference);
      const answered = await third.ref.refresh();
      expect(calls.length).toBe(6);
      for (const list of POTA_LISTS) expect(answered.pota[list].state).toBe('unchanged');
      expect(answered.built).toBe(false);
      expect(hash(third.paths.reference)).toBe(before);
      const row = await third.state.unit((db) => db.select().from(referenceRefresh).all());
      expect(row.find((r) => r.sourceId === 'pota-parks')?.lastCheck).toBe(new Date(clock).toISOString());
    } finally { third.done(); }
  });

  it('P5-mixed-refresh: a new list and a failed list each keep their own provenance', async () => {
    const first = await reference();
    await first.ref.refresh();
    const before = await first.ref.status();
    first.done();
    clock += 25 * 3600 * 1000;
    const newParks = PARKS.split('\n').slice(0, 2501).join('\n') + '\n';
    const bodies = { ...BODIES, [register.pota.sources.parks.url]: newParks };
    const second = await reference({ fetchText: pota(bodies, [register.pota.sources.programs.url]) });
    try {
      const outcome = await second.ref.refresh({ force: true });
      expect(outcome.pota.parks.state).toBe('loaded');
      expect(outcome.pota.programs.state).toBe('kept');
      expect(outcome.built).toBe(true);
      expect(outcome.status.pota.parks).toMatchObject({ state: 'loaded', rows: 2500, fetchedAt: new Date(clock).toISOString() });
      expect(outcome.status.pota.programs).toEqual(before.pota.programs);
    } finally { second.done(); }
  });

  it('P5-pota-cache-crash: a crash before the record is renamed leaves the previous pair', async () => {
    const first = await reference();
    await first.ref.refresh();
    const before = readRecord(first.paths.referenceCache, 'parks')!;
    first.done();
    expect(() => commit(layout(root).referenceCache, { ...before, fetchedAt: '2026-10-11T00:00:00.000Z', rowCount: 1 },
      'reference,name\nX,Y\n', { beforeRecordRename: () => { throw new Error('crash'); } })).toThrow();
    expect(readRecord(layout(root).referenceCache, 'parks')).toEqual(before);
    clock += 25 * 3600 * 1000;
    const next = await reference({ fetchText: pota(BODIES, Object.keys(BODIES)) });
    try {
      const outcome = await next.ref.refresh({ force: true });
      expect(outcome.status.pota.parks).toMatchObject({ state: 'loaded', fetchedAt: before.fetchedAt, rows: before.rowCount });
    } finally { next.done(); }
  });

  it('P5-pota-cache-cleanup: after days of changed lists, one body per list remains', async () => {
    for (let day = 0; day < 4; day += 1) {
      clock += 25 * 3600 * 1000;
      const parks = PARKS.split('\n').slice(0, 2900 + day * 10).join('\n') + '\n';
      const run = await reference({ fetchText: pota({ ...BODIES, [register.pota.sources.parks.url]: parks }) });
      await run.ref.refresh({ force: true });
      run.done();
    }
    const bodies = readdirSync(potaDirectory(layout(root).referenceCache)).filter((name) => name.endsWith('.body'));
    expect(bodies.length).toBe(3);
  });

  it('a source not asked at all is kept as pending, distinct from a request that failed', async () => {
    // Pending is what QG Storage retries soon; fetch waits for the daily rule
    // (QGD-REF-0010), because that request did reach a server.
    const notReady = async (): Promise<never> => { throw new StorageFailure({ kind: 'pending' }); };
    const { ref, done } = await reference({ fetchArchive: notReady, fetchText: notReady });
    try {
      const outcome = await ref.refresh();
      expect(outcome.adif).toEqual({ state: 'kept', failure: { kind: 'pending' } });
      for (const list of POTA_LISTS) expect(outcome.pota[list]).toEqual({ state: 'kept', failure: { kind: 'pending' } });
    } finally { done(); }
    const failing = await reference({ fetchArchive: offline, fetchText: pota(BODIES, Object.keys(BODIES)) });
    try {
      const outcome = await failing.ref.refresh();
      expect(outcome.adif).toEqual({ state: 'kept', failure: { kind: 'fetch' } });
      expect(outcome.pota.parks).toEqual({ state: 'kept', failure: { kind: 'fetch' } });
    } finally { failing.done(); }
  });

  it('P5-errors-kept-path: a failure that is caught and kept carries no value (QGD-ENG-0016)', async () => {
    const first = await reference();
    await first.ref.refresh();
    first.done();
    clock += 25 * 3600 * 1000;
    // A body whose shape is wrong, carrying the sentinel, so a ShapeError's
    // text would quote it if it were let through.
    const bad = { ...BODIES, [register.pota.sources.programs.url]: `{"not":"${SENTINEL}"}` };
    const second = await reference({ fetchArchive: offline, fetchText: pota(bad, [register.pota.sources.locations.url]) });
    try {
      const outcome = await second.ref.refresh({ force: true });
      expect(outcome.pota.programs).toMatchObject({ state: 'kept', failure: { kind: 'shape' } });
      expect(outcome.pota.locations).toMatchObject({ state: 'kept', failure: { kind: 'fetch' } });
      expect(JSON.stringify(outcome)).not.toContain(SENTINEL);
      const rows = await second.state.unit((db) => db.select().from(referenceRefresh).all());
      expect(JSON.stringify(rows)).not.toContain(SENTINEL);
    } finally { second.done(); }
  });
});

withData('P5-answers-during-build: QG Storage keeps answering (QGD-ENG-0015)', () => {
  const worker = resolve('dist/storage/reference-worker.js');
  const built = existsSync(worker) ? it : it.skip;
  built('a build on the worker does not hold a request on the state store', async () => {
    const { ref, state, done } = await reference({ build: workerBuild(pathToFileURL(worker)), fetchText: pota({
      ...BODIES, [register.pota.sources.parks.url]: readFileSync('vendor/pota/parks.csv', 'utf8')
    }) });
    try {
      const refreshing = ref.refresh().then(() => Date.now());
      await new Promise((settle) => setTimeout(settle, 50));
      const answered = await state.unit((db) => db.values(sql`SELECT 1`)).then(() => Date.now());
      const finished = await refreshing;
      expect(answered).toBeLessThan(finished);
    } finally { done(); }
    // The whole park list, on purpose: the build has to be long enough to be
    // caught in the middle of. Seconds on a workstation, more on a CI runner.
  }, 60_000);
});
