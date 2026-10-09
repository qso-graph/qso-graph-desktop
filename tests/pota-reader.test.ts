// SPDX-License-Identifier: GPL-3.0-only
// The pure half of the POTA load: the CSV reader, the shape checks, and what
// this product is allowed to say about a row it thinks is wrong
// (QGD-REF-0010, QGD-REF-0011, QGD-REF-0013).
//
// The engine suite proves the whole path against a real database and POTA's
// real lists. These are the cases that are awkward to reach from there: a
// column renamed, a reference repeated, an `active` that is neither 0 nor 1,
// and the quoted comma that is the whole reason this reader is written out
// rather than taken from a split.
import { describe, expect, it } from 'vitest';
import {
  judgeCoordinates, parseCsv, readLocations, readParks, readPrograms,
  refuseIfShrunk, ShapeError, PARK_COLUMNS
} from '../packages/reference/pota.js';

const header = `"${PARK_COLUMNS.join('","')}"`;
const park = (
  reference = 'US-0001', name = 'Acadia National Park', active = '1',
  entity = '291', locations = 'US-ME', latitude = '44.31', longitude = '-68.2034', grid = 'FN54vh'
) => `"${reference}","${name}","${active}","${entity}","${locations}","${latitude}","${longitude}","${grid}"`;
const csv = (...rows: string[]) => [header, ...rows].join('\n') + '\n';

describe('reading a CSV', () => {
  it('keeps a comma inside a quoted field', () => {
    // The reason this is written out: a park in three locations publishes
    // them as one quoted field, and a split on commas makes it three columns.
    expect(parseCsv('"a,b","c"\n')).toEqual([['a,b', 'c']]);
  });

  it('reads a doubled quote as one quote', () => {
    expect(parseCsv('"he said ""hello""","x"\n')).toEqual([['he said "hello"', 'x']]);
  });

  it('reads an unquoted field and an empty one', () => {
    expect(parseCsv('a,,c\n')).toEqual([['a', '', 'c']]);
  });

  it('reads a last row with no newline after it', () => {
    expect(parseCsv('"a","b"')).toEqual([['a', 'b']]);
  });

  it('ignores a carriage return before the newline', () => {
    expect(parseCsv('"a","b"\r\n"c","d"\r\n')).toEqual([['a', 'b'], ['c', 'd']]);
  });
});

describe('QGD-REF-0010 a list whose shape is wrong is refused', () => {
  it('refuses a column renamed', () => {
    const renamed = csv(park()).replace('"entityId"', '"entity"');
    expect(() => readParks(renamed)).toThrow(ShapeError);
    expect(() => readParks(renamed)).toThrow(/columns are/);
  });

  it('refuses a column added or removed', () => {
    expect(() => readParks(`${header},"extra"\n${park()},"x"\n`)).toThrow(/columns are/);
    expect(() => readParks('"reference","name"\n"US-0001","Acadia"\n')).toThrow(/columns are/);
  });

  it('refuses a header with no rows, and an empty file', () => {
    expect(() => readParks(`${header}\n`)).toThrow(/header and no parks/);
    expect(() => readParks('')).toThrow(/empty/);
  });

  it('refuses a row with the wrong number of fields', () => {
    expect(() => readParks(`${header}\n"US-0001","Acadia","1"\n`)).toThrow(/has 3 fields, not 8/);
  });

  it('refuses a park with no reference, and one that appears twice', () => {
    expect(() => readParks(csv(park('')))).toThrow(/has no reference/);
    expect(() => readParks(csv(park('US-0001'), park('US-0001', 'Another')))).toThrow(/appears twice/);
  });

  it('refuses an active column that is neither 0 nor 1', () => {
    // POTA publishes 1 and 0. A "true" would mean the column changed meaning,
    // and reading it as truthy would quietly mark every park active.
    expect(() => readParks(csv(park('US-0001', 'Acadia', 'true')))).toThrow(/neither 0 nor 1/);
    expect(() => readParks(csv(park('US-0001', 'Acadia', '')))).toThrow(/neither 0 nor 1/);
  });

  it('refuses a programs list that is not an array of programs', () => {
    expect(() => readPrograms('{"not":"an array"}')).toThrow(/not an array/);
    expect(() => readPrograms('[]')).toThrow(/empty/);
    expect(() => readPrograms('not json at all')).toThrow(/not JSON/);
    expect(() => readPrograms('[{"programId":1}]')).toThrow(/missing programPrefix/);
  });

  it('refuses a locations list missing a field', () => {
    expect(() => readLocations('[{"locationId":2}]')).toThrow(/missing entityId/);
    expect(() => readLocations('[]')).toThrow(/empty/);
  });

  it('refuses a list a fraction of its previous size as a truncated download', () => {
    expect(() => refuseIfShrunk('parks', 100, 96_412)).toThrow(/truncated download/);
    // Half or more is a day's worth of change, not a truncation.
    expect(() => refuseIfShrunk('parks', 50_000, 96_412)).not.toThrow();
    // And a first load has nothing to shrink from.
    expect(() => refuseIfShrunk('parks', 1, undefined)).not.toThrow();
    expect(() => refuseIfShrunk('parks', 1, 0)).not.toThrow();
  });
});

describe('QGD-REF-0011 a published value is stored as published', () => {
  it('keeps a coordinate that cannot exist, and flags it', () => {
    // PH-0128's latitude and longitude are plainly transposed. Swapping them
    // would be this product deciding what POTA meant, so it does not.
    const list = readParks(csv(park('PH-0128', 'A park', '1', '375', 'PH-00', '121.497', '14.5633')));
    const [only] = list.parks;
    expect(only.latitude).toBe(121.497);
    expect(only.longitude).toBe(14.5633);
    expect(only.coordinatesUsable).toBe(false);
    expect(only.coordinatesNote).toContain('beyond the poles');
    expect(only.coordinatesNote).toContain('as published');
  });

  it('flags a park with no coordinates without dropping it', () => {
    const list = readParks(csv(park('US-9999', 'No coordinates', '1', '291', 'US-ME', '', '')));
    expect(list.parks[0].latitude).toBeNull();
    expect(list.parks[0].coordinatesUsable).toBe(false);
    expect(list.counts.noCoordinates).toBe(1);
  });

  it('keeps a retired park', () => {
    const list = readParks(csv(park('US-0002', 'Retired', '0')));
    expect(list.parks[0].active).toBe(false);
    expect(list.counts.retired).toBe(1);
  });

  it('flags a test park by the shape of its reference, not by naming one', () => {
    const list = readParks(csv(park('K-TEST', 'Test Park'), park('VE-TEST', 'Test Park'), park('US-0001')));
    expect(list.parks.filter(entry => entry.isTest).map(entry => entry.reference))
      .toEqual(['K-TEST', 'VE-TEST']);
    expect(list.counts.test).toBe(2);
  });

  it('judges a coordinate pair the same way wherever it is asked', () => {
    expect(judgeCoordinates(44.31, -68.2)).toEqual({ usable: true, note: null });
    expect(judgeCoordinates(-90, 180).usable).toBe(true);
    expect(judgeCoordinates(90.1, 0).usable).toBe(false);
    expect(judgeCoordinates(0, 180.1).usable).toBe(false);
    expect(judgeCoordinates(null, 0).note).toContain('no coordinates');
  });
});

describe('QGD-REF-0012 and QGD-REF-0013 what POTA publishes about a park', () => {
  it("keeps an entity number ADIF does not use, rather than refusing the park", () => {
    // POTA numbers Bonaire 524 where ADIF has 520. The number is kept; the
    // link to ADIF is made later and only where the numbers agree.
    const list = readParks(csv(park('PJ4-0001', 'A park', '1', '524', 'BQ-BO')));
    expect(list.parks[0].entityId).toBe(524);
  });

  it('reads a park with no entity at all', () => {
    const list = readParks(csv(park('XX-0001', 'A park', '1', '')));
    expect(list.parks[0].entityId).toBeNull();
    expect(list.counts.noEntity).toBe(1);
  });

  it('splits a park published in several locations', () => {
    const list = readParks(csv(park('US-0015', 'Potomac Trail', '1', '291', 'US-DC,US-MD,US-WV')));
    expect(list.parks[0].locations).toEqual(['US-DC', 'US-MD', 'US-WV']);
    // And keeps the published cell whole beside it.
    expect(list.parks[0].locationDesc).toBe('US-DC,US-MD,US-WV');
    expect(list.counts.multipleLocations).toBe(1);
  });

  it('reads a park published with no location', () => {
    const list = readParks(csv(park('XX-0002', 'A park', '1', '291', '')));
    expect(list.parks[0].locations).toEqual([]);
    expect(list.parks[0].locationDesc).toBe('');
  });

  it("reads a program's active flag from POTA's 1 and 0, not from truthiness", () => {
    const [active, retired] = readPrograms(JSON.stringify([
      { programId: 85, programPrefix: 'AF', programName: 'Afghanistan', isActive: 1, isocc: 'AF', location_unit: 'Province', isolang: 'fas' },
      { programId: 86, programPrefix: 'XX', programName: 'Somewhere', isActive: 0, isocc: null, location_unit: null, isolang: null }
    ]));
    expect(active.active).toBe(true);
    expect(retired.active).toBe(false);
    expect(retired.isoCountry).toBeNull();
    expect(active.locationUnit).toBe('Province');
  });

  it('keeps a location whose entity POTA leaves out', () => {
    const [only] = readLocations(JSON.stringify([{
      locationId: 2, entityId: null, entityName: null, locationDesc: 'US-AK',
      locationName: 'Alaska', latitude: 61.37, longitude: -152.4, iso: 'US-AK'
    }]));
    expect(only.entityId).toBeNull();
    expect(only.locationDesc).toBe('US-AK');
    expect(only.latitude).toBe(61.37);
  });
});
