// SPDX-License-Identifier: GPL-3.0-only
// The static gates P9 registered: P9-tqsl's field list against TQSL's own,
// P9-grid-typed's field list, P9-kind's "no code path writes the kind into
// ADIF", and P9-not-tqsl's "no code reads, writes or names TQSL's station data
// file". Each reads the source or the contract rather than trusting a comment.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { definitionsOf } from '../packages/reference/adif.js';
import { STATION_FIELDS, isStationDraft } from '../packages/storage/station-contract.js';

const register = JSON.parse(readFileSync('data/reference-sources.json', 'utf8'));
const definitions = definitionsOf(JSON.parse(readFileSync(
  `vendor/adif/${register.adif.version}/${register.adif.source.definitions}`, 'utf8')));
const tqsl = JSON.parse(readFileSync('data/tqsl-station-fields.json', 'utf8'));

// The product's source: what ships, not its tests, stories or scripts.
function sources(directory: string): string[] {
  return readdirSync(directory).flatMap(name => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) {
      return ['node_modules', 'target', 'dist', 'tests'].includes(name) ? [] : sources(path);
    }
    return /\.(ts|svelte|rs|mjs|js)$/.test(name) && !/\.(test|stories)\./.test(name) ? [path] : [];
  });
}
// With forward slashes on every system, so the names below match on Windows
// too, where join() writes backslashes (CI, 2026-10-22).
const product = [...sources('packages'), ...sources('extensions')].map(file => file.replaceAll('\\', '/'));

describe('P9-tqsl: TQSL\'s station location fields, from its config.xml (QGD-STN-0009)', () => {
  it('records which config.xml, by version and SHA-256', () => {
    expect(tqsl.source.url).toMatch(/^https:\/\//);
    expect(tqsl.source.configVersion).toMatch(/^\d+\.\d+$/);
    expect(tqsl.source.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('gives every field a home that a Location holds', () => {
    const homes = new Set<string>([...STATION_FIELDS, 'lotwPark', 'callsign', 'none']);
    for (const [field, entry] of Object.entries<{ home: string; also?: string }>(tqsl.fields)) {
      expect(homes.has(entry.home), `${field}'s home ${entry.home} is not something a Location holds`).toBe(true);
      if (entry.also) expect(homes.has(entry.also), `${field}'s other home ${entry.also}`).toBe(true);
    }
    // Every entity TQSL has a page for (US, Canada, Russia, China, Australia,
    // Japan, Finland) is in the list, so none was dropped by hand.
    for (const field of ['US_STATE', 'US_COUNTY', 'CA_PROVINCE', 'RU_OBLAST', 'CN_PROVINCE', 'AU_STATE',
      'JA_PREFECTURE', 'JA_CITY_GUN_KU', 'FI_KUNTA']) expect(tqsl.fields).toHaveProperty(field);
  });
});

describe('P9-grid-typed: a Location holds ADIF\'s fields and four of its own (QGD-STN-0007)', () => {
  it('holds only fields ADIF defines in its place', () => {
    for (const field of STATION_FIELDS) expect(definitions.Fields.Records, `${field} is not an ADIF field`).toHaveProperty(field);
  });

  it('has nothing beside its place but its name, kind, LoTW park and notes', () => {
    const draft = { name: 'x', kind: 'Home', place: { MY_GRIDSQUARE: 'DN13' } };
    expect(isStationDraft(draft)).toBe(true);
    expect(isStationDraft({ ...draft, lotwPark: 'NP33', notes: 'gate code' })).toBe(true);
    expect(isStationDraft({ ...draft, gps: '43.6,-116.2' })).toBe(false);
    expect(isStationDraft({ ...draft, place: { ...draft.place, KIND: 'Home' } })).toBe(false);
  });
});

describe('P9-kind: no code path writes the kind into ADIF (QGD-STN-0004)', () => {
  // The kind is beside the place, never in it, so ADIF built from a place
  // cannot carry it. What could still leak it is code outside the stations
  // themselves that reads a station. Every module that imports the station
  // contract is named here; a new one fails until someone has looked at what
  // it does with the kind.
  const readers = new Set([
    'packages/main/station-brief.ts', 'packages/renderer/Shell.svelte', 'packages/renderer/pages/StationsPage.svelte',
    'packages/renderer/app.ts', 'packages/storage/stations.ts', 'packages/storage/storage-contract.ts',
    'packages/storage/storage-service.ts'
  ]);

  it('is read by the modules listed here and no others', () => {
    const importers = product.filter(file => /station-contract(\.js)?['"]/.test(readFileSync(file, 'utf8')));
    expect(new Set(importers)).toEqual(readers);
  });

  it('is not in what an extension is given', () => {
    expect(readFileSync('packages/main/station-brief.ts', 'utf8')).not.toMatch(/\bkind\b/);
  });

  it('is never written by the ADIF code', () => {
    const adif = product.filter(path => path.startsWith('packages/reference/'));
    // An empty list would pass this on any code, which is how it passed on
    // Windows before the paths were made the same.
    expect(adif.length, 'the ADIF code is found').toBeGreaterThan(3);
    for (const file of adif) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/station-contract|stations\.js/);
    }
  });
});

describe('P9-not-tqsl: TQSL\'s station data file is TQSL\'s (QGD-STN-0008)', () => {
  it('is not named anywhere in the product', () => {
    // TQSL keeps station locations in station_data in its own folder (.tqsl
    // on Linux and macOS, TrustedQSL on Windows). Naming any of them in a
    // string is the first step to reading it.
    const named = /["'`][^"'`\n]*(station_data|\.tqsl\b|TrustedQSL)[^"'`\n]*["'`]/i;
    const offenders = product.filter(file => named.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('would be caught if it were', () => {
    const named = /["'`][^"'`\n]*(station_data|\.tqsl\b|TrustedQSL)[^"'`\n]*["'`]/i;
    expect(named.test("join(home, '.tqsl', 'station_data')")).toBe(true);
    expect(named.test('const folder = `${appData}/TrustedQSL`;')).toBe(true);
    expect(named.test('// TQSL keeps its own station locations')).toBe(false);
  });
});
