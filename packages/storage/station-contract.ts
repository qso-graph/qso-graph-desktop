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

// What the editor's pick lists offer, from ADIF's own enumerations: the code
// a station stores and the name ADIF gives it, as ADIF writes it.
export interface Choice {
  code: string;
  name: string;
}

export interface StationChoices {
  // Every DXCC entity ADIF has not deleted.
  entities: Choice[];
  // The entity's primary subdivisions, ARRL sections and secondary
  // subdivisions, where ADIF lists them; empty where it lists none.
  states: Choice[];
  sections: Choice[];
  counties: Choice[];
  // The zones a station may be in: the chosen state's own, where ADIF gives
  // them, otherwise ADIF's whole range for the field (CQ 1–40, ITU 1–90).
  cqZones: Choice[];
  ituZones: Choice[];
}

export const MAX_CHOICES = 2000;

export const MAX_STATIONS = 500;
export const MAX_NAME = 64;
export const MAX_VALUE = 100;
// The persona contract's own limit for a persona's name (persona-contract.ts).
export const MAX_PERSONA = 128;

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

function isChoices(value: unknown): value is Choice[] {
  return Array.isArray(value) && value.length <= MAX_CHOICES && value.every(entry =>
    record(entry) && only(entry, ['code', 'name']) && text(entry.code, 64) && entry.code.length > 0 && text(entry.name, 200));
}

export function isStationChoices(value: unknown): value is StationChoices {
  return record(value) && only(value, ['entities', 'states', 'sections', 'counties', 'cqZones', 'ituZones'])
    && isChoices(value.entities) && isChoices(value.states) && isChoices(value.sections) && isChoices(value.counties)
    && isChoices(value.cqZones) && isChoices(value.ituZones);
}

// A DXCC entity code as ADIF writes it: a whole number.
export function isEntityCode(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9]{1,3}$/.test(value);
}

// A primary subdivision's code as ADIF writes it: short and plain.
export function isSubdivisionCode(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9A-Za-z-]{1,8}$/.test(value);
}

// ---- latitude and longitude ----------------------------------------------
// ADIF writes a position as "XDDD MM.MMM", hemisphere first, which nobody
// types. The editor takes decimal degrees and the station keeps ADIF's form.

// ADIF's Location: "XDDD MM.MMM", hemisphere first.
export function adifLocation(degrees: number, axis: 'lat' | 'lon'): string | undefined {
  if (!Number.isFinite(degrees) || Math.abs(degrees) > (axis === 'lat' ? 90 : 180)) return undefined;
  const hemisphere = axis === 'lat' ? (degrees < 0 ? 'S' : 'N') : (degrees < 0 ? 'W' : 'E');
  const whole = Math.abs(degrees);
  let degreePart = Math.floor(whole);
  let minutes = Math.round((whole - degreePart) * 60 * 1000) / 1000;
  if (minutes >= 60) { degreePart += 1; minutes = 0; }
  return `${hemisphere}${String(degreePart).padStart(3, '0')} ${minutes.toFixed(3).padStart(6, '0')}`;
}

// ADIF's Location, "XDDD MM.MMM", to signed decimal degrees.
export function fromAdifLocation(value: string | undefined): number | undefined {
  if (!value || value.length !== 11) return undefined;
  const hemisphere = value[0].toUpperCase();
  const degrees = Number(value.slice(1, 4));
  const minutes = Number(value.slice(5));
  if (!'NSEW'.includes(hemisphere) || !Number.isFinite(degrees) || !Number.isFinite(minutes) || minutes >= 60) return undefined;
  const magnitude = degrees + minutes / 60;
  if (magnitude > ((hemisphere === 'N' || hemisphere === 'S') ? 90 : 180)) return undefined;
  return hemisphere === 'S' || hemisphere === 'W' ? -magnitude : magnitude;
}

// What an operator types for a latitude or longitude: decimal degrees, as
// 43.625 or -116.2083, or ADIF's own form. Undefined: neither.
export function typedLocation(value: string, axis: 'lat' | 'lon'): string | undefined {
  const typed = value.trim();
  if (fromAdifLocation(typed) !== undefined) {
    const hemisphere = typed[0].toUpperCase();
    return (axis === 'lat') === (hemisphere === 'N' || hemisphere === 'S') ? typed.toUpperCase() : undefined;
  }
  const [whole, fraction, ...rest] = typed.replace(/^[+-]/, '').split('.');
  if (rest.length > 0 || !/^[0-9]{1,3}$/.test(whole) || (fraction !== undefined && !/^[0-9]{1,8}$/.test(fraction))) return undefined;
  return adifLocation(Number(typed), axis);
}

// What the editor shows beside a reference: whether its list was there to
// check against, and the entries found in it, with their names.
export interface NamedReferences {
  checked: boolean;
  found: Choice[];
}

export function isNamedReferences(value: unknown): value is NamedReferences {
  return record(value) && only(value, ['checked', 'found']) && typeof value.checked === 'boolean'
    && Array.isArray(value.found) && value.found.length <= 16 && value.found.every(entry =>
      record(entry) && only(entry, ['code', 'name']) && text(entry.code, 64) && text(entry.name, 200));
}

// The centre of a 2, 4, 6 or 8 character Maidenhead locator. Undefined for
// anything else: the grid was checked against ADIF's definition when it was
// saved, so this is a second line, not the first.
export function gridCentre(grid: string | undefined): { latitude: number; longitude: number } | undefined {
  if (!grid || grid.length % 2 !== 0 || grid.length < 2 || grid.length > 8) return undefined;
  const upper = grid.toUpperCase();
  let longitude = -180;
  let latitude = -90;
  // Each pair halves into finer cells: fields 20°×10°, squares 2°×1°,
  // subsquares 5'×2.5', extended squares 30"×15".
  const sizes = [[20, 10], [2, 1], [2 / 24, 1 / 24], [2 / 240, 1 / 240]];
  for (let pair = 0; pair < upper.length / 2; pair += 1) {
    const [width, height] = sizes[pair];
    const a = upper[pair * 2];
    const b = upper[pair * 2 + 1];
    const letters = pair % 2 === 0;
    const x = letters ? a.charCodeAt(0) - 65 : Number(a);
    const y = letters ? b.charCodeAt(0) - 65 : Number(b);
    const limit = pair === 0 ? 18 : letters ? 24 : 10;
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= limit || y >= limit) return undefined;
    longitude += x * width;
    latitude += y * height;
  }
  const [width, height] = sizes[upper.length / 2 - 1];
  return { latitude: latitude + height / 2, longitude: longitude + width / 2 };
}

// The position a grid gives: the centre of one grid, or for the grids of a
// line or corner ("DN13,DN14") the middle of their centres, which is the line
// or the corner itself. Longitudes are unwrapped against the first before they
// are averaged, so a pair across the date line (RJ90,AJ00) lands on it.
export function gridPosition(grid: string | undefined): { latitude: number; longitude: number } | undefined {
  if (!grid) return undefined;
  const centres = grid.split(',').map(entry => gridCentre(entry.trim()));
  if (centres.length === 0 || centres.some(centre => centre === undefined)) return undefined;
  const known = centres as { latitude: number; longitude: number }[];
  const first = known[0].longitude;
  const unwrapped = known.map(centre => centre.longitude - 360 * Math.round((centre.longitude - first) / 360));
  let longitude = unwrapped.reduce((sum, value) => sum + value, 0) / known.length;
  if (longitude > 180) longitude -= 360;
  if (longitude <= -180) longitude += 360;
  return { latitude: known.reduce((sum, centre) => sum + centre.latitude, 0) / known.length, longitude };
}
