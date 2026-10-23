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
import { ADIF_COLUMNS, ADIF_QUERY, ADIF_RESULTS, ADIF_TEXT, type AdifBand, type AdifEntry } from './adif-entry.js';
import { AREA_ENTITIES, AREA_LOCATION, AREA_LOCATIONS, AREA_PROGRAMS, isAreaEntry, type AreaPlace, type AreaProgram } from './area-entry.js';
import { ACTIVATION_PARKS, ACTIVATION_TEXT, type ActivationPark } from './activation-entry.js';
import {
  isEntityCode, isNamedReferences, isSubdivisionCode, isFieldProblems, type NamedReferences, isParkDraft, isCallsignId, isPotaReference, isSummitReference, isStationChoices, isStationDraft,
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
  summits: DatasetSummary;
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
  // An activations Update carries My Area as chosen, added by main from
  // settings; empty means the active Location's own (QGD-STN-0012).
  | { type: 'update-reference'; resource: string; area?: string[] }
  | { type: 'save-station'; station: StationDraft }
  | { type: 'delete-station'; id: string }
  | { type: 'set-default-station'; callsign: string; id: string | null }
  | { type: 'set-active-station'; id: string | null }
  | { type: 'station-from-park'; reference: string }
  // A location from a SOTA summit (QGD-REF-0018).
  | { type: 'station-from-summit'; reference: string }
  // ADIF's own definitions, searched for ADIF Lookup (adif-search.ts).
  | { type: 'adif-search'; query: string }
  // ADIF's bands with their edges (adif-search.ts), for an extension that
  // names a frequency's band.
  | { type: 'adif-bands' }
  // My Area's choices: POTA's programs and their locations (area.ts).
  | { type: 'area-choices' }
  // The POTA location the active Location is in, for My Area's default.
  | { type: 'area-default' }
  // My Area's parks with their activation counts (activations.ts,
  // QGD-REF-0019). The area is added by main, from settings; empty means the
  // active Location's own.
  | { type: 'parks-to-activate'; locations: string[] }
  // The POTA locations an area covers (area.ts): its entities' and programs'
  // locations, for what filters by location. Empty means the Location's own.
  | { type: 'area-locations'; entries: string[] }
  // Each location's program and entity by name (area.ts placesOf).
  | { type: 'pota-places'; locations: string[] }
  // The editor's pick lists, for an entity or for none.
  | { type: 'station-choices'; entity: string | null; state: string | null }
  // The names of the parks a MY_POTA_REF value names, from POTA's list.
  | { type: 'look-up-parks'; references: string }
  // The US counties in an area, in MY_CNTY form (QGD-STN-0010): a point when
  // south equals north and west equals east, otherwise a grid square's area.
  | { type: 'counties-at'; south: number; west: number; north: number; east: number };

// A refused station says which fields and why, so the editor can show each
// beside its own field. A park draft is what a station from a park would be.
export type StorageReply =
  | { ok: true; status: StorageStatus; saved?: string; park?: ParkDraft; choices?: StationChoices; named?: NamedReferences; counties?: string[]; sections?: Record<string, string>; adif?: AdifEntry[]; bands?: AdifBand[]; areaChoices?: AreaProgram[]; areaDefault?: string | null; toActivate?: ToActivate; areaLocations?: string[]; places?: AreaPlace[] }
  | { ok: false; error: string; problems?: FieldProblem[] };

// The parks to activate, and when the oldest of their lists was fetched.
// `locations` are the POTA locations the area covers, for the page's filter.
export interface ToActivate { parks: ActivationPark[]; fetchedAt: string; locations: string[] }

const DATASETS = ['adif', 'parks', 'programs', 'locations', 'summits'] as const;

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
// My Area on an activations Update: settings' own bounds (MAX_AREA, isAreaEntry).
const AREA_MOST = 10;
const isArea = (value: unknown) => Array.isArray(value) && value.length <= AREA_MOST && value.every(isAreaEntry);
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

// ADIF's text as QG Storage answers a search (adif-search.ts): bounded as the
// search bounds it, so what passes here is what the search can send.
const adifText = (value: unknown) => typeof value === 'string' && value.length <= ADIF_TEXT;
function isAdifEntries(value: unknown): value is AdifEntry[] {
  return Array.isArray(value) && value.length <= ADIF_RESULTS && value.every(entry => record(entry)
    && only(entry, ['list', 'key', 'columns']) && adifText(entry.list) && adifText(entry.key)
    && Array.isArray(entry.columns) && entry.columns.length <= ADIF_COLUMNS
    && entry.columns.every(column => record(column) && only(column, ['name', 'value']) && adifText(column.name) && adifText(column.value)));
}

// ADIF's bands (adif-search.ts): ADIF 3.1.7 has 33; room is left for more.
function isAdifBands(value: unknown): value is AdifBand[] {
  return Array.isArray(value) && value.length <= 100 && value.every(band => record(band)
    && only(band, ['band', 'lowerMHz', 'upperMHz']) && typeof band.band === 'string' && band.band.length <= 16
    && typeof band.lowerMHz === 'number' && Number.isFinite(band.lowerMHz)
    && typeof band.upperMHz === 'number' && Number.isFinite(band.upperMHz) && band.upperMHz >= band.lowerMHz);
}

// My Area's choices and default (area.ts), bounded as the store bounds them.
const areaText = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= 120 && !/[<>]/.test(value);
const isLocationCodes = (value: unknown) => Array.isArray(value) && value.length <= AREA_LOCATIONS
  && value.every(code => typeof code === 'string' && AREA_LOCATION.test(code));
function isAreaChoices(value: unknown): value is AreaProgram[] {
  return Array.isArray(value) && value.length <= AREA_PROGRAMS && value.every(program => record(program)
    && only(program, ['prefix', 'name', 'entities']) && typeof program.prefix === 'string' && /^[A-Z0-9]{1,4}$/.test(program.prefix)
    && areaText(program.name) && Array.isArray(program.entities) && program.entities.length <= AREA_ENTITIES
    && program.entities.every(entity => record(entity) && only(entity, ['id', 'name', 'locations'])
      && typeof entity.id === 'string' && /^[0-9]{1,3}$/.test(entity.id) && areaText(entity.name)
      && Array.isArray(entity.locations) && entity.locations.length <= AREA_LOCATIONS
      && entity.locations.every(location => record(location) && only(location, ['code', 'name'])
        && typeof location.code === 'string' && AREA_LOCATION.test(location.code) && areaText(location.name))));
}

// The parks to activate (activations.ts), bounded as the store bounds them.
const activationText = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= ACTIVATION_TEXT;
function isToActivate(value: unknown): value is ToActivate {
  return record(value) && only(value, ['parks', 'fetchedAt', 'locations']) && isLocationCodes(value.locations)
    && typeof value.fetchedAt === 'string' && !Number.isNaN(Date.parse(value.fetchedAt))
    && Array.isArray(value.parks) && value.parks.length <= ACTIVATION_PARKS && value.parks.every(park => record(park)
      && only(park, ['reference', 'name', 'latitude', 'longitude', 'locations', 'activations'])
      && activationText(park.reference) && activationText(park.name) && activationText(park.locations)
      && typeof park.latitude === 'number' && Math.abs(park.latitude) <= 90
      && typeof park.longitude === 'number' && Math.abs(park.longitude) <= 180
      && (park.activations === null || (Number.isSafeInteger(park.activations) && (park.activations as number) >= 0)));
}

// A reply from the storage process, checked whole before it is read or passed
// on (QGD-SEC-0006). Null, an array, a missing field or an extra one: refused.
export function isStorageReply(value: unknown): value is StorageReply {
  if (!record(value)) return false;
  if (value.ok === true) {
    // adif and bands were missing here, so every ADIF search and band list
    // QG Storage answered was refused as malformed; each layer's own tests
    // passed (found by KI7MT, 2026-10-23: Parks On the Air showed no bands).
    return only(value, ['ok', 'status', 'saved', 'park', 'choices', 'named', 'counties', 'sections', 'adif', 'bands', 'areaChoices', 'areaDefault', 'toActivate', 'areaLocations', 'places']) && isStorageStatus(value.status)
      && (value.places === undefined || (Array.isArray(value.places) && value.places.length <= AREA_LOCATIONS && value.places.every(place => record(place)
        && only(place, ['location', 'program', 'entity']) && typeof place.location === 'string' && AREA_LOCATION.test(place.location)
        && areaText(place.program) && areaText(place.entity))))
      && (value.areaLocations === undefined || isLocationCodes(value.areaLocations))
      && (value.toActivate === undefined || isToActivate(value.toActivate))
      && (value.areaChoices === undefined || isAreaChoices(value.areaChoices))
      && (value.areaDefault === undefined || value.areaDefault === null || isAreaEntry(value.areaDefault))
      && (value.adif === undefined || isAdifEntries(value.adif))
      && (value.bands === undefined || isAdifBands(value.bands))
      && (value.sections === undefined || (typeof value.sections === 'object' && value.sections !== null && !Array.isArray(value.sections)
        && Object.keys(value.sections).length <= 200
        && Object.entries(value.sections).every(([county, code]) => county.length <= 64 && typeof code === 'string' && /^[A-Z]{1,4}$/.test(code))))
      && (value.counties === undefined || (Array.isArray(value.counties) && value.counties.length <= 200
        && value.counties.every(county => typeof county === 'string' && county.length <= 64)))
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
// command names a station by id and a callsign by name, nothing else.
// A search as ADIF Lookup sends one: short, plain, and not empty.
function plainQuery(value: unknown): boolean {
  if (typeof value !== 'string' || value.trim() === '' || value.length > ADIF_QUERY || /[<>]/.test(value)) return false;
  for (let at = 0; at < value.length; at += 1) {
    const code = value.charCodeAt(at);
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
}

export function validateStorageCommand(value: unknown): value is StorageCommand {
  if (!record(value)) return false;
  const exactly = (keys: string[]) => only(value, keys) && keys.every((key) => key in value);
  switch (value.type) {
    case 'status': return exactly(['type']);
    case 'update-reference':
      return (exactly(['type', 'resource']) || exactly(['type', 'resource', 'area']))
        && typeof value.resource === 'string' && RESOURCE_ID.test(value.resource)
        && (value.area === undefined || isArea(value.area));
    case 'save-station': return exactly(['type', 'station']) && isStationDraft(value.station);
    case 'delete-station': return exactly(['type', 'id']) && isStationId(value.id);
    case 'set-default-station':
      return exactly(['type', 'callsign', 'id']) && isCallsignId(value.callsign) && (value.id === null || isStationId(value.id));
    case 'set-active-station': return exactly(['type', 'id']) && (value.id === null || isStationId(value.id));
    case 'station-from-park': return exactly(['type', 'reference']) && isPotaReference(value.reference);
    case 'station-from-summit': return exactly(['type', 'reference']) && isSummitReference(value.reference);
    case 'adif-search': return exactly(['type', 'query']) && plainQuery(value.query);
    case 'adif-bands': return exactly(['type']);
    case 'area-choices': return exactly(['type']);
    case 'area-default': return exactly(['type']);
    case 'parks-to-activate':
      return exactly(['type', 'locations']) && isArea(value.locations);
    case 'area-locations': return exactly(['type', 'entries']) && isArea(value.entries);
    case 'pota-places': return exactly(['type', 'locations']) && isLocationCodes(value.locations);
    case 'look-up-parks':
      return exactly(['type', 'references']) && typeof value.references === 'string' && value.references.length > 0
        && value.references.length <= 100 && /^[0-9A-Za-z@,\- ]+$/.test(value.references);
    case 'station-choices':
      return exactly(['type', 'entity', 'state']) && (value.entity === null || isEntityCode(value.entity))
        && (value.state === null || isSubdivisionCode(value.state));
    case 'counties-at': {
      // At most a 4-character grid square, 2 by 1 degrees: what a Location's
      // grid can be, and a bound on the work one command can ask for.
      const { south, west, north, east } = value;
      return exactly(['type', 'south', 'west', 'north', 'east'])
        && [south, west, north, east].every(number => typeof number === 'number' && Number.isFinite(number))
        && (south as number) >= -90 && (north as number) <= 90 && (west as number) >= -180 && (east as number) <= 180
        && (south as number) <= (north as number) && (west as number) <= (east as number)
        && (north as number) - (south as number) <= 1 && (east as number) - (west as number) <= 2;
    }
    default: return false;
  }
}

export function referenceLoaded(status: StorageStatus | undefined): boolean | undefined {
  if (!status?.reference) return undefined;
  return DATASETS.some((name) => status.reference![name].state === 'loaded');
}
