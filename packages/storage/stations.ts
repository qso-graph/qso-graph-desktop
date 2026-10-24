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
import type { Counties } from '../reference/counties.js';
import { potaPark, potaParkLocation, sotaSummit, type referenceSchema } from './reference-schema.js';
import { ACTIVE_STATION_ID, activeStation, station, stationDefault, type stateSchema } from './schema.js';
import type { Store } from './sqlite.js';
import {
  MAX_STATIONS, STATION_FIELDS, isStation, type Choice, type FieldProblem, type StationChoices, type ParkDraft, type Place, type Station, type StationDraft,
  type StationsBackup, type StationsView
} from './station-contract.js';
export { adifLocation } from './station-contract.js';
import { gridOf } from './station-contract.js';

export type Definitions = Ruleset | 'not loaded';

// The DXCC entities whose counties are the US list (QGD-STN-0010): the United
// States, Alaska and Hawaii, as TQSL's US_STATE field takes them.
export const US_ENTITIES = new Set(['291', '6', '110']);

export interface Checked {
  problems: FieldProblem[];
  // Whether there were definitions to check the values against.
  checked: boolean;
}

// The name is the station's own, so it is checked here; every MY_* value is
// ADIF's and is checked against ADIF's definitions, together, because some
// depend on each other (a county is a county of the station's MY_DXCC).
export function checkStation(draft: StationDraft, definitions: Definitions, counties?: Counties): Checked {
  const problems: FieldProblem[] = [];
  if (draft.name.trim().length === 0) problems.push({ field: 'name', reason: 'A location needs a name.' });
  // The grid is always required (KI7MT, 2026-10-20): one grid, or the grids
  // of a line or corner (QGD-STN-0003).
  if (!draft.place.MY_GRIDSQUARE?.trim() && !draft.place.MY_VUCC_GRIDS?.trim()) {
    problems.push({ field: 'MY_GRIDSQUARE', reason: 'A location needs a grid.' });
  }
  // A US county is checked against the list LoTW accepts (QGD-STN-0010,
  // KI7MT 2026-10-22: LoTW first), written with its state first as ADIF has
  // it. Refused with the reason, never altered to fit. The list ships with the
  // application, so this holds whether or not ADIF's definitions are here.
  const { MY_DXCC: countyEntity, MY_STATE: countyState } = draft.place;
  const county = draft.place.MY_CNTY;
  if (counties && countyEntity && US_ENTITIES.has(countyEntity) && county) {
    if (countyState && !county.startsWith(`${countyState.toUpperCase()},`)) {
      problems.push({ field: 'MY_CNTY', reason: `A county is written with its state first: ${countyState.toUpperCase()},<county>.` });
    } else if (!counties.has(county)) {
      const list = county.startsWith('AK,') ? 'ADIF\'s Alaska list' : 'LoTW\'s county list';
      problems.push({ field: 'MY_CNTY', reason: `${list} has no ${county}. Pick it from the list.` });
    }
  }
  // The ARRL section is the state's, or where ARRL splits the state, the
  // county's (ARRL's Section Boundaries, QGD-STN-0010).
  const section = draft.place.MY_ARRL_SECT;
  if (counties && countyEntity && US_ENTITIES.has(countyEntity) && countyState && section) {
    const state = countyState.toUpperCase();
    const allowed = counties.sectionsOf(state);
    const known = county && counties.has(county) ? counties.sectionOf(state, county) : undefined;
    if (known && section.toUpperCase() !== known) {
      problems.push({ field: 'MY_ARRL_SECT', reason: `${county} is in ARRL's ${known} section.` });
    } else if (!known && allowed.length > 0 && !allowed.includes(section.toUpperCase())) {
      problems.push({ field: 'MY_ARRL_SECT', reason: `${state} is in ARRL's ${allowed.join(' or ')} section${allowed.length > 1 ? 's' : ''}.` });
    }
  }
  if (definitions === 'not loaded') return { problems, checked: false };
  const tags = STATION_FIELDS.flatMap(field => {
    const value = draft.place[field];
    return value === undefined ? [] : [{ name: field, length: value.length, value }];
  });
  for (const result of validateRecord(definitions, { tags })) {
    // One reason per field: a county the list above already refused is not
    // refused a second time in ADIF's words.
    if (result.verdict === 'invalid' && !problems.some(problem => problem.field === result.field)) {
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
    ...(row.lotwPark ? { lotwPark: row.lotwPark } : {}),
    ...(row.notes ? { notes: row.notes } : {})
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
      defaults: Object.fromEntries(defaults.map(row => [row.callsign, row.stationId])),
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
  // The US counties (QGD-STN-0010), which ship with the application.
  counties?: Counties;
  // A SOTA summit by its reference, where SOTA's summits are downloaded
  // (QGD-REF-0018).
  summit?: (code: string) => Promise<{ validFrom: string; validTo: string } | undefined>;
  // The locations POTA lists for a park, for the "@" part of a reference.
  locations?: (park: string) => Promise<string[]>;
}

export async function saveStation(
  state: StateStore, draft: StationDraft, definitions: Definitions, now = new Date(), lists: ReferenceLists = {}
): Promise<SaveOutcome> {
  const { problems } = checkStation(draft, definitions, lists.counties);
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
  // A summit that is well formed must be one SOTA lists, and valid today.
  const summitCode = draft.place.MY_SOTA_REF;
  if (lists.summit && summitCode && !problems.some(problem => problem.field === 'MY_SOTA_REF')) {
    const summit = await lists.summit(summitCode);
    const today = now.toISOString().slice(0, 10);
    if (!summit) {
      problems.push({ field: 'MY_SOTA_REF', reason: `SOTA's summit list has no summit ${summitCode}.` });
    } else if (today < summit.validFrom || today > summit.validTo) {
      problems.push({ field: 'MY_SOTA_REF', reason: `SOTA lists ${summitCode} as a summit from ${summit.validFrom} to ${summit.validTo}, not today.` });
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
      return { ok: false, problems: [{ field: 'name', reason: `There are already ${MAX_STATIONS} locations; delete one to add another.` }] };
    }
    if (others.some(other => other.id !== draft.id && other.name.toLowerCase() === name.toLowerCase())) {
      return { ok: false, problems: [{ field: 'name', reason: 'Another location already has this name.' }] };
    }
    const at = now.toISOString();
    const values = {
      name, kind: draft.kind ?? null, place: draft.place, lotwPark: draft.lotwPark ?? null, notes: draft.notes ?? null,
      updatedAt: at
    };
    if (draft.id) {
      if (!others.some(other => other.id === draft.id)) {
        return { ok: false, problems: [{ field: 'id', reason: 'That location no longer exists.' }] };
      }
      await db.update(station).set(values).where(eq(station.id, draft.id)).run();
      return { ok: true, id: draft.id };
    }
    const id = randomUUID();
    await db.insert(station).values({ id, ...values, createdAt: at }).run();
    return { ok: true, id };
  });
}

// Deleting a station removes it as any callsign's default and leaves none
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
// the write happen together, so a callsign made active while the operator picks
// another station cannot interleave between them and leave the wrong one
// active (found by Turing in review).
export async function setDefaultStation(state: StateStore, callsign: string, id: string | null): Promise<boolean> {
  return state.unit(async (db) => {
    if (id === null) {
      await db.delete(stationDefault).where(eq(stationDefault.callsign, callsign)).run();
      return true;
    }
    if (!(await db.select({ id: station.id }).from(station).where(eq(station.id, id)).get())) return false;
    await db.insert(stationDefault).values({ callsign, stationId: id })
      .onConflictDoUpdate({ target: stationDefault.callsign, set: { stationId: id } }).run();
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

// A callsign that is gone has no default (KI7MT, 2026-10-22): its row goes
// with it, so a default never outlives the callsign it was for.
export async function callsignRemoved(state: StateStore, callsign: string): Promise<boolean> {
  return state.unit(async (db) => {
    const found = await db.select().from(stationDefault).where(eq(stationDefault.callsign, callsign)).get();
    if (!found) return false;
    await db.delete(stationDefault).where(eq(stationDefault.callsign, callsign)).run();
    return true;
  });
}

// Making a callsign active makes its default station active (QGD-STN-0005).
// A callsign with no default leaves the active station as it was: the
// operator chose it, and nothing says it is wrong for this callsign.
export async function callsignActivated(state: StateStore, callsign: string): Promise<boolean> {
  return state.unit(async (db) => {
    const row = await db.select().from(stationDefault).where(eq(stationDefault.callsign, callsign)).get();
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
  // The grid alone: a Location holds no latitude or longitude (KI7MT,
  // 2026-10-23: "a grid square is enough").
  if (park.coordinatesUsable && park.latitude !== null && park.longitude !== null) {
    if (park.grid) place.MY_GRIDSQUARE = park.grid;
  } else {
    note = 'POTA publishes this park\'s coordinates as unusable, so its grid was not filled in. Add the grid before saving.';
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

// A summit, from SOTA's list (QGD-REF-0018), or undefined.
export async function summitOf(reference: Store<typeof referenceSchema>, code: string) {
  return reference.unit(async (db) => db.select().from(sotaSummit).where(eq(sotaSummit.code, code)).get());
}

// A portable location from a SOTA summit: its reference, its six-character
// grid and its height (MY_ALTITUDE, shown as Elevation), each
// editable before it is saved. A retired summit is still drafted, and says so:
// saving it is refused, with the reason (QGD-REF-0018).
export async function draftFromSummit(
  reference: Store<typeof referenceSchema>, code: string, definitions: Definitions, now = new Date()
): Promise<ParkDraft | 'not found'> {
  const summit = await summitOf(reference, code);
  if (!summit) return 'not found';
  const place: Place = { MY_SOTA_REF: summit.code };
  const grid = gridOf(summit.latitude, summit.longitude, 6);
  if (grid) place.MY_GRIDSQUARE = grid;
  if (summit.altitudeM !== null) place.MY_ALTITUDE = String(summit.altitudeM);
  const today = now.toISOString().slice(0, 10);
  const note = today > summit.validTo ? `SOTA retired ${summit.code} on ${summit.validTo}.`
    : today < summit.validFrom ? `${summit.code} is a SOTA summit from ${summit.validFrom}.` : undefined;
  const draft: StationDraft = { name: `${summit.code} ${summit.name}`.slice(0, 64).trim(), kind: 'Portable', place };
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
export function stationChoices(
  definitions: Definitions, entity: string | null, state: string | null = null, counties?: Counties
): StationChoices {
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
    // A US state's own sections where the counties' data has them; elsewhere
    // the entity's.
    sections: choose('ARRL_Section', 'Abbreviation', 'Section Name', true).filter(choice =>
      !(counties && entity !== null && US_ENTITIES.has(entity) && state !== null)
      || counties.sectionsOf(state.toUpperCase()).includes(choice.code)),
    // A US state's counties from the list LoTW accepts (QGD-STN-0010);
    // elsewhere, what ADIF lists.
    counties: counties && entity !== null && US_ENTITIES.has(entity) && state !== null
      ? counties.of(state.toUpperCase()).map(name => ({ code: `${state.toUpperCase()},${name}`, name }))
      : choose('Secondary_Administrative_Subdivision', 'Code', 'Secondary Administrative Subdivision', true)
  };
}

// Every Location, each callsign's default and the active one, for a backup
// (KI7MT, 2026-10-23). The notes stay on this computer: they are the
// operator's own words, which may hold a gate code or a telephone number, and
// a backup holds only what is public.
export async function backupStations(state: StateStore): Promise<StationsBackup> {
  const view = await viewStations(state, false);
  const stations = view.list.map(entry => {
    const copy = { ...entry };
    delete copy.notes;
    return copy;
  });
  return { stations, defaults: view.defaults, active: view.active };
}

// A restore onto a clean slate (KI7MT, 2026-10-23: "clean up the new first,
// then it's a clean import"): the Locations here are removed first when the
// operator says so, and refused otherwise, so nothing is merged. All of it in
// one unit of work, so a failure leaves the Locations as they were. Each
// Location keeps its id, so a callsign's default still names it.
// The first thing wrong with a backup's Locations, by the checks a Location
// saved by hand passes (#57: a restore stored a Location with no grid), or
// nothing. Asked before a restore changes anything, here or in the callsigns.
export function checkBackup(backup: StationsBackup, definitions: Definitions, counties?: Counties): string | undefined {
  for (const entry of backup.stations) {
    const { problems } = checkStation({ name: entry.name, kind: entry.kind, place: entry.place, lotwPark: entry.lotwPark, notes: entry.notes }, definitions, counties);
    if (problems.length > 0) return `${entry.name}: ${problems[0].reason}`;
  }
  return undefined;
}

// All of it or none of it, in one transaction (#57: a failure part way
// through left the Locations here removed and the backup's half written).
export async function restoreStations(
  state: StateStore, backup: StationsBackup, replace: boolean, definitions: Definitions, counties?: Counties, now = new Date()
): Promise<number | 'not empty' | { problem: string }> {
  const problem = checkBackup(backup, definitions, counties);
  if (problem) return { problem };
  return state.unit(async (db) => {
    const here = await db.select({ id: station.id }).from(station).all();
    if (here.length > 0 && !replace) return 'not empty';
    state.connection.exec('BEGIN IMMEDIATE');
    try {
      // Defaults and the active one go with them, by the foreign keys.
      await db.delete(station).run();
      await db.delete(stationDefault).run();
      const at = now.toISOString();
      for (const entry of backup.stations) {
        await db.insert(station).values({
          id: entry.id, name: entry.name, kind: entry.kind ?? null, place: entry.place,
          lotwPark: entry.lotwPark ?? null, notes: entry.notes ?? null, createdAt: at, updatedAt: at
        }).run();
      }
      for (const [callsign, stationId] of Object.entries(backup.defaults)) {
        await db.insert(stationDefault).values({ callsign, stationId }).run();
      }
      await db.insert(activeStation).values({ id: ACTIVE_STATION_ID, stationId: backup.active })
        .onConflictDoUpdate({ target: activeStation.id, set: { stationId: backup.active } }).run();
      state.connection.exec('COMMIT');
    } catch (error) {
      state.connection.exec('ROLLBACK');
      throw error;
    }
    return backup.stations.length;
  });
}
