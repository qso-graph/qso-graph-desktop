// SPDX-License-Identifier: GPL-3.0-only
// Stations in state.sqlite (QGD-STN-0001–0009), kept by QG Storage.
//
// A value is checked against ADIF's definitions as loaded, by the same
// validator a QSO is checked by (QGD-REF-0005), so no rule for a grid, a zone
// or a county is written here. A refused value is refused with ADIF's reason
// and never altered to fit (QGD-STN-0002). Without the definitions a station
// still saves, and the answer says its values could not be checked.
import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import { validateRecord, type Ruleset } from '../reference/validate.js';
import { potaPark, potaParkLocation, type referenceSchema } from './reference-schema.js';
import { ACTIVE_STATION_ID, activeStation, station, stationDefault, type stateSchema } from './schema.js';
import type { Store } from './sqlite.js';
import {
  MAX_STATIONS, STATION_FIELDS, isStation, type Choice, type FieldProblem, type StationChoices, type ParkDraft, type Place, type Station, type StationDraft,
  type StationsView
} from './station-contract.js';
export { adifLocation } from './station-contract.js';
import { adifLocation } from './station-contract.js';

export type Definitions = Ruleset | 'not loaded';

export interface Checked {
  problems: FieldProblem[];
  // Whether there were definitions to check the values against.
  checked: boolean;
}

// The name is the station's own, so it is checked here; every MY_* value is
// ADIF's and is checked against ADIF's definitions, together, because some
// depend on each other (a county is a county of the station's MY_DXCC).
export function checkStation(draft: StationDraft, definitions: Definitions): Checked {
  const problems: FieldProblem[] = [];
  if (draft.name.trim().length === 0) problems.push({ field: 'name', reason: 'A station needs a name.' });
  // The grid is always required (KI7MT, 2026-10-20): one grid, or the grids
  // of a line or corner (QGD-STN-0003).
  if (!draft.place.MY_GRIDSQUARE?.trim() && !draft.place.MY_VUCC_GRIDS?.trim()) {
    problems.push({ field: 'MY_GRIDSQUARE', reason: 'A station needs a grid.' });
  }
  if (definitions === 'not loaded') return { problems, checked: false };
  const tags = STATION_FIELDS.flatMap(field => {
    const value = draft.place[field];
    return value === undefined ? [] : [{ name: field, length: value.length, value }];
  });
  for (const result of validateRecord(definitions, { tags })) {
    if (result.verdict === 'invalid') {
      problems.push({ field: result.field, reason: result.reason ?? 'ADIF does not allow this value.' });
    }
  }
  // A zone must be one of the state's own where ADIF lists the state's
  // zones: Idaho is CQ 3 and ITU 6 in ADIF's subdivision list, so Idaho in
  // CQ 40 is refused (KI7MT, 2026-10-20: what can be checked must be right).
  const { MY_DXCC: entity, MY_STATE: state } = draft.place;
  if (entity && state) {
    const choices = stationChoices(definitions, entity, state);
    const named = choices.states.find(choice => choice.code.toUpperCase() === state.toUpperCase());
    for (const [field, column] of [['MY_CQ_ZONE', 'CQ'], ['MY_ITU_ZONE', 'ITU']] as const) {
      const value = draft.place[field];
      if (!named || value === undefined || problems.some(problem => problem.field === field)) continue;
      const listed = subdivisionZones(definitions, entity, state, column === 'CQ' ? 'CQ Zone' : 'ITU Zone');
      if (listed.length > 0 && !listed.includes(String(Number(value)))) {
        problems.push({ field, reason: `${named.name} is in ${column} zone ${listed.join(' or ')} in ADIF's list` });
      }
    }
  }
  return { problems, checked: true };
}

type StateStore = Store<typeof stateSchema>;

function rowToStation(row: typeof station.$inferSelect): Station | undefined {
  const value = {
    id: row.id, name: row.name, place: row.place as Place,
    ...(row.kind ? { kind: row.kind } : {}),
    ...(row.lotwPark ? { lotwPark: row.lotwPark } : {})
  };
  // What was written was checked on the way in; what is read back is checked
  // again, so a file edited by hand cannot put an off-shape station on screen.
  return isStation(value) ? value : undefined;
}

export async function viewStations(state: StateStore, checked: boolean): Promise<StationsView> {
  return state.unit(async (db) => {
    const rows = await db.select().from(station).orderBy(asc(station.name)).all();
    const defaults = await db.select().from(stationDefault).all();
    const active = await db.select().from(activeStation).where(eq(activeStation.id, ACTIVE_STATION_ID)).get();
    return {
      list: rows.flatMap(row => rowToStation(row) ?? []),
      defaults: Object.fromEntries(defaults.map(row => [row.persona, row.stationId])),
      active: active?.stationId ?? null,
      checked
    };
  });
}

export type SaveOutcome = { ok: true; id: string } | { ok: false; problems: FieldProblem[] };

// The parks a MY_POTA_REF names, as references alone: "US-0001@US-ID,US-0002"
// is US-0001 and US-0002 (the "@" part is the location within a park ADIF
// allows, not another park).
export function parksIn(value: string | undefined): string[] {
  return entriesIn(value).map(entry => entry.park);
}

// Each park with the location it names after "@", if any.
export function entriesIn(value: string | undefined): { park: string; location?: string }[] {
  if (!value) return [];
  return value.split(',').map(entry => entry.trim()).filter(Boolean).map(entry => {
    const [park, location] = entry.split('@');
    return { park: park.toUpperCase(), ...(location ? { location: location.toUpperCase() } : {}) };
  });
}

// The locations POTA lists for a park (US-ID; more than one where a park
// crosses a border).
export async function parkLocations(reference: Store<typeof referenceSchema>, park: string): Promise<string[]> {
  const rows = await reference.unit(async (db) =>
    db.select({ location: potaParkLocation.locationDesc }).from(potaParkLocation).where(eq(potaParkLocation.reference, park)).all());
  return rows.map(row => row.location.toUpperCase());
}

// The parks POTA's list has for those references, with their names.
export async function lookUpParks(reference: Store<typeof referenceSchema>, references: string[]): Promise<Choice[]> {
  const found: Choice[] = [];
  for (const wanted of references.slice(0, 16)) {
    const park = await reference.unit(async (db) =>
      db.select({ reference: potaPark.reference, name: potaPark.name }).from(potaPark).where(eq(potaPark.reference, wanted)).get());
    if (park) found.push({ code: park.reference, name: park.name });
  }
  return found;
}

// How a station's references are checked against their lists where the list
// is on this computer (KI7MT, 2026-10-20): undefined where it is not, and the
// reference is then checked for its form only.
export interface ReferenceLists {
  parks?: (references: string[]) => Promise<Choice[]>;
  // The locations POTA lists for a park, for the "@" part of a reference.
  locations?: (park: string) => Promise<string[]>;
}

export async function saveStation(
  state: StateStore, draft: StationDraft, definitions: Definitions, now = new Date(), lists: ReferenceLists = {}
): Promise<SaveOutcome> {
  const { problems } = checkStation(draft, definitions);
  // A park that is well formed and is not in POTA's list is refused, naming
  // it. Only once its form has passed: a malformed one has ADIF's reason.
  const wanted = parksIn(draft.place.MY_POTA_REF);
  if (lists.parks && wanted.length > 0 && !problems.some(problem => problem.field === 'MY_POTA_REF')) {
    const known = new Set((await lists.parks(wanted)).map(park => park.code));
    const missing = wanted.filter(park => !known.has(park));
    if (missing.length > 0) {
      problems.push({ field: 'MY_POTA_REF', reason: `POTA's park list has no park ${missing.join(' or ')}.` });
    } else if (lists.locations) {
      // A location named after "@" must be one POTA lists for that park.
      for (const entry of entriesIn(draft.place.MY_POTA_REF)) {
        if (!entry.location) continue;
        const listed = await lists.locations(entry.park);
        if (!listed.includes(entry.location)) {
          problems.push({ field: 'MY_POTA_REF', reason: `POTA lists ${entry.park} in ${listed.join(' and ') || 'no location'}, not ${entry.location}.` });
          break;
        }
      }
    }
  }
  if (problems.length > 0) return { ok: false, problems };
  const name = draft.name.trim();
  return state.unit(async (db) => {
    // Names are how the operator tells stations apart, as TQSL's location
    // names are, so two may not share one, whatever their case.
    const others = await db.select({ id: station.id, name: station.name }).from(station).all();
    // Bounded, because the whole list travels in every status and a status
    // over the contract's bound would be refused whole (QGD-SEC-0006).
    if (!draft.id && others.length >= MAX_STATIONS) {
      return { ok: false, problems: [{ field: 'name', reason: `There are already ${MAX_STATIONS} stations; delete one to add another.` }] };
    }
    if (others.some(other => other.id !== draft.id && other.name.toLowerCase() === name.toLowerCase())) {
      return { ok: false, problems: [{ field: 'name', reason: 'Another station already has this name.' }] };
    }
    const at = now.toISOString();
    const values = {
      name, kind: draft.kind ?? null, place: draft.place, lotwPark: draft.lotwPark ?? null, updatedAt: at
    };
    if (draft.id) {
      if (!others.some(other => other.id === draft.id)) {
        return { ok: false, problems: [{ field: 'id', reason: 'That station no longer exists.' }] };
      }
      await db.update(station).set(values).where(eq(station.id, draft.id)).run();
      return { ok: true, id: draft.id };
    }
    const id = randomUUID();
    await db.insert(station).values({ id, ...values, createdAt: at }).run();
    return { ok: true, id };
  });
}

// Deleting a station removes it as any persona's default and leaves none
// active if it was, by the foreign keys (schema.ts).
export async function deleteStation(state: StateStore, id: string): Promise<boolean> {
  return state.unit(async (db) => {
    const found = await db.select({ id: station.id }).from(station).where(eq(station.id, id)).get();
    if (!found) return false;
    await db.delete(station).where(eq(station.id, id)).run();
    return true;
  });
}

// Each of these is one unit of work: the check that the station exists and
// the write happen together, so a persona made active while the operator picks
// another station cannot interleave between them and leave the wrong one
// active (found by Turing in review).
export async function setDefaultStation(state: StateStore, persona: string, id: string | null): Promise<boolean> {
  return state.unit(async (db) => {
    if (id === null) {
      await db.delete(stationDefault).where(eq(stationDefault.persona, persona)).run();
      return true;
    }
    if (!(await db.select({ id: station.id }).from(station).where(eq(station.id, id)).get())) return false;
    await db.insert(stationDefault).values({ persona, stationId: id })
      .onConflictDoUpdate({ target: stationDefault.persona, set: { stationId: id } }).run();
    return true;
  });
}

export async function setActiveStation(state: StateStore, id: string | null): Promise<boolean> {
  return state.unit(async (db) => {
    if (id !== null && !(await db.select({ id: station.id }).from(station).where(eq(station.id, id)).get())) return false;
    await db.insert(activeStation).values({ id: ACTIVE_STATION_ID, stationId: id })
      .onConflictDoUpdate({ target: activeStation.id, set: { stationId: id } }).run();
    return true;
  });
}

// Making a persona active makes its default station active (QGD-STN-0005). A
// persona with no default leaves the active station as it was: the operator
// chose it, and nothing says it is wrong for this persona.
export async function personaActivated(state: StateStore, persona: string): Promise<boolean> {
  return state.unit(async (db) => {
    const row = await db.select().from(stationDefault).where(eq(stationDefault.persona, persona)).get();
    if (!row) return false;
    await db.insert(activeStation).values({ id: ACTIVE_STATION_ID, stationId: row.stationId })
      .onConflictDoUpdate({ target: activeStation.id, set: { stationId: row.stationId } }).run();
    return true;
  });
}


// A station started from a POTA park (QGD-STN-0006): what POTA's list says
// about the park, for the operator to change before saving. A value ADIF's
// definitions refuse is left out rather than offered, and coordinates POTA
// publishes as unusable fill nothing.
export async function draftFromPark(
  reference: Store<typeof referenceSchema>, parkReference: string, definitions: Definitions
): Promise<ParkDraft | 'not found'> {
  const park = await reference.unit(async (db) =>
    db.select().from(potaPark).where(eq(potaPark.reference, parkReference)).get());
  if (!park) return 'not found';
  const place: Place = { MY_POTA_REF: park.reference };
  if (park.adifEntity !== null) place.MY_DXCC = String(park.adifEntity);
  let note: string | undefined;
  if (park.coordinatesUsable && park.latitude !== null && park.longitude !== null) {
    if (park.grid) place.MY_GRIDSQUARE = park.grid;
    const lat = adifLocation(park.latitude, 'lat');
    const lon = adifLocation(park.longitude, 'lon');
    if (lat && lon) { place.MY_LAT = lat; place.MY_LON = lon; }
  } else {
    note = 'POTA publishes this park\'s coordinates as unusable, so its grid and position were not filled in. Add the grid before saving.';
  }
  // POTA names a park's location by ISO 3166-2 code (US-ID). Where that is
  // one place and its subdivision part is a code ADIF's list holds for the
  // park's entity, it is the state; anything else is left for the operator.
  const locations = park.locationDesc.split(',').map(entry => entry.trim()).filter(Boolean);
  if (locations.length === 1 && place.MY_DXCC && locations[0].includes('-')) {
    place.MY_STATE = locations[0].slice(locations[0].indexOf('-') + 1);
  }
  const draft: StationDraft = { name: `${park.reference} ${park.name}`.slice(0, 64).trim(), kind: 'Portable', place };
  if (definitions !== 'not loaded') {
    for (const problem of checkStation(draft, definitions).problems) {
      if (problem.field in place) delete place[problem.field as keyof Place];
    }
  }
  return { draft, ...(note ? { note } : {}) };
}

// The zones ADIF lists on a subdivision ("02,05"), as plain numbers; empty
// where it lists none.
function subdivisionZones(definitions: Ruleset, entity: string, state: string, column: string): string[] {
  const rows = [...(definitions.enumerations.get('Primary_Administrative_Subdivision')?.byValue.values() ?? [])].flat();
  const row = rows.find(value => !value.deleted && value.row['DXCC Entity Code'] === entity
    && value.row['Code']?.toUpperCase() === state.toUpperCase());
  return (row?.row[column] ?? '').split(',').map(zone => String(Number(zone.trim()))).filter(zone => zone !== 'NaN' && zone !== '0');
}

// The editor's pick lists, from ADIF's own enumerations as loaded: nothing
// here names an entity, a state or a section (QGD-REF-0005). Deleted entries
// are left out, because a station is somewhere now. Names are ADIF's, as ADIF
// writes them.
export function stationChoices(definitions: Definitions, entity: string | null, state: string | null = null): StationChoices {
  const none: StationChoices = { entities: [], states: [], sections: [], counties: [], cqZones: [], ituZones: [] };
  if (definitions === 'not loaded') return none;
  const rows = (name: string) => [...(definitions.enumerations.get(name)?.byValue.values() ?? [])].flat()
    .filter(value => !value.deleted && !value.row['Deleted'] && !value.row['Deleted Date']);
  const choose = (name: string, code: string, label: string, forEntity: boolean): Choice[] => rows(name)
    .filter(value => !forEntity || (entity !== null && value.row['DXCC Entity Code'] === entity))
    .map(value => ({ code: value.row[code] ?? '', name: value.row[label] ?? '' }))
    .filter(choice => choice.code !== '' && choice.name !== '')
    .sort((a, b) => a.name.localeCompare(b.name));
  // A zone field's whole range, from ADIF's Minimum Value and Maximum Value.
  const range = (field: string): Choice[] => {
    const rule = definitions.fields.get(field);
    const low = Number(rule?.minimumValue);
    const high = Number(rule?.maximumValue);
    if (!Number.isInteger(low) || !Number.isInteger(high) || high < low || high - low > 200) return [];
    return Array.from({ length: high - low + 1 }, (_, at) => ({ code: String(low + at), name: String(low + at) }));
  };
  // The chosen state's zones, as ADIF lists them on the subdivision ("02,05").
  const subdivision = entity !== null && state !== null
    ? rows('Primary_Administrative_Subdivision').find(value =>
      value.row['DXCC Entity Code'] === entity && value.row['Code']?.toUpperCase() === state.toUpperCase())
    : undefined;
  const zones = (column: string, field: string): Choice[] => {
    const listed = (subdivision?.row[column] ?? '').split(',').map(zone => String(Number(zone.trim())))
      .filter(zone => zone !== 'NaN' && zone !== '0');
    return listed.length ? listed.map(zone => ({ code: zone, name: zone })) : range(field);
  };
  return {
    cqZones: zones('CQ Zone', 'MY_CQ_ZONE'),
    ituZones: zones('ITU Zone', 'MY_ITU_ZONE'),
    // Code 0 is "no DXCC entity", which is not a place to operate from.
    entities: choose('DXCC_Entity_Code', 'Entity Code', 'Entity Name', false).filter(choice => choice.code !== '0'),
    states: choose('Primary_Administrative_Subdivision', 'Code', 'Primary Administrative Subdivision', true),
    sections: choose('ARRL_Section', 'Abbreviation', 'Section Name', true),
    counties: choose('Secondary_Administrative_Subdivision', 'Code', 'Secondary Administrative Subdivision', true)
  };
}
