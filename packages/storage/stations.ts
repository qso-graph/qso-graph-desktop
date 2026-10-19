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
import { potaPark, type referenceSchema } from './reference-schema.js';
import { ACTIVE_STATION_ID, activeStation, station, stationDefault, type stateSchema } from './schema.js';
import type { Store } from './sqlite.js';
import {
  MAX_STATIONS, STATION_FIELDS, isStation, type FieldProblem, type ParkDraft, type Place, type Station, type StationDraft,
  type StationsView
} from './station-contract.js';

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

export async function saveStation(
  state: StateStore, draft: StationDraft, definitions: Definitions, now = new Date()
): Promise<SaveOutcome> {
  const { problems } = checkStation(draft, definitions);
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
    note = 'POTA publishes this park\'s coordinates as unusable, so its grid and position were not filled in.';
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
