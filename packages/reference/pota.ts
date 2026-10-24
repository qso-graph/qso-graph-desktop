// SPDX-License-Identifier: GPL-3.0-only
// Reading POTA's three lists, and checking their shape before anything is
// replaced.
//
// QGD-REF-0009 to QGD-REF-0013. Pure: these functions take text and return
// rows, so the shape checks can be tested without a network or a database.
// Fetching and loading are pota-load.ts.
//
// The one decision that shapes all of it: **a published value is stored as
// published and never corrected** (QGD-REF-0011). A row POTA publishes wrong
// is stored as POTA publishes it and flagged, so the flag is this product's
// opinion and the value stays POTA's record. Nothing here repairs a
// coordinate, drops a retired park, or decides what POTA meant.

export interface Park {
  reference: string;
  name: string;
  active: boolean;
  // POTA's own entity number, which is not ADIF's DXCC code (QGD-REF-0012).
  entityId: number | null;
  // As published: a comma-separated list where a park is in more than one.
  locationDesc: string;
  // The locations split out, one per row (QGD-REF-0013).
  locations: string[];
  latitude: number | null;
  longitude: number | null;
  grid: string | null;
  coordinatesUsable: boolean;
  coordinatesNote: string | null;
  isTest: boolean;
}

export interface Program {
  programId: number;
  prefix: string;
  name: string;
  active: boolean;
  isoCountry: string | null;
  locationUnit: string | null;
  isoLanguage: string | null;
}

export interface Location {
  locationId: number;
  entityId: number | null;
  entityName: string | null;
  locationDesc: string;
  locationName: string | null;
  latitude: number | null;
  longitude: number | null;
  iso: string | null;
}

// What a load is refused for. A list that fails any of these leaves the
// previous load in place (QGD-REF-0010).
export class ShapeError extends Error {}

// ---------------------------------------------------------------------------
// CSV
//
// Written out rather than taken from a library, because the one thing this has
// to get right is a comma inside a quoted field — which is exactly what
// locationDesc holds for the 1,618 parks in more than one location, and what a
// split on commas would turn into an extra column.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let started = false;

  const endField = () => { row.push(field); field = ''; started = false; };
  const endRow = () => { endField(); rows.push(row); row = []; };

  for (let at = 0; at < text.length; at += 1) {
    const character = text[at];
    if (quoted) {
      if (character === '"') {
        // A doubled quote inside a quoted field is one quote.
        if (text[at + 1] === '"') { field += '"'; at += 1; } else quoted = false;
      } else field += character;
      continue;
    }
    if (character === '"' && !started) { quoted = true; started = true; continue; }
    if (character === ',') { endField(); continue; }
    if (character === '\n') { endRow(); continue; }
    if (character === '\r') continue;
    field += character;
    started = true;
  }
  // A file that does not end in a newline still has a last row.
  if (field !== '' || row.length) endRow();
  return rows;
}

function number(cell: string | undefined): number | null {
  if (cell === undefined || cell.trim() === '') return null;
  const value = Number(cell);
  return Number.isFinite(value) ? value : null;
}

function text(cell: string | undefined): string | null {
  return cell === undefined || cell.trim() === '' ? null : cell;
}

// An integer out of JSON, where a field can be null.
//
// Not Number(): Number(null) is 0, and 0 is a DXCC entity code — ADIF's
// "None" — so a location POTA publishes with no entity would be stored as
// being in entity 0, which is a different claim from "POTA does not say".
function integerOf(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

// A reference like `K-TEST` or `VE-TEST`: POTA's own test park, which is not a
// place and must not reach a user (QGD-REF-0011). Matched by shape rather than
// by naming one reference, so another program's test park is caught too.
const TEST_REFERENCE = /^[0-9A-Z]{1,4}-TEST$/;

export const PARK_COLUMNS = [
  'reference', 'name', 'active', 'entityId', 'locationDesc', 'latitude', 'longitude', 'grid'
] as const;

export interface ParkList {
  parks: Park[];
  // Counted while reading, so the suite compares against the list rather than
  // against numbers written down here.
  counts: {
    rows: number; active: number; retired: number; noEntity: number;
    multipleLocations: number; noCoordinates: number; impossibleCoordinates: number; test: number;
  };
}

export function readParks(csv: string, expected: readonly string[] = PARK_COLUMNS): ParkList {
  const rows = parseCsv(csv);
  if (rows.length === 0) throw new ShapeError('the park list is empty');
  const header = rows[0];
  // The columns, exactly: a list with a column added or removed is a list this
  // product has not been told how to read, and reading it anyway is how the
  // wrong column ends up in the wrong place.
  if (header.length !== expected.length || header.some((name, at) => name !== expected[at])) {
    throw new ShapeError(`the park list's columns are ${header.join(', ')}; expected ${expected.join(', ')}`);
  }
  const body = rows.slice(1).filter(row => row.length > 1 || (row[0] ?? '') !== '');
  if (body.length === 0) throw new ShapeError('the park list has a header and no parks');

  const parks: Park[] = [];
  const seen = new Set<string>();
  const counts = {
    rows: body.length, active: 0, retired: 0, noEntity: 0,
    multipleLocations: 0, noCoordinates: 0, impossibleCoordinates: 0, test: 0
  };

  for (const [at, row] of body.entries()) {
    if (row.length !== expected.length) {
      throw new ShapeError(`park row ${at + 2} has ${row.length} fields, not ${expected.length}`);
    }
    const reference = row[0].trim();
    if (reference === '') throw new ShapeError(`park row ${at + 2} has no reference`);
    if (seen.has(reference)) throw new ShapeError(`${reference} appears twice`);
    seen.add(reference);

    const active = row[2].trim();
    if (active !== '0' && active !== '1') {
      throw new ShapeError(`${reference} publishes active as "${active}", which is neither 0 nor 1`);
    }

    const latitude = number(row[5]);
    const longitude = number(row[6]);
    const coordinates = judgeCoordinates(latitude, longitude);
    const locationDesc = row[4];
    const locations = locationDesc.split(',').map(part => part.trim()).filter(Boolean);
    const isTest = TEST_REFERENCE.test(reference.toUpperCase());

    if (active === '1') counts.active += 1; else counts.retired += 1;
    if (number(row[3]) === null) counts.noEntity += 1;
    if (locations.length > 1) counts.multipleLocations += 1;
    if (latitude === null || longitude === null) counts.noCoordinates += 1;
    else if (!coordinates.usable) counts.impossibleCoordinates += 1;
    if (isTest) counts.test += 1;

    parks.push({
      reference,
      name: row[1],
      active: active === '1',
      entityId: number(row[3]),
      locationDesc,
      locations,
      latitude,
      longitude,
      grid: text(row[7]),
      coordinatesUsable: coordinates.usable,
      coordinatesNote: coordinates.note,
      isTest
    });
  }

  return { parks, counts };
}

// Whether a pair of coordinates can be used to measure or map with. Four parks
// publish a latitude beyond the poles, one of them with the latitude and
// longitude plainly transposed — and guessing that is still guessing, so the
// pair is kept as published and the note says what is wrong with it.
export function judgeCoordinates(
  latitude: number | null,
  longitude: number | null
): { usable: boolean; note: string | null } {
  if (latitude === null || longitude === null) {
    return { usable: false, note: 'POTA publishes no coordinates for this park' };
  }
  if (latitude < -90 || latitude > 90) {
    return {
      usable: false,
      note: `POTA publishes a latitude of ${latitude}, which is beyond the poles; stored as published`
    };
  }
  if (longitude < -180 || longitude > 180) {
    return {
      usable: false,
      note: `POTA publishes a longitude of ${longitude}, which is beyond 180; stored as published`
    };
  }
  return { usable: true, note: null };
}

// ---------------------------------------------------------------------------
// The two JSON lists.

function asArray(json: string, what: string): unknown[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new ShapeError(`the ${what} list is not JSON: ${(error as Error).message.slice(0, 80)}`);
  }
  if (!Array.isArray(parsed)) throw new ShapeError(`the ${what} list is not an array`);
  if (parsed.length === 0) throw new ShapeError(`the ${what} list is empty`);
  return parsed;
}

// Every field named, present on the first row. A list that has lost a field is
// one this product would read as nulls, which is worse than refusing it.
function requireFields(row: Record<string, unknown>, fields: readonly string[], what: string): void {
  const missing = fields.filter(field => !(field in row));
  if (missing.length) throw new ShapeError(`a ${what} is missing ${missing.join(', ')}`);
}

export const PROGRAM_FIELDS = [
  'programId', 'programPrefix', 'programName', 'isActive', 'isocc', 'location_unit', 'isolang'
] as const;

// Each id once. The stores key on it, so a list repeating one could be cached
// and then fail to build; it is refused here, as its shape, instead.
function unique<T>(rows: T[], id: (row: T) => number, what: string): T[] {
  const seen = new Set<number>();
  for (const row of rows) {
    const value = id(row);
    if (seen.has(value)) throw new ShapeError(`the ${what} list repeats an id`);
    seen.add(value);
  }
  return rows;
}

export function readPrograms(json: string): Program[] {
  const rows = asArray(json, 'program') as Record<string, unknown>[];
  requireFields(rows[0], PROGRAM_FIELDS, 'program');
  return unique(rows.map((row, at) => {
    const programId = integerOf(row.programId);
    if (programId === null) throw new ShapeError(`program ${at + 1} has no programId`);
    const prefix = String(row.programPrefix ?? '').trim();
    if (prefix === '') throw new ShapeError(`program ${programId} has no prefix`);
    return {
      programId,
      prefix,
      name: String(row.programName ?? ''),
      // POTA publishes this as 1 or 0, not as a boolean.
      active: Number(row.isActive) === 1,
      isoCountry: row.isocc === null || row.isocc === undefined ? null : String(row.isocc),
      locationUnit: row.location_unit === null || row.location_unit === undefined
        ? null : String(row.location_unit),
      isoLanguage: row.isolang === null || row.isolang === undefined ? null : String(row.isolang)
    };
  }), (program) => program.programId, 'program');
}

export const LOCATION_FIELDS = [
  'locationId', 'entityId', 'entityName', 'locationDesc', 'locationName', 'latitude', 'longitude', 'iso'
] as const;

export function readLocations(json: string): Location[] {
  const rows = asArray(json, 'location') as Record<string, unknown>[];
  requireFields(rows[0], LOCATION_FIELDS, 'location');
  return unique(rows.map((row, at) => {
    const locationId = integerOf(row.locationId);
    if (locationId === null) throw new ShapeError(`location ${at + 1} has no locationId`);
    const locationDesc = String(row.locationDesc ?? '').trim();
    if (locationDesc === '') throw new ShapeError(`location ${locationId} has no locationDesc`);
    return {
      locationId,
      entityId: integerOf(row.entityId),
      entityName: row.entityName === null || row.entityName === undefined ? null : String(row.entityName),
      locationDesc,
      locationName: row.locationName === null || row.locationName === undefined
        ? null : String(row.locationName),
      latitude: typeof row.latitude === 'number' && Number.isFinite(row.latitude) ? row.latitude : null,
      longitude: typeof row.longitude === 'number' && Number.isFinite(row.longitude) ? row.longitude : null,
      iso: row.iso === null || row.iso === undefined ? null : String(row.iso)
    };
  }), (location) => location.locationId, 'location');
}

// A load that arrives a fraction of the size of the one before it is a
// truncated download, which is a shape problem rather than a day's worth of
// retirements. The previous load stays (QGD-REF-0010).
export const SHRINK_FLOOR = 0.5;

export function refuseIfShrunk(what: string, arrived: number, before: number | undefined): void {
  if (before === undefined || before === 0) return;
  if (arrived < before * SHRINK_FLOOR) {
    throw new ShapeError(
      `the ${what} list arrived with ${arrived} rows where the last load had ${before}; ` +
      'refused as a truncated download');
  }
}

// ---------------------------------------------------------------------------
// A location's activations (QGD-REF-0019): POTA's park list for one location,
// of which only the reference and the activation count are kept. A park POTA
// has never seen attempted publishes its count as null, and null it stays
// (QGD-REF-0011): "nobody has tried" is POTA's record, not a zero this
// product decided on.

export interface Activation {
  reference: string;
  activations: number | null;
}

export const ACTIVATION_FIELDS = ['reference', 'activations'] as const;

export function readActivations(json: string): Activation[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new ShapeError(`the activations list is not JSON: ${(error as Error).message.slice(0, 80)}`);
  }
  if (!Array.isArray(parsed)) throw new ShapeError('the activations list is not an array');
  // A location can lose its last active park, so an empty list is a list;
  // a truncated one is caught by the shrink check, as for every list.
  if (parsed.length > 0) requireFields(parsed[0] as Record<string, unknown>, ACTIVATION_FIELDS, 'park');
  const seen = new Set<string>();
  return (parsed as Record<string, unknown>[]).map((row, at) => {
    if (typeof row !== 'object' || row === null) throw new ShapeError(`park ${at + 1} is not an object`);
    const reference = typeof row.reference === 'string' ? row.reference.trim() : '';
    if (reference === '') throw new ShapeError(`park ${at + 1} has no reference`);
    if (seen.has(reference)) throw new ShapeError('the activations list repeats a park');
    seen.add(reference);
    const activations = row.activations === null || row.activations === undefined ? null : integerOf(row.activations);
    if (activations === null && row.activations !== null && row.activations !== undefined) {
      throw new ShapeError(`park ${at + 1} publishes activations that are not a whole number`);
    }
    if (activations !== null && activations < 0) throw new ShapeError(`park ${at + 1} publishes fewer than no activations`);
    return { reference, activations };
  });
}
