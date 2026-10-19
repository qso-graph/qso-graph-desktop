// SPDX-License-Identifier: GPL-3.0-only
// Stations as they cross a process boundary (QGD-STN-*, QGD-SEC-0006).
//
// A station is a name, a kind, ADIF's own MY_* fields under ADIF's names, and
// TQSL's park, which ADIF has no field for. Nothing else: no callsign, which
// is the active persona's (QGD-STN-0009), and no GPS field, which ADIF does not
// have (QGD-STN-0007). What a value may be is ADIF's to say and is checked in
// stations.ts against the loaded definitions; what is checked here is only the
// shape, so nothing off it is passed on.

// Home, Portable, Mobile or Remote: a label the operator picks and nothing
// more (QGD-STN-0004).
export const STATION_KINDS = ['Home', 'Portable', 'Mobile', 'Remote'] as const;
export type StationKind = (typeof STATION_KINDS)[number];

// The ADIF fields a station holds (QGD-STN-0002), in the order the editor
// shows them: the place, the activity references, then the address, which is
// the operator's own and optional (QGD-STN-0003).
export const STATION_FIELDS = [
  'MY_GRIDSQUARE', 'MY_GRIDSQUARE_EXT', 'MY_VUCC_GRIDS', 'MY_LAT', 'MY_LON', 'MY_ALTITUDE',
  'MY_DXCC', 'MY_CQ_ZONE', 'MY_ITU_ZONE', 'MY_STATE', 'MY_CNTY', 'MY_ARRL_SECT',
  'MY_POTA_REF', 'MY_SOTA_REF', 'MY_WWFF_REF', 'MY_IOTA',
  'MY_STREET', 'MY_CITY', 'MY_POSTAL_CODE'
] as const;
export type StationField = (typeof STATION_FIELDS)[number];

// The address fields, which never reach an extension or anything outbound
// (QGD-STN-0003).
export const ADDRESS_FIELDS: readonly StationField[] = ['MY_STREET', 'MY_CITY', 'MY_POSTAL_CODE'];

export type Place = Partial<Record<StationField, string>>;

export interface Station {
  id: string;
  name: string;
  kind?: StationKind;
  place: Place;
  lotwPark?: string;
}

// What the editor sends: a station without an id is a new one.
export interface StationDraft {
  id?: string;
  name: string;
  kind?: StationKind;
  place: Place;
  lotwPark?: string;
}

export interface StationsView {
  list: Station[];
  // Persona name to station id (QGD-STN-0005).
  defaults: Record<string, string>;
  active: string | null;
  // Whether ADIF's definitions were there to check values against.
  checked: boolean;
}

export interface FieldProblem {
  field: string;
  reason: string;
}

// A station started from a POTA park, for the operator to change before
// saving (QGD-STN-0006).
export interface ParkDraft {
  draft: StationDraft;
  // Said when the park's coordinates could not be used.
  note?: string;
}

export const MAX_STATIONS = 500;
export const MAX_NAME = 64;
export const MAX_VALUE = 100;
export const MAX_PERSONA = 64;

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PARK_CODE = /^[A-Z]{2}[0-9]{2}$/;
const POTA_REFERENCE = /^[0-9A-Z]{1,4}-[0-9]{4,5}$/;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function only(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every(key => keys.includes(key));
}

// Printable text with nothing that could be read as markup, of a bounded
// length. ADIF's String is printable ASCII; the address fields may be typed in
// any script, so they are not narrowed here, only bounded.
function text(value: unknown, max: number): value is string {
  if (typeof value !== 'string' || value.length > max || /[<>]/.test(value)) return false;
  for (let at = 0; at < value.length; at += 1) {
    const code = value.charCodeAt(at);
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
}

export function isStationId(value: unknown): value is string {
  return typeof value === 'string' && ID.test(value);
}

export function isName(value: unknown): value is string {
  return text(value, MAX_NAME) && value.trim().length > 0;
}

export function isPersonaName(value: unknown): value is string {
  return text(value, MAX_PERSONA) && value.length > 0;
}

// TQSL's park codes are two letters and two digits, joined by commas where a
// location is in more than one (`NP33,WR01`); TQSL holds at most 40 characters.
export function isLotwPark(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 40) return false;
  return value.split(',').every(code => PARK_CODE.test(code));
}

export function isPotaReference(value: unknown): value is string {
  return typeof value === 'string' && POTA_REFERENCE.test(value);
}

function isPlace(value: unknown): value is Place {
  if (!record(value) || !only(value, STATION_FIELDS)) return false;
  return Object.values(value).every(entry => text(entry, MAX_VALUE) && entry.length > 0);
}

function isKind(value: unknown): value is StationKind {
  return (STATION_KINDS as readonly unknown[]).includes(value);
}

function stationShape(value: Record<string, unknown>): boolean {
  return isName(value.name) && isPlace(value.place)
    && (value.kind === undefined || isKind(value.kind))
    && (value.lotwPark === undefined || isLotwPark(value.lotwPark));
}

export function isStation(value: unknown): value is Station {
  return record(value) && only(value, ['id', 'name', 'kind', 'place', 'lotwPark'])
    && isStationId(value.id) && stationShape(value);
}

export function isStationDraft(value: unknown): value is StationDraft {
  return record(value) && only(value, ['id', 'name', 'kind', 'place', 'lotwPark'])
    && (value.id === undefined || isStationId(value.id)) && stationShape(value);
}

export function isStationsView(value: unknown): value is StationsView {
  if (!record(value) || !only(value, ['list', 'defaults', 'active', 'checked'])) return false;
  if (!Array.isArray(value.list) || value.list.length > MAX_STATIONS || !value.list.every(isStation)) return false;
  if (!record(value.defaults) || Object.keys(value.defaults).length > MAX_STATIONS) return false;
  if (!Object.entries(value.defaults).every(([persona, id]) => isPersonaName(persona) && isStationId(id))) return false;
  return (value.active === null || isStationId(value.active)) && typeof value.checked === 'boolean';
}

export function isFieldProblems(value: unknown): value is FieldProblem[] {
  return Array.isArray(value) && value.length <= STATION_FIELDS.length + 3 && value.every(entry =>
    record(entry) && only(entry, ['field', 'reason']) && text(entry.field, 32) && text(entry.reason, 300));
}

export function isParkDraft(value: unknown): value is ParkDraft {
  return record(value) && only(value, ['draft', 'note']) && isStationDraft(value.draft)
    && (value.note === undefined || text(value.note, 300));
}
