// SPDX-License-Identifier: GPL-3.0-only
// QG Storage: the one process that opens a SQLite store (QGD-ENG-0006,
// QGD-PRC-0004).
//
// It is given its paths on the command line by the broker, and nothing it
// does takes a path from a message. It opens state.sqlite at once, answers
// status straight away, and keeps reference.sqlite current in the background,
// building on a worker so it never stops answering (QGD-ENG-0015).
//
// It opens no connection. A reference source is asked for through the broker,
// which asks the credential core, the one process that reaches the network
// (QGD-SEC-0020). Every failure is reduced before it is logged or sent
// (QGD-ENG-0016).
import { adifBands, adifList, searchAdif } from './adif-search.js';
import { areaChoices, areaDefault, areaLocations, homeLocation, placesOf } from './area.js';
import { parksNear, parksToActivate } from './activations.js';
import { readFile } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { createForwardingLogger } from '../logging/logger.js';
import type { Register } from '../reference/register.js';
import { countiesFrom, type Counties } from '../reference/counties.js';
import { StorageFailure, describe, reduce } from './errors.js';
import { layout, openState } from './layout.js';
import { Reference, isReferenceResource, type DatasetState, type ReferenceResource, type ReferenceStatus } from './reference.js';
import { problemOf, summarize } from './reference-resources.js';
import { readReferenceRuleset } from './reference-read.js';
import { isCallsignId, type StationsView } from './station-contract.js';
import {
  backupStations, checkBackup, deleteStation, draftFromPark, restoreStations, draftFromSummit, summitOf, lookUpParks, parkLocations, parksIn, callsignActivated, callsignRemoved, stationChoices, type ReferenceLists, saveStation, setActiveStation, setDefaultStation, viewStations,
  type Definitions
} from './stations.js';
import type { Store } from './sqlite.js';
import type { stateSchema } from './schema.js';
import {
  type DatasetSummary, type StorageCommand, type StorageReply, type StorageStatus, validateStorageCommand
} from './storage-contract.js';

const [, , root, stateMigrations, referenceDdl, registerFile, referenceCache, appVersion] = process.argv;
const log = createForwardingLogger('storage', (line) => process.parentPort.postMessage({ log: line }));
const paths = { ...layout(root), referenceCache };

// ---- asking for a reference source, through the broker --------------------
let nextFetch = 0;
const fetches = new Map<number, (answer: unknown) => void>();

function askForReference(url: string, etag?: string, lastModified?: string): Promise<unknown> {
  const id = ++nextFetch;
  return new Promise((settle) => {
    // A source that never answers must not hold a refresh open for ever.
    const timer = setTimeout(() => { fetches.delete(id); settle('unreachable'); }, 180_000);
    fetches.set(id, (answer) => { clearTimeout(timer); settle(answer); });
    // `reference`, not `fetch`: the network gate reads a property called fetch
    // as a client reaching the network, and it is right to.
    process.parentPort.postMessage({ reference: { id, url, ...(etag ? { etag } : {}), ...(lastModified ? { lastModified } : {}) } });
  });
}

interface Answer { fresh: boolean; body: Uint8Array; etag: string | null; lastModified: string | null }
function asAnswer(answer: unknown): Answer {
  // Nothing was asked of any server: the credential core was not up yet.
  if ((answer as { notReady?: unknown } | null)?.notReady === true) throw new StorageFailure({ kind: 'pending' });
  const value = answer as Answer | null;
  if (typeof answer === 'string' || !value || typeof value.fresh !== 'boolean') throw new Error('unreachable');
  return value;
}

const fetchArchive = async (url: string): Promise<Buffer> => {
  const answer = asAnswer(await askForReference(url));
  if (!answer.fresh) throw new Error('unreachable');
  return Buffer.from(answer.body);
};

const fetchText = async (url: string, conditional: { etag?: string | null; lastModified?: string | null }) => {
  const answer = asAnswer(await askForReference(url, conditional.etag ?? undefined, conditional.lastModified ?? undefined));
  if (!answer.fresh) return { status: 'unchanged' as const };
  return { status: 'fresh' as const, body: Buffer.from(answer.body).toString('utf8'), etag: answer.etag, lastModified: answer.lastModified };
};

// ---- status -------------------------------------------------------------
let state: Store<typeof stateSchema> | undefined;
let reference: Reference | undefined;
let referenceStatus: ReferenceStatus | undefined;
let refreshing = false;
let failed: string | undefined;
let register: Register | undefined;
// The resource being loaded or updated now, if any.
let updating: ReferenceResource | undefined;

function sizeOf(...files: string[]): number {
  let total = 0;
  for (const file of files) { try { total += statSync(file).size; } catch { /* not there */ } }
  return total;
}

function summary(dataset: DatasetState): DatasetSummary {
  return dataset.state === 'loaded'
    ? { state: 'loaded', fetchedAt: dataset.fetchedAt, rows: dataset.rows, ...(dataset.version ? { version: dataset.version } : {}) }
    : { state: 'not loaded' };
}

function status(): StorageStatus {
  if (failed) return { state: 'failed', folder: root, reason: failed };
  if (!state) return { state: 'starting', folder: root };
  const referenceSize = sizeOf(paths.reference);
  return {
    state: 'ready',
    folder: root,
    sizes: { state: sizeOf(paths.state, `${paths.state}-wal`), reference: referenceSize > 0 ? referenceSize : null },
    ...(referenceStatus ? {
      reference: {
        adif: summary(referenceStatus.adif),
        parks: summary(referenceStatus.pota.parks),
        programs: summary(referenceStatus.pota.programs),
        locations: summary(referenceStatus.pota.locations),
        summits: summary(referenceStatus.sota.summits),
        refreshing,
        resources: register ? summarize({ register, held: referenceStatus, checks, problems, updating, now: Date.now() }) : []
      }
    } : {}),
    ...(stations ? { stations } : {})
  };
}

// ---- stations (QGD-STN-*) -------------------------------------------------
let stations: StationsView | undefined;
// ADIF's definitions, read once and again after a reference build, so a
// station is checked against what is loaded now (QGD-STN-0002).
let definitions: Definitions | undefined;

async function currentDefinitions(): Promise<Definitions> {
  definitions ??= await readReferenceRuleset(reference?.reader());
  return definitions;
}

// A callsign made active, or removed, before the stores were open, applied
// once they are.
let heldActivation: string | undefined;
const heldRemovals = new Set<string>();

function applyActivation(callsign: string): void {
  if (!state) return;
  void callsignActivated(state, callsign)
    .then(async (changed) => { if (changed) { await reloadStations(); publish(); } })
    .catch((error: unknown) => log.warn({ failure: describe(reduce(error, 'query')) }, 'default station not applied'));
}

function applyRemoval(callsign: string): void {
  if (!state) return;
  void callsignRemoved(state, callsign)
    .then(async (changed) => { if (changed) { await reloadStations(); publish(); } })
    .catch((error: unknown) => log.warn({ failure: describe(reduce(error, 'query')) }, 'default station not removed'));
}

// The US counties (QGD-STN-0010), which ship with the application. Read on
// first use, once; a file that cannot be read leaves counties unchecked and
// unfilled rather than stopping storage, and says so in the log.
let counties: Promise<Counties | undefined> | undefined;
function usCounties(): Promise<Counties | undefined> {
  counties ??= readFile(new URL('../reference/us-counties.json', import.meta.url), 'utf8')
    .then(text => countiesFrom(JSON.parse(text)))
    .catch((error: unknown) => {
      log.warn({ failure: describe(reduce(error, 'query')) }, 'the US county data could not be read');
      return undefined;
    });
  return counties;
}

// The lists a station's references are checked against, where they are on
// this computer (KI7MT, 2026-10-20).
async function referenceLists(): Promise<ReferenceLists> {
  const reader = reference?.reader();
  const pota: ReferenceLists = reader && referenceStatus?.pota.parks.state === 'loaded'
    ? { parks: (references) => lookUpParks(reader, references), locations: (park) => parkLocations(reader, park) }
    : {};
  const summits = reader && referenceStatus?.sota.summits.state === 'loaded'
    ? { summit: (code: string) => summitOf(reader, code) } : {};
  return { ...pota, ...summits, counties: await usCounties() };
}

async function reloadStations(): Promise<void> {
  if (!state) return;
  stations = await viewStations(state, (await currentDefinitions()) !== 'not loaded');
}

// A station command, answered once it is done. Every failure is reduced: a
// station's values are the operator's own and are never logged (QGD-STN-0003).
async function stationCommand(command: Exclude<StorageCommand, { type: 'status' } | { type: 'update-reference' }>):
  Promise<StorageReply> {
  if (!state) return { ok: false, error: 'Storage is not open yet.' };
  switch (command.type) {
    case 'save-station': {
      const outcome = await saveStation(state, command.station, await currentDefinitions(), new Date(), await referenceLists());
      if (!outcome.ok) return { ok: false, error: 'The location was not saved.', problems: outcome.problems };
      await reloadStations();
      publish();
      return { ok: true, status: status(), saved: outcome.id };
    }
    case 'delete-station':
      if (!(await deleteStation(state, command.id))) return { ok: false, error: 'That location no longer exists.' };
      break;
    case 'set-default-station':
      if (!(await setDefaultStation(state, command.callsign, command.id))) return { ok: false, error: 'That location no longer exists.' };
      break;
    case 'set-active-station':
      if (!(await setActiveStation(state, command.id))) return { ok: false, error: 'That location no longer exists.' };
      break;
    case 'look-up-parks': {
      const lists = await referenceLists();
      if (!lists.parks) return { ok: true, status: status(), named: { checked: false, found: [] } };
      return { ok: true, status: status(), named: { checked: true, found: await lists.parks(parksIn(command.references)) } };
    }
    case 'station-choices':
      return {
        ok: true, status: status(),
        choices: stationChoices(await currentDefinitions(), command.entity, command.state, await usCounties())
      };
    case 'counties-at': {
      const list = await usCounties();
      if (!list) return { ok: false, error: 'The county list could not be read. Troubleshooting has the logs.' };
      const { south, west, north, east } = command;
      const point = south === north && west === east;
      const found = point ? [list.at(south, west)].filter((county): county is string => county !== undefined)
        : list.inGrid(south, west, north, east);
      // Each county's ARRL section, where it has one, so the editor can fill
      // it with the county (QGD-STN-0010).
      const sections = Object.fromEntries(found.flatMap(cnty => {
        const section = list.sectionOf(cnty.slice(0, cnty.indexOf(',')), cnty);
        return section ? [[cnty, section]] : [];
      }));
      return { ok: true, status: status(), counties: found, sections };
    }
    case 'adif-search': {
      const reader = reference?.reader();
      if (!reader || referenceStatus?.adif.state !== 'loaded') {
        return { ok: false, error: 'ADIF\'s definitions are not downloaded. Download them in Settings, then try again.' };
      }
      return { ok: true, status: status(), adif: await searchAdif(reader, command.query) };
    }
    case 'stations-backup': {
      if (!state) return { ok: false, error: 'Storage is not open yet.' };
      return { ok: true, status: status(), backup: await backupStations(state) };
    }
    // A restore's Locations checked, changing nothing: asked before the
    // callsigns are touched, so a file storage would refuse is refused whole
    // (#57).
    case 'stations-check': {
      if (!state) return { ok: false, error: 'Storage is not open yet.' };
      const problem = checkBackup(command.backup, await currentDefinitions(), await usCounties());
      return problem ? { ok: false, error: `A Location in that backup cannot be restored. ${problem}` } : { ok: true, status: status() };
    }
    case 'stations-restore': {
      if (!state) return { ok: false, error: 'Storage is not open yet.' };
      const restored = await restoreStations(state, command.backup, command.replace, await currentDefinitions(), await usCounties());
      if (restored === 'not empty') return { ok: false, error: 'This computer already has Locations. Remove them first, then restore.' };
      if (typeof restored === 'object') return { ok: false, error: `A Location in that backup cannot be restored. ${restored.problem}` };
      await reloadStations();
      publish();
      return { ok: true, status: status(), restored };
    }
    case 'adif-list': {
      const reader = reference?.reader();
      if (!reader || referenceStatus?.adif.state !== 'loaded') {
        return { ok: false, error: 'ADIF\'s definitions are not downloaded. Download them in Settings, then try again.' };
      }
      return { ok: true, status: status(), adifList: (await adifList(reader, command.name)) ?? null };
    }
    case 'area-choices': {
      const reader = reference?.reader();
      if (!reader || referenceStatus?.pota.parks.state !== 'loaded') {
        return { ok: false, error: 'POTA\'s lists are not downloaded. Download POTA Parks in Settings, then try again.' };
      }
      return { ok: true, status: status(), areaChoices: await areaChoices(reader) };
    }
    case 'area-default':
      return { ok: true, status: status(), areaDefault: (await ownArea())[0] ?? null };
    case 'parks-to-activate': {
      // My Area as chosen, or else the active Location's own (QGD-STN-0012).
      const area = command.locations.length > 0 ? command.locations : await ownArea();
      // Most Wanted is online only, since only POTA's API has these counts:
      // asked for, it first fetches each part of the area not fetched today,
      // one at a time. A failure keeps what was held.
      if (area.length > 0 && !refreshing) await refresh('activations', area);
      const held = Object.entries(referenceStatus?.activations ?? {}).filter(([entry]) => area.includes(entry));
      const reader = reference?.reader();
      if (!reader || held.length === 0) {
        return { ok: false, error: area.length === 0
          ? 'No POTA focus area is set, and the active Location does not say where it is. Choose your Focus Area on the Settings tab of Parks On the Air.'
          : 'POTA\'s activation counts could not be fetched just now. Try again with Refresh.' };
      }
      // When the oldest of them was fetched, so the page can say how old it is.
      const fetched = held.flatMap(([, set]) => (set.state === 'loaded' ? [set.fetchedAt] : [])).sort()[0];
      // An entity or a program stands for its locations (area.ts).
      const locations = await areaLocations(reader, area);
      // Where the active Location is, by POTA's three levels: where Near me
      // starts its Program, Entity and Location (KI7MT, 2026-10-23).
      const active = stations?.list.find(entry => entry.id === stations?.active);
      const here = await homeLocation(reader, active?.place.MY_DXCC, active?.place.MY_STATE);
      const home = here ? (await placesOf(reader, [here]))[0] : undefined;
      return { ok: true, status: status(), toActivate: {
        parks: await parksToActivate(reader, locations, command.latitude !== undefined && command.longitude !== undefined
          ? { latitude: command.latitude, longitude: command.longitude } : undefined), fetchedAt: fetched ?? new Date(0).toISOString(), locations, ...(home ? { home } : {})
      } };
    }
    case 'parks-near': {
      const reader = reference?.reader();
      if (!reader || referenceStatus?.pota.parks.state !== 'loaded') {
        return { ok: false, error: 'POTA parks are not downloaded. Download them in Settings, under Reference data; after that this works offline.' };
      }
      const active = stations?.list.find(entry => entry.id === stations?.active);
      const here = await homeLocation(reader, active?.place.MY_DXCC, active?.place.MY_STATE);
      const home = here ? (await placesOf(reader, [here]))[0] : undefined;
      return { ok: true, status: status(), near: { parks: await parksNear(reader, command.latitude, command.longitude), ...(home ? { home } : {}) } };
    }
    case 'pota-places': {
      const reader = reference?.reader();
      if (!reader || referenceStatus?.pota.locations.state !== 'loaded') {
        return { ok: false, error: 'POTA\'s lists are not downloaded. Download POTA Parks in Settings, then try again.' };
      }
      return { ok: true, status: status(), places: await placesOf(reader, command.locations) };
    }
    case 'area-locations': {
      const reader = reference?.reader();
      const area = command.entries.length > 0 ? command.entries : await ownArea();
      // Without POTA's lists only a location names itself.
      if (!reader) return { ok: true, status: status(), areaLocations: area.filter(entry => /-/.test(entry)) };
      return { ok: true, status: status(), areaLocations: await areaLocations(reader, area) };
    }
    case 'adif-bands': {
      const reader = reference?.reader();
      if (!reader || referenceStatus?.adif.state !== 'loaded') {
        return { ok: false, error: 'ADIF\'s definitions are not downloaded. Download them in Settings, then try again.' };
      }
      return { ok: true, status: status(), bands: await adifBands(reader) };
    }
    case 'station-from-summit': {
      const reader = reference?.reader();
      if (!reader || referenceStatus?.sota.summits.state !== 'loaded') {
        return { ok: false, error: 'SOTA summits are not downloaded. Download them in Settings, then try again.' };
      }
      const summit = await draftFromSummit(reader, command.reference, await currentDefinitions());
      if (summit === 'not found') return { ok: false, error: 'SOTA\'s summit list has no summit with that reference.' };
      return { ok: true, status: status(), park: summit };
    }
    case 'station-from-park': {
      const reader = reference?.reader();
      if (!reader || referenceStatus?.pota.parks.state !== 'loaded') {
        return { ok: false, error: 'POTA parks are not downloaded. Download them in Settings, then try again.' };
      }
      const park = await draftFromPark(reader, command.reference, await currentDefinitions());
      if (park === 'not found') return { ok: false, error: 'POTA\'s park list has no park with that reference.' };
      return { ok: true, status: status(), park };
    }
  }
  await reloadStations();
  publish();
  return { ok: true, status: status() };
}

const publish = () => process.parentPort.postMessage({ status: status() });

// My Area when none is chosen: the active Location's entity, or its program
// (area.ts areaDefault), or none.
async function ownArea(): Promise<string[]> {
  const reader = reference?.reader();
  if (!reader || referenceStatus?.pota.parks.state !== 'loaded') return [];
  const active = stations?.list.find(entry => entry.id === stations?.active);
  const own = await areaDefault(reader, active?.place.MY_DXCC);
  return own ? [own] : [];
}

// When each source last answered, and the last attempt's problem per
// resource: what Settings needs beyond the file itself (reference-resources.ts).
let checks: Record<string, string | undefined> = {};
const problems = new Map<string, string>();

// Nothing is fetched on a clock, but "out of date" is: the status is pushed
// again every hour so a window left open says so when it becomes true.
setInterval(() => { if (state && !failed) publish(); }, 3_600_000).unref?.();

// Reference data is fetched only when the operator asks (KI7MT, 2026-10-11):
// a start fetches nothing, so it is never slowed by a download or a build.
// A request that fails is said so, and is asked again when they ask again.
async function refresh(resource: ReferenceResource, chosen: readonly string[] = []): Promise<void> {
  if (!reference || refreshing) return;
  refreshing = true;
  updating = resource;
  publish();
  try {
    // Not forced past a list's once-a-day window (#79): a list fetched inside
    // it is fresh enough, while one whose body is missing or does not match
    // its record is fetched, since the cache then has no record to trust.
    // POTA is asked conditionally, so an unchanged list costs a 304.
    // Activations are fetched for My Area alone: as chosen, or else the
    // active Location's own POTA location, as area.get answers (QGD-STN-0012).
    const area = resource !== 'activations' ? undefined : chosen.length > 0 ? chosen : await ownArea();
    const outcome = await reference.refresh({ only: resource, ...(area ? { area } : {}) });
    referenceStatus = outcome.status;
    checks = await reference.lastChecks();
    const problem = problemOf(resource, outcome);
    if (problem) problems.set(resource, problem); else problems.delete(resource);
    // Kinds and states only (QGD-ENG-0016): never a message, a path or a value.
    log.info({
      resource, problem: problem !== undefined,
      built: outcome.built, deferred: outcome.deferred === true,
      adif: outcome.adif.state, buildFailure: outcome.buildFailure?.kind,
      pota: Object.fromEntries(Object.entries(outcome.pota).map(([list, result]) =>
        [list, result.state === 'kept' ? `kept (${result.failure.kind})` : result.state])),
      // How many locations, never which: a location says where the operator is.
      ...(resource === 'activations' ? { locations: Object.keys(outcome.activations).length } : {})
    }, 'reference data');
  } catch (error) {
    problems.set(resource, 'Could not be loaded. Try again; if it keeps failing, Troubleshooting has the logs.');
    log.warn({ resource, failure: describe(reduce(error, 'build')) }, 'reference refresh failed');
  } finally {
    refreshing = false;
    updating = undefined;
    // What a station is checked against may have changed with the build.
    definitions = undefined;
    try { await reloadStations(); } catch (error) {
      log.warn({ failure: describe(reduce(error, 'query')) }, 'stations could not be read');
    }
    publish();
  }
}

async function start(): Promise<void> {
  try {
    state = await openState(paths, stateMigrations, appVersion);
    register = JSON.parse(await readFile(registerFile, 'utf8')) as Register;
    reference = new Reference({ paths, ddl: referenceDdl, register, state, fetchArchive, fetchText });
    referenceStatus = await reference.status();
    checks = await reference.lastChecks();
    await reloadStations();
    for (const callsign of heldRemovals) applyRemoval(callsign);
    heldRemovals.clear();
    if (heldActivation) { applyActivation(heldActivation); heldActivation = undefined; }
    log.info({}, 'storage ready');
  } catch (error) {
    failed = 'Storage could not be opened.';
    log.error({ failure: describe(reduce(error, 'open')) }, 'storage could not be opened');
  }
  publish();
}

function close(): void {
  try { reference?.close(); } catch { /* closing what is left */ }
  try { state?.close(); } catch { /* closing what is left */ }
  reference = undefined;
  state = undefined;
}

process.parentPort.on('message', (event) => {
  const data = event.data as {
    referenceAnswer?: unknown; id?: unknown; command?: unknown; close?: unknown;
    callsignActive?: unknown; callsignRemoved?: unknown
  };
  // From main, never from a window: the callsign made active, whose default
  // station becomes active with it (QGD-STN-0005).
  if (data?.callsignActive !== undefined) {
    if (!isCallsignId(data.callsignActive)) return;
    // Before the stores are open it is held, and applied once they are: an
    // activation is never dropped for arriving early.
    if (!state) { heldActivation = data.callsignActive; return; }
    applyActivation(data.callsignActive);
    return;
  }
  // From main: a callsign removed, whose default goes with it.
  if (data?.callsignRemoved !== undefined) {
    if (!isCallsignId(data.callsignRemoved)) return;
    if (!state) { heldRemovals.add(data.callsignRemoved); return; }
    applyRemoval(data.callsignRemoved);
    return;
  }
  if (data?.referenceAnswer !== null && typeof data?.referenceAnswer === 'object') {
    const { id, result } = data.referenceAnswer as { id?: unknown; result?: unknown };
    if (!Number.isSafeInteger(id)) return;
    const waiting = fetches.get(id as number);
    if (waiting) { fetches.delete(id as number); waiting(result); }
    return;
  }
  if (data?.close === true) {
    // Asked for at quit: every store closed cleanly, so the WAL is checkpointed
    // and nothing is left for the next start to recover.
    close();
    process.parentPort.postMessage({ closed: true });
    return;
  }
  if (!Number.isSafeInteger(data?.id)) return;
  if (!validateStorageCommand(data.command)) {
    process.parentPort.postMessage({ id: data.id, reply: { ok: false, error: 'Invalid storage request.' } });
    return;
  }
  if (data.command.type !== 'status' && data.command.type !== 'update-reference') {
    const id = data.id;
    void stationCommand(data.command)
      .catch((error: unknown): StorageReply => {
        log.warn({ command: data.command && (data.command as StorageCommand).type, failure: describe(reduce(error, 'query')) },
          'station command failed');
        return { ok: false, error: 'The location could not be changed. Troubleshooting has the logs.' };
      })
      .then((reply) => process.parentPort.postMessage({ id, reply }));
    return;
  }
  if (data.command.type === 'update-reference') {
    const resource = data.command.resource;
    if (!isReferenceResource(resource) || !register?.resources.some((entry) => entry.id === resource)) {
      process.parentPort.postMessage({ id: data.id, reply: { ok: false, error: 'There is no such reference data.' } });
      return;
    }
    if (!reference) {
      process.parentPort.postMessage({ id: data.id, reply: { ok: false, error: 'Storage is not open yet.' } });
      return;
    }
    // One at a time, and said so: a second press while one runs is refused
    // rather than acknowledged and dropped.
    if (refreshing) {
      process.parentPort.postMessage({ id: data.id, reply: { ok: false, error: 'Another update is running; try again when it finishes.' } });
      return;
    }
    // Started, not awaited: the reply says it is running, and the finished
    // status is pushed like every other change.
    // refresh() marks itself running before its first await, so the reply
    // below already says so; a second press while it runs does nothing.
    void refresh(resource, data.command.area);
  }
  const reply: StorageReply = { ok: true, status: status() };
  process.parentPort.postMessage({ id: data.id, reply });
});

process.parentPort.postMessage({ ready: true });
void start();
