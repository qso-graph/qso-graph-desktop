// SPDX-License-Identifier: GPL-3.0-only
// What the renderer may ask about storage, and what it is told (QGD-ENG-0006,
// QGD-FRM-0012).
//
// The renderer asks for status, or for the reference data to be loaded or
// updated, and nothing else: there is no engine to start or stop. Reference
// data is fetched only when asked (KI7MT, 2026-10-11: startup must be fast). Status also arrives unasked, pushed by the broker whenever it
// changes, so the screen is never polling and never stale (QGD-ENG-0006).
// QGD-SEC-0006 applies as at every boundary: checked on arrival, refused rather
// than coerced.
//
// Stations (QGD-STN-*) are kept here too, and travel in the same status, so
// the Stations page and the status bar are never polling and never stale.
import {
  isEntityCode, isNamedReferences, isSubdivisionCode, isFieldProblems, type NamedReferences, isParkDraft, isPersonaName, isPotaReference, isStationChoices, isStationDraft,
  isStationId, isStationsView, type FieldProblem, type ParkDraft, type StationChoices, type StationDraft, type StationsView
} from './station-contract.js';

export const STORAGE_STATES = ['starting', 'ready', 'failed', 'unavailable'] as const;
export type StorageState = (typeof STORAGE_STATES)[number];

export const STORAGE_CHANNEL = 'storage:request';
export const STORAGE_STATUS_CHANNEL = 'storage:status';

export interface DatasetSummary {
  state: 'loaded' | 'not loaded';
  fetchedAt?: string;
  rows?: number;
  version?: string;
}

export interface ReferenceSummary {
  adif: DatasetSummary;
  parks: DatasetSummary;
  programs: DatasetSummary;
  locations: DatasetSummary;
  // Whether a load or update is running now.
  refreshing: boolean;
  // What the operator loads and updates, one control each, in the register's
  // order (data/reference-sources.json "resources").
  resources: ResourceSummary[];
}

// One resource, as Settings lists it. Nothing is fetched until the operator
// asks (KI7MT, 2026-10-11).
export interface ResourceSummary {
  id: string;
  name: string;
  what: string;
  owner: string;
  size: string;
  state: 'loaded' | 'not loaded';
  // The oldest fetch among what it holds.
  fetchedAt?: string;
  // Loaded, but older than its refresh interval or a version behind what this
  // release pins: worth an Update.
  due: boolean;
  // Loaded, and an Update could bring something new: POTA always, ADIF only
  // when this release pins a newer version than the one installed.
  updatable: boolean;
  // ADIF only: the version installed, and the newer one this release pins.
  version?: string;
  available?: string;
  updating: boolean;
  // What went wrong with the last attempt, in words a person can act on.
  problem?: string;
}

export interface StorageStatus {
  state: StorageState;
  // The operator's own folder, where the stores are (QGD-FRM-0012). Shown so
  // a support conversation can name it; never something the renderer acts on.
  folder?: string;
  // Bytes on disk: state.sqlite with its WAL, and reference.sqlite (null when
  // there is none yet).
  sizes?: { state: number; reference: number | null };
  reference?: ReferenceSummary;
  stations?: StationsView;
  // In words a person can act on. Never a value, a path or a stack (QGD-ENG-0016).
  reason?: string;
}

export type StorageCommand =
  | { type: 'status' }
  | { type: 'update-reference'; resource: string }
  | { type: 'save-station'; station: StationDraft }
  | { type: 'delete-station'; id: string }
  | { type: 'set-default-station'; persona: string; id: string | null }
  | { type: 'set-active-station'; id: string | null }
  | { type: 'station-from-park'; reference: string }
  // The editor's pick lists, for an entity or for none.
  | { type: 'station-choices'; entity: string | null; state: string | null }
  // The names of the parks a MY_POTA_REF value names, from POTA's list.
  | { type: 'look-up-parks'; references: string };

// A refused station says which fields and why, so the editor can show each
// beside its own field. A park draft is what a station from a park would be.
export type StorageReply =
  | { ok: true; status: StorageStatus; saved?: string; park?: ParkDraft; choices?: StationChoices; named?: NamedReferences }
  | { ok: false; error: string; problems?: FieldProblem[] };

const DATASETS = ['adif', 'parks', 'programs', 'locations'] as const;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function only(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function isDataset(value: unknown): value is DatasetSummary {
  if (!record(value) || !only(value, ['state', 'fetchedAt', 'rows', 'version'])) return false;
  if (value.state !== 'loaded' && value.state !== 'not loaded') return false;
  if (value.fetchedAt !== undefined && typeof value.fetchedAt !== 'string') return false;
  if (value.rows !== undefined && !Number.isInteger(value.rows)) return false;
  return value.version === undefined || typeof value.version === 'string';
}

const RESOURCE_ID = /^[a-z][a-z0-9-]{1,30}$/;
const words = (value: unknown, limit: number) => typeof value === 'string' && value.length > 0 && value.length <= limit;

function isVersion(value: unknown): boolean {
  if (typeof value !== 'string' || value.length > 15) return false;
  const parts = value.split('.');
  return parts.length >= 2 && parts.length <= 4 && parts.every(part => /^\d{1,3}$/.test(part));
}

function isResource(value: unknown): value is ResourceSummary {
  if (!record(value) || !only(value, ['id', 'name', 'what', 'owner', 'size', 'state', 'fetchedAt', 'due', 'updatable', 'version', 'available', 'updating', 'problem'])) return false;
  return typeof value.id === 'string' && RESOURCE_ID.test(value.id)
    && words(value.name, 64) && words(value.what, 200) && words(value.owner, 64) && words(value.size, 32)
    && (value.state === 'loaded' || value.state === 'not loaded')
    && (value.fetchedAt === undefined || (typeof value.fetchedAt === 'string' && !Number.isNaN(Date.parse(value.fetchedAt))))
    && typeof value.due === 'boolean' && typeof value.updatable === 'boolean' && typeof value.updating === 'boolean'
    && (value.version === undefined || isVersion(value.version))
    && (value.available === undefined || isVersion(value.available))
    && (value.problem === undefined || (words(value.problem, 200) && !/[<>]/.test(value.problem as string)));
}

export function isStorageStatus(value: unknown): value is StorageStatus {
  if (!record(value) || !only(value, ['state', 'folder', 'sizes', 'reference', 'stations', 'reason'])) return false;
  if (!(STORAGE_STATES as readonly unknown[]).includes(value.state)) return false;
  if (value.folder !== undefined && typeof value.folder !== 'string') return false;
  if (value.reason !== undefined && typeof value.reason !== 'string') return false;
  if (value.sizes !== undefined) {
    const sizes = value.sizes;
    if (!record(sizes) || !only(sizes, ['state', 'reference']) || !Number.isInteger(sizes.state)
        || !(sizes.reference === null || Number.isInteger(sizes.reference))) return false;
  }
  if (value.reference !== undefined) {
    const reference = value.reference;
    if (!record(reference) || !only(reference, [...DATASETS, 'refreshing', 'resources'])) return false;
    if (typeof reference.refreshing !== 'boolean') return false;
    if (!Array.isArray(reference.resources) || reference.resources.length > 32 || !reference.resources.every(isResource)) return false;
    if (!DATASETS.every((name) => isDataset(reference[name]))) return false;
  }
  return value.stations === undefined || isStationsView(value.stations);
}

// A reply from the storage process, checked whole before it is read or passed
// on (QGD-SEC-0006). Null, an array, a missing field or an extra one: refused.
export function isStorageReply(value: unknown): value is StorageReply {
  if (!record(value)) return false;
  if (value.ok === true) {
    return only(value, ['ok', 'status', 'saved', 'park', 'choices', 'named']) && isStorageStatus(value.status)
      && (value.named === undefined || isNamedReferences(value.named))
      && (value.choices === undefined || isStationChoices(value.choices))
      && (value.saved === undefined || isStationId(value.saved))
      && (value.park === undefined || isParkDraft(value.park));
  }
  if (value.ok === false) {
    return only(value, ['ok', 'error', 'problems']) && typeof value.error === 'string'
      && (value.problems === undefined || isFieldProblems(value.problems));
  }
  return false;
}

// Exactly one of the commands above, with exactly its own fields. A command
// carrying a path would be the renderer choosing where the stores are, and one
// carrying a URL would be the renderer choosing what is fetched. A station
// command names a station by id and a persona by name, nothing else.
export function validateStorageCommand(value: unknown): value is StorageCommand {
  if (!record(value)) return false;
  const exactly = (keys: string[]) => only(value, keys) && keys.every((key) => key in value);
  switch (value.type) {
    case 'status': return exactly(['type']);
    case 'update-reference':
      return exactly(['type', 'resource']) && typeof value.resource === 'string' && RESOURCE_ID.test(value.resource);
    case 'save-station': return exactly(['type', 'station']) && isStationDraft(value.station);
    case 'delete-station': return exactly(['type', 'id']) && isStationId(value.id);
    case 'set-default-station':
      return exactly(['type', 'persona', 'id']) && isPersonaName(value.persona) && (value.id === null || isStationId(value.id));
    case 'set-active-station': return exactly(['type', 'id']) && (value.id === null || isStationId(value.id));
    case 'station-from-park': return exactly(['type', 'reference']) && isPotaReference(value.reference);
    case 'look-up-parks':
      return exactly(['type', 'references']) && typeof value.references === 'string' && value.references.length > 0
        && value.references.length <= 100 && /^[0-9A-Za-z@,\- ]+$/.test(value.references);
    case 'station-choices':
      return exactly(['type', 'entity', 'state']) && (value.entity === null || isEntityCode(value.entity))
        && (value.state === null || isSubdivisionCode(value.state));
    default: return false;
  }
}

export function referenceLoaded(status: StorageStatus | undefined): boolean | undefined {
  if (!status?.reference) return undefined;
  return DATASETS.some((name) => status.reference![name].state === 'loaded');
}
