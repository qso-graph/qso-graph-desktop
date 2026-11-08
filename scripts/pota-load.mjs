// SPDX-License-Identifier: GPL-3.0-or-later
// P5-pota-sources, P5-pota-freshness, P5-pota-unaltered, P5-pota-entities and
// P5-pota-locations (QGD-REF-0009 to QGD-REF-0013).
//
// Built into reference.sqlite by the product's own Reference and build
// (QGD-ENG-0015). The lists come from vendor/pota, which `make setup` fetched from POTA and
// read with the product's own readers — so the live shape is checked once a
// setup rather than on every run of the gate, and `make verify` needs no
// network. The loading, the conditional asking, the shape checks and the
// keep-the-last-good behaviour are all the real ones.
//
// What this must not become is a run that passes because POTA's data happens
// to be well behaved. The rows that make QGD-REF-0011 and QGD-REF-0012 worth
// writing — the four impossible coordinates, the 13 entity numbers that are
// not ADIF's, the 1,618 parks in several locations — are asserted to be there
// and to have survived the load exactly as published.
import { expect } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import { redact } from './report.mjs';
import { readParks } from '../dist/reference/pota.js';
import { layout, openState } from '../dist/storage/layout.js';
import { Reference } from '../dist/storage/reference.js';
import { buildReference } from '../dist/storage/reference-build.js';
import { referenceRefresh } from '../dist/storage/schema.js';

const register = JSON.parse(await readFile('data/reference-sources.json', 'utf8'));
const cacheRoot = resolve('vendor', 'pota');

// What make setup fetched, with the validators POTA answered with.
const bodies = {};
const headers = {};
for (const [list, source] of Object.entries(register.pota.sources)) {
  const path = join(cacheRoot, `${list}.${source.format}`);
  const body = await readFile(path, 'utf8').catch(() => undefined);
  if (body === undefined) {
    console.error(`POTA's ${list} list is not in ${cacheRoot}. Fetch it with: make setup`);
    process.exit(1);
  }
  bodies[list] = body;
  headers[list] = JSON.parse(await readFile(join(cacheRoot, `${list}.headers.json`), 'utf8'));
}

// Stands in for POTA's servers, and behaves as they do: the park list answers
// a conditional request with 304, and the two API lists offer no validator at
// all, so they always answer fresh.
let asked = [];
const serve = (overrides = {}) => async (url, conditional) => {
  const list = Object.entries(register.pota.sources).find(([, source]) => source.url === url)?.[0];
  if (!list) throw new Error(`nothing in the register has the URL ${url}`);
  asked.push({ list, conditional });
  if (overrides[list]) return overrides[list](conditional);
  const validators = headers[list];
  if (validators.etag && conditional.etag === validators.etag) return { status: 'unchanged' };
  return {
    status: 'fresh', body: bodies[list],
    etag: validators.etag ?? null, lastModified: validators.lastModified ?? null
  };
};

const root = await mkdtemp(join(tmpdir(), 'qg-pota-'));
const paths = layout(join(root, 'QSO Graph Desktop'));
const notes = [];
const opened = [];
const DAY = 24 * 60 * 60 * 1000;
// A clock for the freshness cases. Each step is a day and a minute past the
// one before it, so it lands outside the window it is meant to be past.
const start = Date.now();
const day = count => new Date(start + count * (DAY + 60_000));
let now = new Date(start);
let fetchText = serve();

// Rows as objects from the live, read-only file. The SQL is written here in full.
const rows = (reference, text, ...params) => reference.reader().connection.prepare(text).all(...params);
const counts = (reference) => rows(reference, `
  SELECT (SELECT count(*) FROM pota_park) AS parks, (SELECT count(*) FROM pota_program) AS programs,
         (SELECT count(*) FROM pota_location) AS locations, (SELECT count(*) FROM pota_park_location) AS pairs`)[0];
const sourceOf = (reference, id) => rows(reference,
  'SELECT sha256, etag, last_modified, fetched_at, row_count FROM source WHERE id = ?', id)[0];

try {
  // The ADIF archive too, because QGD-REF-0012's link is POTA's numbers
  // meeting ADIF's and there is nothing to meet without it.
  const adifArchive = await readFile(resolve('vendor', '.cache', `adif-${register.adif.version}.zip`));
  const state = await openState(paths, resolve('drizzle/state'), 'pota-load');
  opened.push(state);
  const reference = new Reference({
    paths, ddl: resolve('drizzle/reference'), register, state,
    fetchArchive: async () => adifArchive,
    fetchText: (url, conditional) => fetchText(url, conditional),
    now: () => now,
    build: (target, ddl, inputs) => buildReference(target, ddl, inputs)
  });
  opened.push(reference);
  const started = await reference.refresh();
  expect(started.status.adif.state).toBe('loaded');
  for (const list of ['parks', 'programs', 'locations']) {
    expect(started.pota[list].state, `${list} must load`).toBe('loaded');
  }

  try {
    // ---- P5-pota-sources: all three in reference.sqlite, counted ---------
    const expected = readParks(bodies.parks, register.pota.sources.parks.columns);
    const held = counts(reference);
    expect(held.parks, 'every park POTA published must be in the file').toBe(expected.parks.length);
    expect(held.programs).toBe(JSON.parse(bodies.programs).length);
    expect(held.locations).toBe(JSON.parse(bodies.locations).length);
    for (const list of ['parks', 'programs', 'locations']) {
      const source = sourceOf(reference, `pota-${list}`);
      expect(source, `pota-${list} must have a source row`).toBeTruthy();
      expect(source.sha256, 'POTA is not pinned by checksum (QGD-REF-0010)').toBeNull();
      expect(source.row_count).toBeGreaterThan(0);
      expect(Number.isNaN(Date.parse(source.fetched_at))).toBe(false);
    }
    // The park list offers both validators and they are recorded; the two API
    // lists offer neither, which is recorded as null rather than invented.
    const parkSource = sourceOf(reference, 'pota-parks');
    expect(parkSource.etag, "POTA's park list offers an ETag and it must be kept").toBeTruthy();
    expect(parkSource.last_modified).toBeTruthy();
    expect(sourceOf(reference, 'pota-programs').etag,
      'POTA offers no validator for the programs endpoint; null says so').toBeNull();
    notes.push(`${held.parks} parks, ${held.programs} programs and ${held.locations} locations in reference.sqlite, ` +
      'each with its source recorded and none pinned by checksum');

    // ---- P5-pota-locations: a row per park per location -----------------
    {
      const multiple = expected.parks.filter(park => park.locations.length > 1);
      expect(multiple.length, 'POTA publishes parks in more than one location').toBeGreaterThan(1000);
      const pairsExpected = new Set();
      for (const park of expected.parks) for (const location of park.locations) {
        pairsExpected.add(`${park.reference} ${location}`);
      }
      expect(held.pairs, 'one row per park per location').toBe(pairsExpected.size);
      expect(held.pairs).toBeGreaterThan(held.parks);

      const sample = multiple[0];
      const split = rows(reference, 'SELECT location_desc FROM pota_park_location WHERE reference = ? ORDER BY location_desc',
        sample.reference);
      expect(split.map(row => row.location_desc)).toEqual([...sample.locations].sort());
      const whole = rows(reference, 'SELECT location_desc FROM pota_park WHERE reference = ?', sample.reference);
      expect(whole[0].location_desc, 'the published cell is kept as published').toBe(sample.locationDesc);

      const withNone = expected.parks.filter(park => park.locations.length === 0);
      if (withNone.length) {
        expect(rows(reference, 'SELECT 1 FROM pota_park WHERE reference = ?', withNone[0].reference).length,
          'a park with no location still loads').toBe(1);
      }
      notes.push(`${pairsExpected.size} park-location rows for ${held.parks} parks, ` +
        `${multiple.length} of them published in more than one`);
    }

    // ---- P5-pota-unaltered: stored as published, flagged ---------------
    {
      const impossible = expected.parks.filter(park => park.latitude !== null && !park.coordinatesUsable);
      expect(impossible.length, 'POTA publishes parks whose coordinates cannot exist').toBeGreaterThan(0);
      for (const park of impossible) {
        const row = rows(reference, `SELECT name, latitude, longitude, coordinates_usable, coordinates_note
          FROM pota_park WHERE reference = ?`, park.reference);
        expect(row.length, `${park.reference} must still be there`).toBe(1);
        // Exactly as published: not clamped, not swapped, not dropped (QGD-REF-0011).
        expect(row[0].latitude).toBe(park.latitude);
        expect(row[0].longitude).toBe(park.longitude);
        expect(row[0].coordinates_usable, 'and flagged as unusable').toBe(0);
        expect(row[0].coordinates_note).toContain('as published');
        expect(row[0].name, 'still found by reference').toBe(park.name);
      }
      const usable = rows(reference, 'SELECT count(*) AS n FROM pota_park WHERE coordinates_usable')[0];
      expect(usable.n).toBe(expected.parks.filter(park => park.coordinatesUsable).length);
      const mapped = rows(reference, `SELECT count(*) AS n FROM pota_park
        WHERE coordinates_usable AND (latitude < -90 OR latitude > 90 OR longitude < -180 OR longitude > 180)`)[0];
      expect(mapped.n, 'nothing usable may hold an impossible coordinate').toBe(0);

      const retired = rows(reference, 'SELECT count(*) AS n FROM pota_park WHERE NOT active')[0];
      expect(retired.n).toBe(expected.counts.retired);
      expect(retired.n).toBeGreaterThan(0);

      const test = rows(reference, 'SELECT reference, name FROM pota_park WHERE is_test ORDER BY reference');
      expect(test.length, 'POTA publishes a test park and it must be flagged').toBeGreaterThan(0);
      for (const row of test) expect(row.reference).toMatch(/-TEST$/);
      notes.push(`${impossible.length} parks with impossible coordinates stored as published and flagged, ` +
        `${retired.n} retired parks kept, ${test.length} test park flagged`);
    }

    // ---- P5-pota-entities: POTA's number is POTA's ---------------------
    {
      const adifEntities = new Set(rows(reference,
        "SELECT key FROM enumeration_value WHERE enumeration = 'DXCC_Entity_Code'").map(row => row.key));
      expect(adifEntities.size, "ADIF's DXCC entities must be loaded for this to mean anything").toBeGreaterThan(300);

      const potaEntities = new Set(expected.parks.map(park => park.entityId).filter(entity => entity !== null).map(String));
      const notAdif = [...potaEntities].filter(entity => !adifEntities.has(entity));
      expect(notAdif.length, 'POTA numbers some entities its own way; that is the premise of QGD-REF-0012')
        .toBeGreaterThan(0);

      const affected = expected.parks.filter(park => park.entityId !== null && !adifEntities.has(String(park.entityId)));
      const loaded = rows(reference, `SELECT reference, entity_id, adif_entity FROM pota_park
        WHERE entity_id IN (SELECT value FROM json_each(?)) ORDER BY reference`,
        JSON.stringify([...new Set(affected.map(park => park.entityId))]));
      expect(loaded.length, 'every park in an entity ADIF does not number must still be loaded').toBe(affected.length);
      for (const row of loaded) {
        expect(row.entity_id, "POTA's number is kept").not.toBeNull();
        expect(row.adif_entity, 'and no ADIF entity is claimed for it').toBeNull();
      }
      const linked = rows(reference, 'SELECT count(*) AS n FROM pota_park WHERE adif_entity IS NOT NULL AND adif_entity = entity_id')[0];
      expect(linked.n).toBeGreaterThan(held.parks / 2);
      const wrong = rows(reference, 'SELECT count(*) AS n FROM pota_park WHERE adif_entity IS NOT NULL AND adif_entity <> entity_id')[0];
      expect(wrong.n, 'the link is the same number or nothing, never a translation').toBe(0);
      notes.push(`${notAdif.length} of ${potaEntities.size} POTA entity numbers are not ADIF DXCC codes; ` +
        `the ${affected.length} parks in them are loaded with no ADIF link, ${linked.n} parks linked`);
    }

    // ---- P5-pota-freshness ---------------------------------------------
    {
      const lastCheck = async (id) => (await state.unit(db =>
        db.select().from(referenceRefresh).where(eq(referenceRefresh.sourceId, id)).get()))?.lastCheck;

      // A second refresh within the day does not ask at all.
      asked = [];
      const soon = await reference.refresh();
      expect(['parks', 'programs', 'locations'].map(list => soon.pota[list].state))
        .toEqual(['fresh enough', 'fresh enough', 'fresh enough']);
      expect(asked, 'a list loaded today must not be asked for again').toEqual([]);

      // A day later it asks, conditionally, with what the last load recorded,
      // and POTA's 304 replaces nothing.
      asked = [];
      now = day(1);
      const before = counts(reference);
      const parksBefore = sourceOf(reference, 'pota-parks');
      const later = await reference.refresh();
      expect(later.pota.parks.state, 'the park list answers 304 to a conditional ask').toBe('unchanged');
      expect(asked.find(ask => ask.list === 'parks').conditional.etag,
        'and it was asked with the ETag the last load recorded').toBe(headers.parks.etag);
      expect(counts(reference), 'nothing may be replaced by a 304').toEqual(before);
      // The time of asking is recorded in state.sqlite. The file keeps the
      // time POTA last sent the data, which is what its provenance is.
      expect(await lastCheck('pota-parks'), 'only the time of asking is written down').toBe(now.toISOString());
      expect(sourceOf(reference, 'pota-parks').fetched_at).toBe(parksBefore.fetched_at);
      notes.push('a list loaded today is not asked for again; a day later it is asked conditionally ' +
        'and a 304 replaces nothing');

      // A fetch that fails leaves the previous data exactly as it was.
      now = day(2);
      fetchText = serve({
        parks: async () => { throw new Error('getaddrinfo ENOTFOUND pota.app'); },
        programs: async () => { throw new Error('500'); },
        locations: async () => { throw new Error('socket hang up'); }
      });
      const broken = await reference.refresh();
      for (const list of ['parks', 'programs', 'locations']) {
        expect(broken.pota[list], `${list} must be kept`).toEqual({ state: 'kept', failure: { kind: 'fetch' } });
        expect(broken.status.pota[list].rows, 'and the count of what was kept is known').toBeGreaterThan(0);
      }
      expect(counts(reference), 'a failed fetch must change nothing').toEqual(before);

      // A list that arrives malformed is refused the same way, by the shape
      // check and not by the database. Refused as a kind, never quoting the
      // data it refused (QGD-ENG-0016).
      now = day(3);
      fetchText = serve({
        parks: async () => ({
          status: 'fresh', etag: 'other', lastModified: null,
          body: '"reference","name","active","entity","locationDesc","latitude","longitude","grid"\n' +
            '"XX-0001","A park","1","291","US-ME","44.0","-68.0","FN54"\n'
        }),
        programs: async () => ({ status: 'fresh', etag: null, lastModified: null, body: '{"not":"an array"}' }),
        locations: async () => ({ status: 'fresh', etag: null, lastModified: null, body: '[]' })
      });
      const malformed = await reference.refresh();
      for (const list of ['parks', 'programs', 'locations']) {
        expect(malformed.pota[list], `${list} must be kept`).toEqual({ state: 'kept', failure: { kind: 'shape' } });
      }
      expect(counts(reference), 'a malformed list must change nothing').toEqual(before);

      // A list a fraction of its previous size is a truncated download. Its
      // shape is right, so only the shrink check can refuse it.
      now = day(4);
      fetchText = serve({
        parks: async () => ({
          status: 'fresh', etag: 'shorter', lastModified: null,
          body: bodies.parks.split('\n').slice(0, 100).join('\n') + '\n'
        })
      });
      const truncated = await reference.refresh();
      expect(truncated.pota.parks, 'a list that lost most of its rows is refused').toEqual({ state: 'kept', failure: { kind: 'shape' } });
      expect(counts(reference).parks).toBe(before.parks);

      // And the control: a list that really did change is loaded. Without
      // this, every assertion above would pass on a loader that refuses
      // everything.
      const changed = bodies.parks.replace('"Acadia National Park"', '"Acadia National Park (renamed)"');
      expect(changed, 'the fixture must actually differ').not.toBe(bodies.parks);
      now = day(5);
      fetchText = serve({
        parks: async () => ({ status: 'fresh', etag: 'new-etag', lastModified: null, body: changed })
      });
      const accepted = await reference.refresh();
      expect(accepted.pota.parks.state).toBe('loaded');
      expect(accepted.built).toBe(true);
      expect(rows(reference, "SELECT name FROM pota_park WHERE reference = 'US-0001'")[0].name).toBe('Acadia National Park (renamed)');
      expect(sourceOf(reference, 'pota-parks').etag).toBe('new-etag');
      notes.push('a failed fetch, a malformed list and a truncated one each keep the last good data; ' +
        'a list that changed is loaded');
    }
  } finally {
    for (const handle of opened.reverse()) { try { handle.close(); } catch { /* closing what is left */ } }
  }

  console.log(`POTA load: ${notes.length} checks: PASS`);
  for (const note of notes) console.log(`  ${note}`);
} catch (error) {
  console.error('POTA load failed.');
  console.error(redact(String(error?.stack ?? error?.message ?? error)).split('\n').slice(0, 24).join('\n'));
  process.exitCode = 1;
} finally {
  await rm(root, { recursive: true, force: true });
}
