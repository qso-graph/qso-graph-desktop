// SPDX-License-Identifier: GPL-3.0-only
// P9 (docs/P9.md): stations in state.sqlite, checked against ADIF's own
// definitions. P9-record, P9-adif, P9-optional, P9-kind, P9-active, P9-pota,
// P9-tqsl and P9-contract, as far as the storage package reaches them.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { definitionsOf } from '../packages/reference/adif.js';
import { rulesetOf, type Ruleset } from '../packages/reference/validate.js';
import { layout, openState } from '../packages/storage/layout.js';
import { potaPark, referenceSchema } from '../packages/storage/reference-schema.js';
import { validateStorageCommand } from '../packages/storage/storage-contract.js';
import { openStore } from '../packages/storage/sqlite.js';
import {
  ADDRESS_FIELDS, MAX_STATIONS, STATION_FIELDS, typedLocation, STATION_KINDS, isLotwPark, isStationDraft, isStationsView, type StationDraft
} from '../packages/storage/station-contract.js';
import {
  adifLocation, checkStation, deleteStation, draftFromPark, personaActivated, saveStation, setActiveStation,
  setDefaultStation, stationChoices, viewStations, lookUpParks, parksIn
} from '../packages/storage/stations.js';

const MIGRATIONS = resolve('drizzle/state');
const register = JSON.parse(readFileSync('data/reference-sources.json', 'utf8'));
// From `make setup` (CI runs scripts/fetch-adif.mjs before the checks). Not
// skipped when missing: a station check that never met ADIF's definitions
// proves nothing.
// Each test opens state.sqlite and commits to it, and Windows' runners commit
// slowly: four saves took 11.5 s there against vitest's 5 s default
// (2026-10-22). A bound, still, so a hang fails rather than waits.
vi.setConfig({ testTimeout: 30_000 });

const ruleset: Ruleset = rulesetOf(definitionsOf(JSON.parse(readFileSync(
  `vendor/adif/${register.adif.version}/${register.adif.source.definitions}`, 'utf8'))));

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'qg-stations-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

const open = () => openState(layout(root), MIGRATIONS, '0.0.0-test');
// Every station has a grid (QGD-STN-0003); a test about other fields gets
// one unless it gives its own. A test of a station with no grid says so with
// MY_GRIDSQUARE: undefined.
const draft = (place: StationDraft['place'], extra: Partial<StationDraft> = {}): StationDraft => {
  const withGrid = 'MY_GRIDSQUARE' in place || 'MY_VUCC_GRIDS' in place ? { ...place } : { MY_GRIDSQUARE: 'DN13', ...place };
  for (const key of Object.keys(withGrid) as (keyof typeof withGrid)[]) if (withGrid[key] === undefined) delete withGrid[key];
  return { name: 'Home', place: withGrid, ...extra };
};

describe('P9-adif: values are ADIF\'s, checked against its definitions (QGD-STN-0002)', () => {
  it('takes a valid value in every field, at the bounds', () => {
    const place = {
      MY_GRIDSQUARE: 'DN13sm46', MY_GRIDSQUARE_EXT: 'ab', MY_VUCC_GRIDS: 'DN13,DN14', MY_LAT: 'N043 37.500',
      MY_LON: 'W116 12.500', MY_ALTITUDE: '824', MY_DXCC: '291', MY_CQ_ZONE: '3', MY_ITU_ZONE: '6',
      MY_STATE: 'ID', MY_CNTY: 'ID,Ada', MY_ARRL_SECT: 'ID', MY_POTA_REF: 'US-0001', MY_SOTA_REF: 'W7I/SI-001',
      MY_WWFF_REF: 'KFF-0001', MY_IOTA: 'NA-001', MY_STREET: '1 Main', MY_CITY: 'Boise', MY_POSTAL_CODE: '83702'
    };
    expect(Object.keys(place).sort()).toEqual([...STATION_FIELDS].sort());
    expect(checkStation(draft(place), ruleset).problems).toEqual([]);
    expect(checkStation(draft({ MY_GRIDSQUARE: 'DN', MY_CQ_ZONE: '1', MY_ITU_ZONE: '1' }), ruleset).problems).toEqual([]);
    expect(checkStation(draft({ MY_CQ_ZONE: '40', MY_ITU_ZONE: '90' }), ruleset).problems).toEqual([]);
  });

  it('refuses a zone that is not the state\'s own where ADIF lists the state\'s zones', () => {
    const problems = checkStation(draft({ MY_DXCC: '291', MY_STATE: 'ID', MY_CQ_ZONE: '40', MY_ITU_ZONE: '90' }), ruleset).problems;
    expect(problems).toEqual([
      { field: 'MY_CQ_ZONE', reason: "Idaho is in CQ zone 3 in ADIF's list" },
      { field: 'MY_ITU_ZONE', reason: "Idaho is in ITU zone 6 in ADIF's list" }
    ]);
    // Québec spans two: either is right.
    expect(checkStation(draft({ MY_DXCC: '1', MY_STATE: 'QC', MY_CQ_ZONE: '2' }), ruleset).problems).toEqual([]);
    expect(checkStation(draft({ MY_DXCC: '1', MY_STATE: 'QC', MY_CQ_ZONE: '5' }), ruleset).problems).toEqual([]);
  });

  it.each([
    ['MY_GRIDSQUARE', 'DN1'], ['MY_GRIDSQUARE', 'ZZ13'], ['MY_CQ_ZONE', '41'], ['MY_CQ_ZONE', '0'],
    ['MY_ITU_ZONE', '0'], ['MY_ITU_ZONE', '91'],
    ['MY_LAT', '43.5'], ['MY_POTA_REF', 'K0001'], ['MY_SOTA_REF', 'nope'], ['MY_IOTA', 'XX-1']
  ])('refuses %s %j with ADIF\'s reason', (field, value) => {
    const problems = checkStation(draft({ [field]: value }), ruleset).problems;
    expect(problems.map(problem => problem.field)).toEqual([field]);
    expect(problems[0].reason.length).toBeGreaterThan(0);
  });

  it('checks a state against the station\'s own DXCC entity', () => {
    expect(checkStation(draft({ MY_DXCC: '291', MY_STATE: 'ID' }), ruleset).problems).toEqual([]);
    expect(checkStation(draft({ MY_DXCC: '1', MY_STATE: 'ID' }), ruleset).problems.map(p => p.field)).toEqual(['MY_STATE']);
  });

  it('never alters a refused value to fit', async () => {
    const state = await open();
    try {
      const outcome = await saveStation(state, draft({ MY_GRIDSQUARE: 'dn13x' }), ruleset);
      expect(outcome.ok).toBe(false);
      expect((await viewStations(state, true)).list).toEqual([]);
    } finally { state.close(); }
  });

  it('saves by name when the definitions are not downloaded, and says so', async () => {
    expect(checkStation(draft({ MY_GRIDSQUARE: 'not a grid' }), 'not loaded')).toEqual({ problems: [], checked: false });
  });
});

describe('P9-tqsl: every TQSL station location field has its ADIF home (QGD-STN-0009)', () => {
  // One fixture per entity TQSL has a page for, with the ADIF field TQSL
  // checks each against when it signs (tqslconvert.cpp).
  it.each([
    ['US', { MY_DXCC: '291', MY_STATE: 'ID', MY_CNTY: 'ID,Ada' }],
    ['Canada', { MY_DXCC: '1', MY_STATE: 'ON' }],
    ['European Russia', { MY_DXCC: '54', MY_STATE: 'MA' }],
    ['China', { MY_DXCC: '318', MY_STATE: 'BJ' }],
    ['Australia', { MY_DXCC: '150', MY_STATE: 'NSW' }],
    ['Japan', { MY_DXCC: '339', MY_STATE: '01' }],
    ['Finland', { MY_DXCC: '224', MY_STATE: '224' }]
  ])('%s: state and county round-trip', async (_entity, place) => {
    expect(checkStation(draft(place), ruleset).problems).toEqual([]);
    const state = await open();
    try {
      const saved = await saveStation(state, draft(place), ruleset);
      expect(saved.ok).toBe(true);
      expect((await viewStations(state, true)).list[0].place).toMatchObject(place);
    } finally { state.close(); }
  });

  it('holds a grid line as MY_VUCC_GRIDS and TQSL\'s park as its own field', async () => {
    expect(isLotwPark('NP33,WR01')).toBe(true);
    expect(isLotwPark('np33')).toBe(false);
    expect(isLotwPark('NP333')).toBe(false);
    const state = await open();
    try {
      const saved = await saveStation(state, draft({ MY_VUCC_GRIDS: 'DN13,DN14' }, { lotwPark: 'NP33' }), ruleset);
      expect(saved.ok).toBe(true);
      const [one] = (await viewStations(state, true)).list;
      expect(one.place.MY_VUCC_GRIDS).toBe('DN13,DN14');
      expect(one.lotwPark).toBe('NP33');
    } finally { state.close(); }
  });
});

describe('P9-record and P9-optional (QGD-STN-0001, QGD-STN-0003)', () => {
  it('makes, reads, edits and deletes a station, and keeps it across a restart', async () => {
    let state = await open();
    const made = await saveStation(state, draft({ MY_GRIDSQUARE: 'DN13' }), ruleset);
    if (!made.ok) throw new Error('not saved');
    state.close();
    state = await open();
    try {
      expect((await viewStations(state, true)).list).toEqual([{ id: made.id, name: 'Home', place: { MY_GRIDSQUARE: 'DN13' } }]);
      expect((await saveStation(state, draft({ MY_GRIDSQUARE: 'DN14' }, { id: made.id, name: 'Shack' }), ruleset)).ok).toBe(true);
      expect((await viewStations(state, true)).list[0]).toMatchObject({ name: 'Shack', place: { MY_GRIDSQUARE: 'DN14' } });
      expect(await deleteStation(state, made.id)).toBe(true);
      expect(await deleteStation(state, made.id)).toBe(false);
      expect((await viewStations(state, true)).list).toEqual([]);
    } finally { state.close(); }
  });

  it('saves with a name and a grid and nothing else; the address is never required', async () => {
    const state = await open();
    try {
      expect((await saveStation(state, draft({}, { name: 'Just a name' }), ruleset)).ok).toBe(true);
      expect((await saveStation(state, draft({ MY_GRIDSQUARE: 'DN13' }, { name: 'Grid' }), ruleset)).ok).toBe(true);
      expect((await saveStation(state, draft({ MY_POTA_REF: 'US-0001' }, { name: 'Park' }), ruleset)).ok).toBe(true);
      expect((await saveStation(state, draft({ MY_STREET: '1 Main', MY_CITY: 'Boise', MY_POSTAL_CODE: '83702' },
        { name: 'Address' }), ruleset)).ok).toBe(true);
      expect((await viewStations(state, true)).list).toHaveLength(4);
      expect(ADDRESS_FIELDS).toEqual(['MY_STREET', 'MY_CITY', 'MY_POSTAL_CODE']);
    } finally { state.close(); }
  });

  it('keeps the operator\'s notes, over several lines, and refuses notes off their shape', async () => {
    const state = await open();
    try {
      const notes = 'Park at the north lot.\nPicnic table 4, shade after 2 pm.';
      const made = await saveStation(state, draft({}, { notes }), ruleset);
      if (!made.ok) throw new Error('not saved');
      expect((await viewStations(state, true)).list[0].notes).toBe(notes);
    } finally { state.close(); }
    for (const bad of ['<script>', 'tab\there', 'x'.repeat(2001), '']) {
      expect(isStationDraft({ name: 'x', place: { MY_GRIDSQUARE: 'DN13' }, notes: bad }), JSON.stringify(bad)).toBe(false);
    }
  });

  it('refuses a station with no grid, and takes the grids of a line or corner as its grid', () => {
    expect(checkStation(draft({ MY_GRIDSQUARE: undefined, MY_POTA_REF: 'US-0001' }), ruleset).problems)
      .toEqual([{ field: 'MY_GRIDSQUARE', reason: 'A location needs a grid.' }]);
    expect(checkStation(draft({ MY_GRIDSQUARE: '  ' }), 'not loaded').problems.map(p => p.field)).toEqual(['MY_GRIDSQUARE']);
    expect(checkStation(draft({ MY_VUCC_GRIDS: 'DN13,DN14' }), ruleset).problems).toEqual([]);
  });

  it('refuses a station with no name, or one of only spaces, made or edited', async () => {
    expect(isStationDraft({ name: '', place: {} })).toBe(false);
    expect(isStationDraft({ name: '   ', place: {} })).toBe(false);
    expect(checkStation(draft({}, { name: '  ' }), ruleset).problems.map(p => p.field)).toEqual(['name']);
    const state = await open();
    try {
      const made = await saveStation(state, draft({}), ruleset);
      if (!made.ok) throw new Error('not saved');
      expect((await saveStation(state, draft({}, { id: made.id, name: ' ' }), ruleset)).ok).toBe(false);
    } finally { state.close(); }
  });

  it('refuses a second station with the same name, whatever its case', async () => {
    const state = await open();
    try {
      expect((await saveStation(state, draft({}), ruleset)).ok).toBe(true);
      const second = await saveStation(state, draft({}, { name: 'HOME' }), ruleset);
      expect(second).toEqual({ ok: false, problems: [{ field: 'name', reason: 'Another location already has this name.' }] });
    } finally { state.close(); }
  });
});

describe('P9-kind: a label and nothing more (QGD-STN-0004)', () => {
  it('is one of four, and changes nothing else', async () => {
    expect(isStationDraft({ name: 'x', kind: 'Boat', place: {} })).toBe(false);
    const state = await open();
    try {
      for (const kind of STATION_KINDS) {
        const place = { MY_GRIDSQUARE: 'DN13' };
        expect(checkStation(draft(place, { kind }), ruleset)).toEqual(checkStation(draft(place), ruleset));
        expect((await saveStation(state, draft(place, { name: kind, kind }), ruleset)).ok).toBe(true);
      }
      const list = (await viewStations(state, true)).list;
      expect(new Set(list.map(one => JSON.stringify(one.place)))).toEqual(new Set([JSON.stringify({ MY_GRIDSQUARE: 'DN13' })]));
    } finally { state.close(); }
  });
});

describe('P9-active: defaults and the active station (QGD-STN-0005, QGD-STN-0001)', () => {
  it('makes a persona\'s default active with it; two personas share one station', async () => {
    const state = await open();
    try {
      const home = await saveStation(state, draft({ MY_GRIDSQUARE: 'DN13' }), ruleset);
      const park = await saveStation(state, draft({ MY_POTA_REF: 'US-0001' }, { name: 'Park' }), ruleset);
      if (!home.ok || !park.ok) throw new Error('not saved');
      expect(await setDefaultStation(state, 'ki7mt', home.id)).toBe(true);
      expect(await setDefaultStation(state, 'ki7mt-club', home.id)).toBe(true);
      expect(await setActiveStation(state, park.id)).toBe(true);
      expect(await personaActivated(state, 'ki7mt-club')).toBe(true);
      let view = await viewStations(state, true);
      expect(view.active).toBe(home.id);
      expect(view.defaults).toEqual({ ki7mt: home.id, 'ki7mt-club': home.id });
      expect(view.list.filter(one => one.id === home.id)).toHaveLength(1);
      // The station never carries a callsign: it is the active persona's.
      expect(Object.keys(view.list[0])).not.toContain('callsign');
      // A persona with no default leaves the active station as it was.
      expect(await personaActivated(state, 'nobody')).toBe(false);
      expect((await viewStations(state, true)).active).toBe(home.id);
      // Deleting the active station leaves none active, and no default naming it.
      await deleteStation(state, home.id);
      view = await viewStations(state, true);
      expect(view.active).toBeNull();
      expect(view.defaults).toEqual({});
      expect(isStationsView(view)).toBe(true);
    } finally { state.close(); }
  });

  it('applies a persona activation and a station choice in the order they were asked', async () => {
    const state = await open();
    try {
      const a = await saveStation(state, draft({}, { name: 'A' }), ruleset);
      const b = await saveStation(state, draft({}, { name: 'B' }), ruleset);
      if (!a.ok || !b.ok) throw new Error('not saved');
      await setDefaultStation(state, 'ki7mt', a.id);
      // Not awaited one by one: each is one unit of work, so neither can land
      // between the other's check and its write.
      await Promise.all([personaActivated(state, 'ki7mt'), setActiveStation(state, b.id)]);
      expect((await viewStations(state, true)).active).toBe(b.id);
      await Promise.all([setActiveStation(state, b.id), personaActivated(state, 'ki7mt')]);
      expect((await viewStations(state, true)).active).toBe(a.id);
      await Promise.all([setDefaultStation(state, 'ki7mt', b.id), personaActivated(state, 'ki7mt')]);
      expect((await viewStations(state, true)).active).toBe(b.id);
    } finally { state.close(); }
  });

  it('takes a persona name as long as the persona contract allows', async () => {
    const state = await open();
    try {
      const a = await saveStation(state, draft({}), ruleset);
      if (!a.ok) throw new Error('not saved');
      const long = 'p'.repeat(128);
      expect(await setDefaultStation(state, long, a.id)).toBe(true);
      expect(isStationsView(await viewStations(state, true))).toBe(true);
    } finally { state.close(); }
  });

  // Five hundred saves, each its own write to disk: a hosted Windows runner
  // took over five seconds, vitest's default (CI, 2026-10-20).
  it('stops at the most stations a status can carry, and edits still save', { timeout: 60_000 }, async () => {
    const state = await open();
    try {
      let first = '';
      for (let at = 0; at < MAX_STATIONS; at += 1) {
        const made = await saveStation(state, draft({}, { name: `S${at}` }), 'not loaded');
        if (!made.ok) throw new Error(`station ${at} not saved`);
        first ||= made.id;
      }
      const over = await saveStation(state, draft({}, { name: 'One too many' }), 'not loaded');
      expect(over.ok).toBe(false);
      expect((await saveStation(state, draft({}, { id: first, name: 'Renamed' }), 'not loaded')).ok).toBe(true);
      expect(isStationsView(await viewStations(state, false))).toBe(true);
    } finally { state.close(); }
  });

  it('refuses a station that does not exist', async () => {
    const state = await open();
    try {
      const missing = '00000000-0000-4000-8000-000000000000';
      expect(await setActiveStation(state, missing)).toBe(false);
      expect(await setDefaultStation(state, 'ki7mt', missing)).toBe(false);
    } finally { state.close(); }
  });
});

describe('P9-pota: a portable station from a POTA park (QGD-STN-0006)', () => {
  const reference = () => {
    const store = openStore(join(root, 'reference.sqlite'), { schema: referenceSchema });
    const ddl = readFileSync('drizzle/reference/0000_reference.sql', 'utf8');
    for (const statement of ddl.split('--> statement-breakpoint')) store.connection.exec(statement);
    return store;
  };
  const park = {
    name: 'Example Park', active: true, entityId: 291, adifEntity: 291, locationDesc: 'US-ID',
    latitude: 43.625, longitude: -116.2083, grid: 'DN13sp', coordinatesUsable: true, coordinatesNote: null
  };

  it('takes the park\'s grid, coordinates and state, and its reference', async () => {
    const store = reference();
    try {
      await store.unit(db => db.insert(potaPark).values({ reference: 'US-0001', ...park }).run());
      const made = await draftFromPark(store, 'US-0001', ruleset);
      if (made === 'not found') throw new Error('no park');
      expect(made.draft).toEqual({
        name: 'US-0001 Example Park', kind: 'Portable',
        place: { MY_POTA_REF: 'US-0001', MY_DXCC: '291', MY_GRIDSQUARE: 'DN13sp', MY_LAT: 'N043 37.500',
          MY_LON: 'W116 12.498', MY_STATE: 'ID' }
      });
      expect(made.note).toBeUndefined();
      expect(checkStation(made.draft, ruleset).problems).toEqual([]);
    } finally { store.close(); }
  });

  it('fills nothing from coordinates POTA publishes as unusable, and says so', async () => {
    const store = reference();
    try {
      await store.unit(db => db.insert(potaPark).values({
        reference: 'US-0002', ...park, coordinatesUsable: false, coordinatesNote: 'impossible'
      }).run());
      const made = await draftFromPark(store, 'US-0002', ruleset);
      if (made === 'not found') throw new Error('no park');
      expect(made.draft.place).toEqual({ MY_POTA_REF: 'US-0002', MY_DXCC: '291', MY_STATE: 'ID' });
      expect(made.note).toMatch(/unusable/);
    } finally { store.close(); }
  });

  it('leaves out a state ADIF does not hold for the park\'s entity, and answers for a park it does not have', async () => {
    const store = reference();
    try {
      await store.unit(db => db.insert(potaPark).values({ reference: 'US-0003', ...park, locationDesc: 'US-ZZ' }).run());
      const made = await draftFromPark(store, 'US-0003', ruleset);
      if (made === 'not found') throw new Error('no park');
      expect(made.draft.place.MY_STATE).toBeUndefined();
      expect(await draftFromPark(store, 'US-9999', ruleset)).toBe('not found');
    } finally { store.close(); }
  });

  it('identifies a station by its name: two may name the same park, and a two-fer is one station', async () => {
    const state = await open();
    try {
      expect((await saveStation(state, draft({ MY_POTA_REF: 'US-0001', MY_GRIDSQUARE: 'DN13sp' }, { name: 'Trailhead' }), ruleset)).ok).toBe(true);
      expect((await saveStation(state, draft({ MY_POTA_REF: 'US-0001', MY_GRIDSQUARE: 'DN13sq' }, { name: 'Lake shore' }), ruleset)).ok).toBe(true);
      expect((await saveStation(state, draft({ MY_POTA_REF: 'US-0001,US-0002' }, { name: 'Two-fer' }), ruleset)).ok).toBe(true);
      expect((await viewStations(state, true)).list).toHaveLength(3);
    } finally { state.close(); }
  });

  it('writes ADIF\'s Location form', () => {
    expect(adifLocation(43.625, 'lat')).toBe('N043 37.500');
    expect(adifLocation(-33.8688, 'lat')).toBe('S033 52.128');
    expect(adifLocation(-0.0001, 'lon')).toBe('W000 00.006');
    expect(adifLocation(179.99999999, 'lon')).toBe('E180 00.000');
    expect(adifLocation(91, 'lat')).toBeUndefined();
  });
});

describe('P9-contract: off-shape stations are refused at the boundary (QGD-SEC-0006)', () => {
  it.each([
    [{ name: 'x', place: {}, callsign: 'W1AW' }],
    [{ name: 'x', place: { MY_GPS: 'here' } }],
    [{ name: 'x', place: { MY_GRIDSQUARE: 13 } }],
    [{ name: '<b>x</b>', place: {} }],
    [{ name: 'x'.repeat(65), place: {} }],
    [{ name: 'x', place: { MY_STREET: 'y'.repeat(101) } }],
    [{ name: 'x', place: { MY_GRIDSQUARE: '' } }],
    [{ id: 'not-an-id', name: 'x', place: {} }],
    [{ name: 'x', place: {}, lotwPark: 'NP33,' }]
  ])('refuses %j', (value) => {
    expect(isStationDraft(value)).toBe(false);
  });
});

describe('the editor\'s pick lists are ADIF\'s own (QGD-STN-0002, KI7MT 2026-10-20)', () => {
  it('lists the DXCC entities ADIF has not deleted, without "no entity"', () => {
    const { entities } = stationChoices(ruleset, null);
    expect(entities.length).toBeGreaterThan(300);
    expect(entities.find(entry => entry.code === '291')?.name).toMatch(/UNITED STATES/);
    expect(entities.some(entry => entry.code === '0')).toBe(false);
  });

  it('follows the entity for states, sections and counties', () => {
    const us = stationChoices(ruleset, '291');
    expect(us.states.find(entry => entry.code === 'ID')?.name).toBe('Idaho');
    expect(us.states.some(entry => entry.code === 'ON')).toBe(false);
    expect(us.sections.some(entry => entry.code === 'ID')).toBe(true);
    // ADIF lists counties only for Alaska; the US's are not ADIF's to give.
    expect(us.counties).toEqual([]);
    expect(stationChoices(ruleset, '6').counties.length).toBeGreaterThan(20);
    expect(stationChoices(ruleset, '1').states.some(entry => entry.code === 'ON')).toBe(true);
  });

  it('narrows the zones to the state\'s own, and otherwise offers ADIF\'s whole range', () => {
    const idaho = stationChoices(ruleset, '291', 'ID');
    expect(idaho.cqZones).toEqual([{ code: '3', name: '3' }]);
    expect(idaho.ituZones).toEqual([{ code: '6', name: '6' }]);
    const quebec = stationChoices(ruleset, '1', 'QC');
    expect(quebec.cqZones.map(zone => zone.code)).toEqual(['2', '5']);
    const anywhere = stationChoices(ruleset, null);
    expect(anywhere.cqZones.map(zone => zone.code)).toEqual(Array.from({ length: 40 }, (_, at) => String(at + 1)));
    expect(anywhere.ituZones).toHaveLength(90);
  });

  it('offers nothing to pick from without the definitions', () => {
    expect(stationChoices('not loaded', '291', 'ID')).toEqual({ entities: [], states: [], sections: [], counties: [], cqZones: [], ituZones: [] });
  });

  it('takes the command with exactly an entity and a state, each well formed or none', () => {
    expect(validateStorageCommand({ type: 'station-choices', entity: '291', state: 'ID' })).toBe(true);
    expect(validateStorageCommand({ type: 'station-choices', entity: null, state: null })).toBe(true);
    for (const bad of [{ type: 'station-choices', entity: '291' }, { type: 'station-choices', entity: 'US', state: null },
      { type: 'station-choices', entity: '291', state: 'I D;' }, { type: 'station-choices', entity: null, state: null, more: 1 }]) {
      expect(validateStorageCommand(bad)).toBe(false);
    }
  });
});

describe('references are checked against their lists where the list is here (KI7MT 2026-10-20)', () => {
  const lists = {
    parks: async (wanted: string[]) => wanted.filter(code => code === 'US-0001').map(code => ({ code, name: 'Example Park' })),
    locations: async (park: string) => (park === 'US-0001' ? ['US-ID', 'US-WY'] : [])
  };

  it('refuses a location after "@" that POTA does not list for the park', async () => {
    const state = await open();
    try {
      const wrong = await saveStation(state, draft({ MY_POTA_REF: 'US-0001@US-CA' }), ruleset, new Date(), lists);
      expect(wrong).toEqual({ ok: false, problems: [{ field: 'MY_POTA_REF', reason: 'POTA lists US-0001 in US-ID and US-WY, not US-CA.' }] });
      expect((await saveStation(state, draft({ MY_POTA_REF: 'US-0001@US-WY' }), ruleset, new Date(), lists)).ok).toBe(true);
    } finally { state.close(); }
  });

  it('refuses a well-formed park POTA\'s list does not have, naming it, and takes one it has', async () => {
    const state = await open();
    try {
      const missing = await saveStation(state, draft({ MY_POTA_REF: 'US-0001,US-9999' }), ruleset, new Date(), lists);
      expect(missing).toEqual({ ok: false, problems: [{ field: 'MY_POTA_REF', reason: 'POTA\'s park list has no park US-9999.' }] });
      expect((await saveStation(state, draft({ MY_POTA_REF: 'US-0001@US-ID' }), ruleset, new Date(), lists)).ok).toBe(true);
    } finally { state.close(); }
  });

  it('gives a malformed park ADIF\'s reason, not the list\'s, and checks the form only without the list', async () => {
    const state = await open();
    try {
      const malformed = await saveStation(state, draft({ MY_POTA_REF: 'K0001' }), ruleset, new Date(), lists);
      expect(malformed.ok).toBe(false);
      if (!malformed.ok) expect(malformed.problems[0].reason).not.toMatch(/park list/);
      expect((await saveStation(state, draft({ MY_POTA_REF: 'US-9999' }, { name: 'No list' }), ruleset)).ok).toBe(true);
    } finally { state.close(); }
  });

  it('reads a park field as its parks, without the location within one', () => {
    expect(parksIn('us-0001@US-ID, US-0002')).toEqual(['US-0001', 'US-0002']);
    expect(parksIn(undefined)).toEqual([]);
  });

  it('looks parks up in POTA\'s list with their names', async () => {
    const store = openStore(join(root, 'reference.sqlite'), { schema: referenceSchema });
    try {
      for (const statement of readFileSync('drizzle/reference/0000_reference.sql', 'utf8').split('--> statement-breakpoint')) store.connection.exec(statement);
      await store.unit(db => db.insert(potaPark).values({ reference: 'US-0001', name: 'Example Park', active: true, entityId: 291,
        adifEntity: 291, locationDesc: 'US-ID', latitude: 43.6, longitude: -116.2, grid: 'DN13sp', coordinatesUsable: true, coordinatesNote: null }).run());
      expect(await lookUpParks(store, ['US-0001', 'US-9999'])).toEqual([{ code: 'US-0001', name: 'Example Park' }]);
    } finally { store.close(); }
  });

  it('takes the look-up command with a plain reference text only', () => {
    expect(validateStorageCommand({ type: 'look-up-parks', references: 'US-0001@US-ID,US-0002' })).toBe(true);
    for (const bad of ['', 'US-0001<b>', 'x'.repeat(101)]) {
      expect(validateStorageCommand({ type: 'look-up-parks', references: bad })).toBe(false);
    }
  });
});

describe('latitude and longitude in degrees, kept in ADIF\'s form', () => {
  it.each([
    ['43.625', 'lat', 'N043 37.500'], ['-116.2083', 'lon', 'W116 12.498'], ['-33.8688', 'lat', 'S033 52.128'],
    ['0', 'lon', 'E000 00.000'], ['n043 37.500', 'lat', 'N043 37.500']
  ] as const)('%s as a %s is %s', (typed, axis, adif) => {
    expect(typedLocation(typed, axis)).toBe(adif);
  });

  it.each([['91', 'lat'], ['181', 'lon'], ['43,6', 'lat'], ['W116 12.500', 'lat'], ['north', 'lat']] as const)('refuses %s as a %s', (typed, axis) => {
    expect(typedLocation(typed, axis)).toBeUndefined();
  });
});
