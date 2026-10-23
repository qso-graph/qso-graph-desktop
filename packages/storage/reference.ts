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
import { LOCATION_CODE, ShapeError, readActivations, readLocations, readParks, readPrograms, refuseIfShrunk } from '../reference/pota.js';
import { readSummits } from '../reference/sota.js';
import { type StorageError, StorageFailure, failure, reduce } from './errors.js';
import type { Layout } from './layout.js';
import {
  type BuildInputs, type BuildSummary, ACTIVATIONS_SOURCE_PREFIX, ADIF_SOURCE, POTA_SOURCE_IDS, SOTA_SOURCE_IDS,
  activationsSourceId
} from './reference-build.js';
import {
  POTA_LISTS, SOTA_LISTS, type AnyList, type ListedResource, type PotaList, type SotaList, commit, forget, listsOf, prune,
  readBody, readRecord
} from './reference-cache.js';
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
  sota: Record<SotaList, DatasetState>;
  // POTA's activations, by location: only the locations the file holds
  // (QGD-REF-0019).
  activations: Record<string, DatasetState>;
}

export type InputOutcome =
  | { state: 'current' | 'obtained' | 'loaded' | 'unchanged' | 'fresh enough' }
  // The operator updated the other source: this one was read from its cache,
  // if there, and not fetched.
  | { state: 'not asked' }
  | { state: 'kept'; failure: StorageError };

// The resources this core knows how to load, by the register's ids
// (data/reference-sources.json "resources"). A register row the core cannot
// load, or an id here the register lacks, is a test failure, not a quiet gap.
export const REFERENCE_RESOURCES = ['adif', 'pota', 'activations', 'sota'] as const;
export type ReferenceResource = (typeof REFERENCE_RESOURCES)[number];
export function isReferenceResource(value: unknown): value is ReferenceResource {
  return typeof value === 'string' && (REFERENCE_RESOURCES as readonly string[]).includes(value);
}

export interface RefreshOptions {
  force?: boolean;
  only?: ReferenceResource;
  // My Area's locations, for an activations refresh (QGD-STN-0012): only
  // these are fetched, and a location no longer in it is let go.
  area?: readonly string[];
}

// For the source not being fetched: the cache answers, or nothing does.
const notFetched = async (): Promise<Buffer> => { throw new StorageFailure({ kind: 'fetch' }); };

export interface RefreshOutcome {
  adif: InputOutcome;
  pota: Record<PotaList, InputOutcome>;
  sota: Record<SotaList, InputOutcome>;
  activations: Record<string, InputOutcome>;
  // An activations refresh with no location to fetch: My Area is empty.
  noArea?: true;
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

// The rename that publishes a build. On Windows a file that was just closed
// can stay held for a moment (an antivirus scan, the search indexer), and
// renaming over it fails with EPERM or EBUSY until it is let go. Retried
// briefly, as graceful-fs does for npm; anywhere else the first error stands.
async function publish(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try { renameSync(from, to); return; } catch (error) {
      const code = (error as { code?: string }).code;
      if (process.platform !== 'win32' || attempt >= 20 || !['EPERM', 'EBUSY', 'EACCES'].includes(code ?? '')) throw error;
      await new Promise((settle) => setTimeout(settle, 50 * (attempt + 1)));
    }
  }
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
      pota: { parks: NOT_LOADED, programs: NOT_LOADED, locations: NOT_LOADED },
      sota: { summits: NOT_LOADED },
      activations: {}
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
      pota: { parks: of(POTA_SOURCE_IDS.parks), programs: of(POTA_SOURCE_IDS.programs), locations: of(POTA_SOURCE_IDS.locations) },
      sota: { summits: of(SOTA_SOURCE_IDS.summits) },
      activations: Object.fromEntries(rows.filter((row) => row.id.startsWith(ACTIVATIONS_SOURCE_PREFIX))
        .map((row) => [row.id.slice(ACTIVATIONS_SOURCE_PREFIX.length), of(row.id)]))
    };
  }

  // When each source last answered: a fresh body or a 304. Freshness is
  // measured from this, not from when the body was fetched, so a list that
  // has not changed is current after an Update that found it unchanged.
  async lastChecks(): Promise<Record<string, string | undefined>> {
    const ids = [ADIF_SOURCE, ...POTA_LISTS.map((list) => POTA_SOURCE_IDS[list]), ...SOTA_LISTS.map((list) => SOTA_SOURCE_IDS[list]),
      ...listsOf(this.#options.paths.referenceCache, 'activations').map(activationsSourceId)];
    const out: Record<string, string | undefined> = {};
    for (const id of ids) out[id] = (await this.#lastCheck(id))?.toISOString();
    return out;
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

  // `only` fetches one source and leaves the other as its cache has it: each
  // resource is loaded or updated by its own control, so someone who never
  // hunts parks never downloads POTA's lists (KI7MT, 2026-10-11).
  refresh(options: RefreshOptions = {}): Promise<RefreshOutcome> {
    return this.#refreshes.run(() => this.#refresh(options));
  }

  async #refresh(options: RefreshOptions): Promise<RefreshOutcome> {
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
    // Each resource is asked when it is the one named, and when none is named.
    const askAdif = options.only === undefined || options.only === 'adif';
    try {
      const archive = await openArchive(register.adif, paths.referenceCache, askAdif ? this.#options.fetchArchive : notFetched);
      definitions = archive.definitions;
      adif = askAdif ? { state: archive.fromCache ? 'current' : 'obtained' } : { state: 'not asked' };
    } catch (error) {
      adif = askAdif ? { state: 'kept', failure: reduce(error, 'fetch') } : { state: 'not asked' };
    }

    // 2. POTA, each list on its own.
    const pota = {} as Record<PotaList, InputOutcome>;
    for (const list of POTA_LISTS) {
      pota[list] = options.only !== undefined && options.only !== 'pota' ? { state: 'not asked' }
        : await this.#refreshList('pota', list, now, options.force === true, held.get(POTA_SOURCE_IDS[list]));
    }
    // And SOTA's summits (QGD-REF-0018). A refresh that names no resource
    // checks them only if they were downloaded: someone who never asked for
    // 25 MB of summits is never sent it.
    const sota = {} as Record<SotaList, InputOutcome>;
    for (const list of SOTA_LISTS) {
      const asked = options.only === 'sota' || (options.only === undefined && readRecord(paths.referenceCache, list, 'sota') !== undefined);
      sota[list] = asked
        ? await this.#refreshList('sota', list, now, options.force === true, held.get(SOTA_SOURCE_IDS[list]))
        : { state: 'not asked' };
    }

    // And POTA's activations, only when they are what was asked for, and only
    // for My Area's locations, one at a time (QGD-REF-0019). Never forced:
    // each location is asked at most once a day however often Update is
    // pressed. A location taken out of My Area is let go, which is the
    // operator's choice and not a loss.
    const activations: Record<string, InputOutcome> = {};
    const letGo = new Set<string>();
    let noArea = false;
    if (options.only === 'activations') {
      const area = [...new Set((options.area ?? []).filter((location) => LOCATION_CODE.test(location)))];
      noArea = area.length === 0;
      if (!noArea) {
        for (const location of listsOf(paths.referenceCache, 'activations')) {
          if (area.includes(location)) continue;
          forget(paths.referenceCache, location, 'activations');
          letGo.add(location);
        }
      }
      for (const location of area) {
        activations[location] = await this.#refreshList('activations', location, now, false, held.get(activationsSourceId(location)));
      }
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
      pota: {},
      sota: {},
      activations: {}
    };
    let buildFailure: StorageError | undefined;
    try {
      for (const list of POTA_LISTS) {
        const record = readRecord(paths.referenceCache, list);
        if (record) inputs.pota[list] = { record, body: readBody(paths.referenceCache, record) };
      }
      for (const list of SOTA_LISTS) {
        const record = readRecord(paths.referenceCache, list, 'sota');
        if (record) inputs.sota![list] = { record, body: readBody(paths.referenceCache, record, 'sota') };
      }
      for (const list of listsOf(paths.referenceCache, 'activations')) {
        const record = readRecord(paths.referenceCache, list, 'activations');
        if (record) inputs.activations![list] = { record, body: readBody(paths.referenceCache, record, 'activations') };
      }
    } catch (error) {
      buildFailure = reduce(error, 'build');
    }

    // Whether the file holds exactly this input, judged by the content's
    // SHA-256: two different bodies can arrive within the same instant.
    const wanted = (loaded: DatasetState, content: string | undefined): boolean =>
      content === undefined ? loaded.state !== 'not loaded' : loaded.state !== 'loaded' || loaded.contentSha256 !== content;
    // A build never publishes less than the live file holds: a dataset the file
    // has, but whose input cannot be had now (an archive missing from the cache
    // with no network, a cache record gone), defers the build. The file stands
    // until every dataset it holds can be built again (QGD-REF-0010: briefly
    // stale beats briefly wrong).
    const wouldLose = (held.has(ADIF_SOURCE) && !inputs.adif)
      || POTA_LISTS.some((list) => held.has(POTA_SOURCE_IDS[list]) && !inputs.pota[list])
      || SOTA_LISTS.some((list) => held.has(SOTA_SOURCE_IDS[list]) && !inputs.sota?.[list])
      || Object.keys(before.activations).some((location) => !letGo.has(location) && !inputs.activations?.[location]);
    // The activations the file holds are not the ones the inputs are: a
    // location added, let go, or fetched again.
    const activationsChanged = Object.keys(before.activations).length !== Object.keys(inputs.activations ?? {}).length
      || Object.entries(inputs.activations ?? {}).some(([location, input]) => wanted(before.activations[location] ?? NOT_LOADED, input.record.sha256));
    const needed = !buildFailure && !wouldLose && (
      !this.reader()
      || wanted(before.adif, inputs.adif ? register.adif.source.sha256 : undefined)
      || POTA_LISTS.some((list) => wanted(before.pota[list], inputs.pota[list]?.record.sha256))
      || SOTA_LISTS.some((list) => wanted(before.sota[list], inputs.sota?.[list]?.record.sha256))
      || activationsChanged
    ) && (inputs.adif !== undefined || Object.keys(inputs.pota).length > 0 || Object.keys(inputs.sota ?? {}).length > 0
      || Object.keys(inputs.activations ?? {}).length > 0);

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
        await publish(target, paths.reference);
        // Built means published: set only once the rename has happened.
        summary = built;
        this.#options.hooks?.afterSwap?.();
        prune(paths.referenceCache, 'pota');
        prune(paths.referenceCache, 'sota');
        prune(paths.referenceCache, 'activations');
      } catch (error) {
        buildFailure = reduce(error, 'build');
        for (const name of [target, `${target}-journal`]) {
          try { rmSync(name, { force: true }); } catch { /* the reported failure stands */ }
        }
      }
    }

    // Outcomes, after the swap (QGD-ENG-0015.1).
    // A source that was not asked has nothing to record.
    if (adif.state !== 'not asked') await this.#record(ADIF_SOURCE, at, adif, adif.state !== 'kept');
    for (const list of POTA_LISTS) {
      const outcome = pota[list];
      if (outcome.state === 'not asked') continue;
      await this.#record(POTA_SOURCE_IDS[list], at, outcome, outcome.state !== 'fresh enough' && outcome.state !== 'kept');
    }
    for (const list of SOTA_LISTS) {
      const outcome = sota[list];
      if (outcome.state === 'not asked') continue;
      await this.#record(SOTA_SOURCE_IDS[list], at, outcome, outcome.state !== 'fresh enough' && outcome.state !== 'kept');
    }

    for (const [location, outcome] of Object.entries(activations)) {
      await this.#record(activationsSourceId(location), at, outcome, outcome.state !== 'fresh enough' && outcome.state !== 'kept');
    }

    return {
      adif, pota, sota, activations, built: summary !== undefined,
      ...(noArea ? { noArea: true as const } : {}),
      ...(wouldLose ? { deferred: true as const } : {}),
      ...(buildFailure ? { buildFailure } : {}),
      ...(summary ? { summary } : {}),
      status: await this.status()
    };
  }

  async #refreshList(
    resource: ListedResource, list: AnyList, now: Date, force: boolean, liveRows: number | undefined
  ): Promise<InputOutcome> {
    const { paths, register } = this.#options;
    // An activations list is the register's one source with its location
    // filled in, a code already held to LOCATION_CODE (QGD-REF-0019).
    const sources: Record<string, (typeof register.pota.sources)['parks']> = resource === 'pota' ? register.pota.sources
      : resource === 'sota' ? register.sota.sources
        : { [list]: { ...register.activations.source, url: register.activations.source.url.replace('{location}', list) } };
    const sourceRegister = sources[list];
    const sourceId = resource === 'pota' ? POTA_SOURCE_IDS[list as PotaList]
      : resource === 'sota' ? SOTA_SOURCE_IDS[list as SotaList] : activationsSourceId(list);
    const refreshAfterHours = resource === 'pota' ? register.pota.refreshAfterHours
      : resource === 'sota' ? register.sota.refreshAfterHours : register.activations.refreshAfterHours;
    // A record is trusted only if the body it names is there and matches.
    // Otherwise it is as if there were none: no freshness, no validators, so
    // the fetch is unconditional and an unchanged list can repair the cache.
    let record = readRecord(paths.referenceCache, list, resource);
    if (record) {
      try { readBody(paths.referenceCache, record, resource); } catch { record = undefined; }
    }
    const lastCheck = await this.#lastCheck(sourceId) ?? (record ? new Date(record.fetchedAt) : undefined);
    if (!force && record && lastCheck && now.getTime() - lastCheck.getTime() < refreshAfterHours * HOUR) {
      return { state: 'fresh enough' };
    }
    try {
      const answer = await this.#options.fetchText(sourceRegister.url, {
        etag: record?.etag ?? null, lastModified: record?.lastModified ?? null
      });
      if (answer.status === 'unchanged') return { state: 'unchanged' };
      // Checked before it can replace anything (QGD-REF-0010).
      const rows = resource === 'activations' ? readActivations(answer.body).length
          : list === 'parks' ? readParks(answer.body, sourceRegister.columns).parks.length
            : list === 'programs' ? readPrograms(answer.body).length
              : list === 'summits' ? readSummits(answer.body, sourceRegister.columns).summits.length
                : readLocations(answer.body).length;
      // Against the cache's count, or the live file's when the cache has
      // none, so losing a record does not switch off the truncation check.
      refuseIfShrunk(list, rows, record?.rowCount ?? liveRows);
      commit(paths.referenceCache, {
        list, url: sourceRegister.url, what: sourceRegister.what, etag: answer.etag,
        lastModified: answer.lastModified, fetchedAt: now.toISOString(), rowCount: rows
      }, answer.body, {}, resource);
      return { state: 'loaded' };
    } catch (error) {
      // Kept, and reduced: a ShapeError's text can quote the data it refused.
      return { state: 'kept', failure: reduce(error, error instanceof ShapeError ? 'shape' : 'fetch') };
    }
  }
}

// Used by status displays: whether reference data is loaded at all.
export function anyLoaded(status: ReferenceStatus): boolean {
  return status.adif.state === 'loaded' || POTA_LISTS.some((list) => status.pota[list].state === 'loaded')
    || SOTA_LISTS.some((list) => status.sota[list].state === 'loaded') || Object.keys(status.activations).length > 0;
}

// Sanity for the suites: a count by SQL on the live file.
export async function referenceCount(reader: Store<typeof referenceSchema>, table: string): Promise<number> {
  if (!/^[a-z_]+$/.test(table)) throw new StorageFailure({ kind: 'query' });
  const rows = await reader.unit((db) => db.values<[number]>(sql`SELECT count(*) FROM ${sql.identifier(table)}`));
  return rows[0]?.[0] ?? 0;
}
