// SPDX-License-Identifier: GPL-3.0-only
// Keeping reference.sqlite current, as QG Storage does at start and on refresh
// (QGD-ENG-0015, QGD-ENG-0015.1, QGD-REF-0010, QGD-REF-0014).
//
// A refresh, in order:
// 1. ADIF's archive, from the verified cache or fetched and verified
//    (QGD-REF-0003).
// 2. Each POTA list, asked for at most once a day and conditionally. A fresh
//    body is shape-checked before it is cached; a 304 only moves the last
//    check forward; a failure keeps the last good list (QGD-REF-0010).
// 3. If what the file holds is not what the inputs now are, a new file is
//    built beside it, on a worker, and checked.
// 4. Only then is it swapped in, after the read handle on the old file is
//    closed. Then the outcomes are written to state.sqlite, and the POTA cache
//    is pruned.
//
// What is loaded is read from the file itself (status()), never from
// state.sqlite, so a crash between the swap and the outcome is still read
// correctly at the next start.
//
// Every failure is reduced before it goes anywhere (QGD-ENG-0016). Nothing
// here opens a connection: the fetching functions are passed in, and in the
// product they ask the credential core (QGD-SEC-0020).
import { randomBytes } from 'node:crypto';
import { readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { eq, sql } from 'drizzle-orm';
import { openArchive, type FetchArchive, type FetchText } from '../reference/fetch.js';
import type { Definitions } from '../reference/adif.js';
import type { Register } from '../reference/register.js';
import { ShapeError, readLocations, readParks, readPrograms, refuseIfShrunk } from '../reference/pota.js';
import { type StorageError, StorageFailure, failure, reduce } from './errors.js';
import type { Layout } from './layout.js';
import {
  type BuildInputs, type BuildSummary, ADIF_SOURCE, POTA_SOURCE_IDS
} from './reference-build.js';
import { POTA_LISTS, type PotaList, commit, prune, readBody, readRecord } from './reference-cache.js';
import { REFERENCE_SCHEMA_VERSION, referenceSchema, source } from './reference-schema.js';
import { referenceRefresh, type stateSchema } from './schema.js';
import { isSqliteFile, openStore, type Store } from './sqlite.js';
import { UnitQueue } from './queue.js';

export type DatasetState =
  | { state: 'loaded'; fetchedAt: string; rows: number; contentSha256: string; version?: string; sha256?: string }
  | { state: 'not loaded' };

export interface ReferenceStatus {
  adif: DatasetState;
  pota: Record<PotaList, DatasetState>;
}

export type InputOutcome =
  | { state: 'current' | 'obtained' | 'loaded' | 'unchanged' | 'fresh enough' }
  | { state: 'kept'; failure: StorageError };

export interface RefreshOutcome {
  adif: InputOutcome;
  pota: Record<PotaList, InputOutcome>;
  built: boolean;
  // A build that would have dropped a dataset the live file holds, and so was
  // not run. The file stands as it was.
  deferred?: true;
  buildFailure?: StorageError;
  summary?: BuildSummary;
  status: ReferenceStatus;
}

export type RunBuild = (target: string, ddl: string, inputs: BuildInputs) => Promise<BuildSummary>;

export interface ReferenceOptions {
  paths: Layout;
  ddl: string;            // the folder holding reference.sqlite's rendered DDL
  register: Register;
  state: Store<typeof stateSchema>;
  fetchArchive: FetchArchive;
  fetchText: FetchText;
  now?: () => Date;
  // How a build runs. Defaults to a worker thread (reference-worker.js); tests
  // may run it inline.
  build?: RunBuild;
  // Crash points for the controls in tests.
  hooks?: { beforeSwap?: () => void; afterSwap?: () => void };
}

const HOUR = 60 * 60 * 1000;
const NOT_LOADED: DatasetState = { state: 'not loaded' };

export function workerBuild(workerFile: URL): RunBuild {
  return (target, ddl, inputs) => new Promise<BuildSummary>((settle, refuse) => {
    const worker = new Worker(workerFile, { workerData: { target, ddl, inputs } });
    let answered = false;
    worker.once('message', (message: { ok: true; summary: BuildSummary } | { ok: false; failure: StorageError }) => {
      answered = true;
      if (message.ok) settle(message.summary);
      else refuse(new StorageFailure(message.failure));
    });
    worker.once('error', (error) => { answered = true; refuse(failure(error, 'build')); });
    // A worker that dies without answering is a failed build, never a hang.
    worker.once('exit', () => { if (!answered) refuse(new StorageFailure({ kind: 'build' })); });
  });
}

export class Reference {
  readonly #options: ReferenceOptions;
  #reader: Store<typeof referenceSchema> | undefined;
  // One refresh at a time, from fetch through build, swap and cleanup, so two
  // can never build, publish or clean up over each other.
  readonly #refreshes = new UnitQueue();

  constructor(options: ReferenceOptions) {
    this.#options = options;
  }

  #now(): Date { return this.#options.now?.() ?? new Date(); }

  // The read-only handle on the live file, or undefined when there is no file
  // or it is not this schema version. Everything except a build reads through this.
  reader(): Store<typeof referenceSchema> | undefined {
    if (this.#reader) return this.#reader;
    const store = this.#open();
    if (!store) return undefined;
    let version: number | undefined;
    try {
      version = (store.connection.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined)?.user_version;
    } catch (error) {
      store.close();
      throw failure(error, 'open');
    }
    if (version !== REFERENCE_SCHEMA_VERSION) { store.close(); return undefined; }
    this.#reader = store;
    return store;
  }

  // The live file opened read-only, whatever its schema version, or undefined
  // when there is none. Every failure leaves reduced (QGD-ENG-0016).
  #open(): Store<typeof referenceSchema> | undefined {
    const path = this.#options.paths.reference;
    try {
      try { statSync(path); } catch { return undefined; }
      if (!isSqliteFile(path)) return undefined;
      return openStore(path, { schema: referenceSchema, readOnly: true });
    } catch (error) {
      throw failure(error, 'open');
    }
  }

  #removeLeftovers(): void {
    const { reference } = this.#options.paths;
    const folder = dirname(reference);
    const prefix = `${basename(reference)}.building-`;
    let names: string[];
    try { names = readdirSync(folder); } catch { return; }
    for (const name of names) {
      if (!name.startsWith(prefix)) continue;
      try { rmSync(join(folder, name), { force: true }); } catch { /* tried again next refresh */ }
    }
  }

  // Which datasets the live file holds, read from its source table even when
  // its schema version is not this one. A file of another version is not read
  // from, but what it holds still counts: a rebuild may not publish less
  // (QGD-ENG-0015).
  async #held(): Promise<Map<string, number>> {
    if (this.#reader) {
      const rows = await this.#reader.unit((db) => db.select({ id: source.id, rows: source.rowCount }).from(source).all());
      return new Map(rows.map((row) => [row.id, row.rows]));
    }
    const store = this.#open();
    if (!store) return new Map();
    try {
      const rows = store.connection.prepare('SELECT id, row_count FROM source').all() as { id: string; row_count: number }[];
      return new Map(rows.map((row) => [row.id, row.row_count]));
    } catch {
      // A file whose source table cannot be read holds nothing that can be
      // named, and is rebuilt.
      return new Map();
    } finally {
      store.close();
    }
  }

  close(): void {
    this.#reader?.close();
    this.#reader = undefined;
  }

  // QGD-ENG-0015.1: what is loaded, read from the file.
  async status(): Promise<ReferenceStatus> {
    const empty = (): ReferenceStatus => ({
      adif: NOT_LOADED,
      pota: { parks: NOT_LOADED, programs: NOT_LOADED, locations: NOT_LOADED }
    });
    const reader = this.reader();
    if (!reader) return empty();
    const rows = await reader.unit((db) => db.select().from(source).all());
    const of = (id: string): DatasetState => {
      const row = rows.find((candidate) => candidate.id === id);
      return row
        ? {
          state: 'loaded', fetchedAt: row.fetchedAt, rows: row.rowCount, contentSha256: row.contentSha256,
          ...(row.version ? { version: row.version } : {}), ...(row.sha256 ? { sha256: row.sha256 } : {})
        }
        : NOT_LOADED;
    };
    return {
      adif: of(ADIF_SOURCE),
      pota: { parks: of(POTA_SOURCE_IDS.parks), programs: of(POTA_SOURCE_IDS.programs), locations: of(POTA_SOURCE_IDS.locations) }
    };
  }

  async #lastCheck(sourceId: string): Promise<Date | undefined> {
    const row = await this.#options.state.unit((db) =>
      db.select().from(referenceRefresh).where(eq(referenceRefresh.sourceId, sourceId)).get());
    return row?.lastCheck ? new Date(row.lastCheck) : undefined;
  }

  async #record(sourceId: string, at: string, outcome: InputOutcome, checked: boolean): Promise<void> {
    const lastFailure = outcome.state === 'kept' ? outcome.failure.kind : null;
    await this.#options.state.unit((db) => db.insert(referenceRefresh)
      .values({ sourceId, lastAttempt: at, lastCheck: checked ? at : null, lastFailure })
      .onConflictDoUpdate({
        target: referenceRefresh.sourceId,
        set: checked
          ? { lastAttempt: at, lastCheck: at, lastFailure }
          : { lastAttempt: at, lastFailure }
      }));
  }

  refresh(options: { force?: boolean } = {}): Promise<RefreshOutcome> {
    return this.#refreshes.run(() => this.#refresh(options));
  }

  async #refresh(options: { force?: boolean }): Promise<RefreshOutcome> {
    const { paths, register } = this.#options;
    const now = this.#now();
    const at = now.toISOString();
    // A refresh that crashed mid-build leaves its file behind. Refreshes run
    // one at a time, so any such file now belongs to none and is removed.
    this.#removeLeftovers();
    const before = await this.status();
    const held = await this.#held();

    // 1. ADIF.
    let definitions: Definitions | undefined;
    let adif: InputOutcome;
    try {
      const archive = await openArchive(register.adif, paths.referenceCache, this.#options.fetchArchive);
      definitions = archive.definitions;
      adif = { state: archive.fromCache ? 'current' : 'obtained' };
    } catch (error) {
      adif = { state: 'kept', failure: reduce(error, 'fetch') };
    }

    // 2. POTA, each list on its own.
    const pota = {} as Record<PotaList, InputOutcome>;
    for (const list of POTA_LISTS) {
      pota[list] = await this.#refreshList(list, now, options.force === true, held.get(POTA_SOURCE_IDS[list]));
    }

    // 3. Build, if what the file holds is not what the inputs now are.
    const adifFetchedAt = definitions
      // The same release (version and checksum together, QGD-REF-0003) keeps
      // its original fetch time, so it does not cause a rebuild on its own.
      ? (before.adif.state === 'loaded' && before.adif.version === register.adif.version
        && before.adif.sha256 === register.adif.source.sha256 ? before.adif.fetchedAt : at)
      : undefined;
    const inputs: BuildInputs = {
      register,
      ...(definitions && adifFetchedAt ? { adif: { definitions, fetchedAt: adifFetchedAt } } : {}),
      pota: {}
    };
    let buildFailure: StorageError | undefined;
    try {
      for (const list of POTA_LISTS) {
        const record = readRecord(paths.referenceCache, list);
        if (record) inputs.pota[list] = { record, body: readBody(paths.referenceCache, record) };
      }
    } catch (error) {
      buildFailure = reduce(error, 'build');
    }

    // Whether the file holds exactly this input, judged by the content's
    // SHA-256: two different bodies can arrive within the same instant.
    const wanted = (id: string, content: string | undefined): boolean => {
      const loaded = id === ADIF_SOURCE ? before.adif : before.pota[(Object.keys(POTA_SOURCE_IDS) as PotaList[])
        .find((list) => POTA_SOURCE_IDS[list] === id)!];
      return content === undefined ? loaded.state !== 'not loaded' : loaded.state !== 'loaded' || loaded.contentSha256 !== content;
    };
    // A build never publishes less than the live file holds: a dataset the file
    // has, but whose input cannot be had now (an archive missing from the cache
    // with no network, a cache record gone), defers the build. The file stands
    // until every dataset it holds can be built again (QGD-REF-0010: briefly
    // stale beats briefly wrong).
    const wouldLose = (held.has(ADIF_SOURCE) && !inputs.adif)
      || POTA_LISTS.some((list) => held.has(POTA_SOURCE_IDS[list]) && !inputs.pota[list]);
    const needed = !buildFailure && !wouldLose && (
      !this.reader()
      || wanted(ADIF_SOURCE, inputs.adif ? register.adif.source.sha256 : undefined)
      || POTA_LISTS.some((list) => wanted(POTA_SOURCE_IDS[list], inputs.pota[list]?.record.sha256))
    ) && (inputs.adif !== undefined || Object.keys(inputs.pota).length > 0);

    let summary: BuildSummary | undefined;
    if (needed) {
      // A name of this refresh's own, so nothing else ever writes, publishes
      // or removes it.
      const target = `${paths.reference}.building-${randomBytes(6).toString('hex')}`;
      try {
        const run = this.#options.build ?? workerBuild(new URL('./reference-worker.js', import.meta.url));
        const built = await run(target, this.#options.ddl, inputs);
        this.#options.hooks?.beforeSwap?.();
        // 4. Swap. The read handle on the old file is closed first: Windows
        // cannot rename over an open file.
        this.close();
        renameSync(target, paths.reference);
        // Built means published: set only once the rename has happened.
        summary = built;
        this.#options.hooks?.afterSwap?.();
        prune(paths.referenceCache);
      } catch (error) {
        buildFailure = reduce(error, 'build');
        for (const name of [target, `${target}-journal`]) {
          try { rmSync(name, { force: true }); } catch { /* the reported failure stands */ }
        }
      }
    }

    // Outcomes, after the swap (QGD-ENG-0015.1).
    await this.#record(ADIF_SOURCE, at, adif, adif.state !== 'kept');
    for (const list of POTA_LISTS) {
      const outcome = pota[list];
      await this.#record(POTA_SOURCE_IDS[list], at, outcome, outcome.state !== 'fresh enough' && outcome.state !== 'kept');
    }

    return {
      adif, pota, built: summary !== undefined,
      ...(wouldLose ? { deferred: true as const } : {}),
      ...(buildFailure ? { buildFailure } : {}),
      ...(summary ? { summary } : {}),
      status: await this.status()
    };
  }

  async #refreshList(list: PotaList, now: Date, force: boolean, liveRows: number | undefined): Promise<InputOutcome> {
    const { paths, register } = this.#options;
    const sourceRegister = register.pota.sources[list];
    // A record is trusted only if the body it names is there and matches.
    // Otherwise it is as if there were none: no freshness, no validators, so
    // the fetch is unconditional and an unchanged list can repair the cache.
    let record = readRecord(paths.referenceCache, list);
    if (record) {
      try { readBody(paths.referenceCache, record); } catch { record = undefined; }
    }
    const lastCheck = await this.#lastCheck(POTA_SOURCE_IDS[list]) ?? (record ? new Date(record.fetchedAt) : undefined);
    if (!force && record && lastCheck && now.getTime() - lastCheck.getTime() < register.pota.refreshAfterHours * HOUR) {
      return { state: 'fresh enough' };
    }
    try {
      const answer = await this.#options.fetchText(sourceRegister.url, {
        etag: record?.etag ?? null, lastModified: record?.lastModified ?? null
      });
      if (answer.status === 'unchanged') return { state: 'unchanged' };
      // Checked before it can replace anything (QGD-REF-0010).
      const rows = list === 'parks' ? readParks(answer.body, sourceRegister.columns).parks.length
        : list === 'programs' ? readPrograms(answer.body).length
          : readLocations(answer.body).length;
      // Against the cache's count, or the live file's when the cache has
      // none, so losing a record does not switch off the truncation check.
      refuseIfShrunk(list, rows, record?.rowCount ?? liveRows);
      commit(paths.referenceCache, {
        list, url: sourceRegister.url, what: sourceRegister.what, etag: answer.etag,
        lastModified: answer.lastModified, fetchedAt: now.toISOString(), rowCount: rows
      }, answer.body);
      return { state: 'loaded' };
    } catch (error) {
      // Kept, and reduced: a ShapeError's text can quote the data it refused.
      return { state: 'kept', failure: reduce(error, error instanceof ShapeError ? 'shape' : 'fetch') };
    }
  }
}

// Used by status displays: whether reference data is loaded at all.
export function anyLoaded(status: ReferenceStatus): boolean {
  return status.adif.state === 'loaded' || POTA_LISTS.some((list) => status.pota[list].state === 'loaded');
}

// Sanity for the suites: a count by SQL on the live file.
export async function referenceCount(reader: Store<typeof referenceSchema>, table: string): Promise<number> {
  if (!/^[a-z_]+$/.test(table)) throw new StorageFailure({ kind: 'query' });
  const rows = await reader.unit((db) => db.values<[number]>(sql`SELECT count(*) FROM ${sql.identifier(table)}`));
  return rows[0]?.[0] ?? 0;
}
