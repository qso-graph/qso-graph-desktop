// SPDX-License-Identifier: GPL-3.0-only
// QGD-STN-0010: the US county data built from Census boundaries and named as
// LoTW names counties (Alaska as ADIF does). Read from what the build wrote,
// dist/reference/us-counties.json, so this tests what ships.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { countiesFrom } from '../packages/reference/counties.js';

const data = JSON.parse(readFileSync('dist/reference/us-counties.json', 'utf8'));
const counties = countiesFrom(data);

describe('the county at a position', () => {
  it.each([
    ['Boise', 43.615, -116.2023, 'ID,Ada'],
    ['W1AW, Newington', 41.7147, -72.7272, 'CT,Hartford'],
    ['Alexandria, an independent city', 38.8048, -77.0469, 'VA,Alexandria City'],
    ['Fairfax, the city inside its county', 38.8462, -77.3064, 'VA,Fairfax City'],
    ['Fairfax County, outside the city', 38.84, -77.43, 'VA,Fairfax'],
    ['St. Louis, the city', 38.627, -90.1994, 'MO,Saint Louis City'],
    ['Clayton, St. Louis County', 38.6426, -90.3237, 'MO,Saint Louis'],
    ['Carson City', 39.1638, -119.7674, 'NV,Carson City'],
    ['Pine Ridge, renamed from Shannon County in 2015', 43.0255, -102.5563, 'SD,Oglala Lakota'],
    ['Anchorage', 61.2181, -149.9003, 'AK,Anchorage'],
    ['Valdez, which ADIF still calls Valdez-Cordova', 61.1308, -146.3483, 'AK,Valdez-Cordova'],
    ['Honolulu', 21.3069, -157.8583, 'HI,Honolulu']
  ])('%s', (_place, latitude, longitude, cnty) => {
    expect(counties.at(latitude, longitude)).toBe(cnty);
  });

  it.each([
    ['the Atlantic', 40.0, -60.0],
    ['Toronto', 43.65, -79.38],
    ['Washington, DC, which TQSL gives no county', 38.8977, -77.0365],
    ['San Juan, Puerto Rico, a DXCC entity of its own', 18.4655, -66.1057]
  ])('none in %s', (_place, latitude, longitude) => {
    expect(counties.at(latitude, longitude)).toBeUndefined();
  });
});

describe('the counties a grid square reaches', () => {
  it('DN13 reaches Ada and Canyon, and across the line into Oregon', () => {
    const found = counties.inGrid(43, -118, 44, -116);
    expect(found).toEqual(expect.arrayContaining(['ID,Ada', 'ID,Canyon', 'OR,Malheur']));
  });

  it('a subsquare inside one county gives that county alone', () => {
    // DN13vo, central Boise.
    expect(counties.inGrid(43.583333, -116.25, 43.625, -116.166667)).toEqual(['ID,Ada']);
  });

  it('a subsquare on a county line gives both', () => {
    // DN13sm straddles the line between Ada and Canyon.
    expect(counties.inGrid(43.5, -116.5, 43.541667, -116.416667)).toEqual(['ID,Ada', 'ID,Canyon']);
  });
});

describe('the counties of a state', () => {
  it('has every Census county, named as TQSL names it', () => {
    expect(counties.of('ID')).toHaveLength(44);
    expect(counties.of('TX')).toHaveLength(254);
    // TQSL's value, which is what LoTW matches; "DeKalb" is only its label.
    expect(counties.of('GA')).toContain('Dekalb');
  });

  it('gives Connecticut its 8 counties, as LoTW does, not the 9 planning regions', () => {
    expect(counties.of('CT')).toEqual(['Fairfield', 'Hartford', 'Litchfield', 'Middlesex', 'New Haven', 'New London', 'Tolland', 'Windham']);
  });

  it('gives Virginia its counties and independent cities', () => {
    expect(counties.of('VA')).toHaveLength(95 + 38);
  });

  it('gives Alaska ADIF\'s names, those with no boundary of their own included', () => {
    expect(counties.of('AK')).toEqual(expect.arrayContaining(['Kusilvak', 'Valdez-Cordova', 'Pribilof Islands']));
    expect(counties.of('AK')).not.toContain('Wade Hampton');
  });

  it('leaves out counties that no longer exist', () => {
    expect(counties.of('SD')).not.toContain('Shannon');
    expect(counties.of('VA')).not.toContain('Bedford City');
  });

  it('has none for a territory or for DC', () => {
    expect(counties.of('PR')).toEqual([]);
    expect(counties.of('DC')).toEqual([]);
  });

  it('counts 3,145 in all: TQSL\'s current counties, and ADIF\'s in Alaska', () => {
    expect(Object.values(data.names as Record<string, string[]>).reduce((sum, list) => sum + list.length, 0)).toBe(3145);
    expect(Object.keys(data.names)).toHaveLength(50);
  });
});

describe('a typed county', () => {
  it('is known only as the list spells it', () => {
    expect(counties.has('ID,Ada')).toBe(true);
    expect(counties.has('ID,ada')).toBe(false);
    expect(counties.has('ID,Ada County')).toBe(false);
    expect(counties.has('OR,Ada')).toBe(false);
  });
});

describe('the data file', () => {
  it('is refused if it is not the shape this version reads', () => {
    expect(() => countiesFrom({ format: 2 })).toThrow(/not the shape/);
    expect(() => countiesFrom(null)).toThrow(/not the shape/);
  });
});
