// SPDX-License-Identifier: GPL-3.0-only
// The active station as an extension sees it (QGD-HOM-0009, QGD-STN-0003):
// name, grid and position, never the address.
import { describe, expect, it } from 'vitest';
import { activeStationBrief, fromAdifLocation, gridCentre } from '../packages/main/station-brief.js';
import type { StationsView } from '../packages/storage/station-contract.js';

const ID = '0b6f4a2e-1c3d-4e5f-8a9b-0c1d2e3f4a5b';
const view = (place: Record<string, string>, active: string | null = ID, notes?: string): StationsView =>
  ({ list: [{ id: ID, name: 'Home', place, ...(notes ? { notes } : {}) }], defaults: {}, active, checked: true });

describe('the active station for an extension', () => {
  it('carries the name, grid and position, and never the street, city or postal code', () => {
    const brief = activeStationBrief(view({
      MY_GRIDSQUARE: 'DN13sm', MY_LAT: 'N043 37.500', MY_LON: 'W116 12.500',
      MY_STREET: '1 Main', MY_CITY: 'Boise', MY_POSTAL_CODE: '83702', MY_STATE: 'ID'
    }, ID, 'Gate code 4417'));
    expect(brief).toEqual({ name: 'Home', grid: 'DN13sm', latitude: 43.625, longitude: -(116 + 12.5 / 60) });
    expect(JSON.stringify(brief)).not.toMatch(/Main|Boise|83702|4417/);
  });

  it('takes the position from the grid\'s centre when the station has no MY_LAT and MY_LON', () => {
    expect(activeStationBrief(view({ MY_GRIDSQUARE: 'DN13' }))).toEqual({ name: 'Home', grid: 'DN13', latitude: 43.5, longitude: -117 });
  });

  it('takes a station on a grid line as its grids, at the line', () => {
    const brief = activeStationBrief(view({ MY_VUCC_GRIDS: 'DN13,DN14' }));
    expect(brief?.grid).toBe('DN13,DN14');
    expect(brief?.latitude).toBeCloseTo(44, 6);
    expect(brief?.longitude).toBeCloseTo(-117, 6);
  });

  it('gives a grid, or a line or corner of grids, a position', async () => {
    const { gridPosition } = await import('../packages/storage/station-contract.js');
    expect(gridPosition('DN13')).toEqual({ latitude: 43.5, longitude: -117 });
    expect(gridPosition('DN13,DN14,DN23,DN24')).toEqual({ latitude: 44, longitude: -116 });
    expect(gridPosition('DN1')).toBeUndefined();
    expect(gridPosition(undefined)).toBeUndefined();
  });

  it('puts a grid pair across the date line on the date line', () => {
    const brief = activeStationBrief(view({ MY_VUCC_GRIDS: 'RJ90,AJ00' }));
    expect(Math.abs(brief!.longitude!)).toBeCloseTo(180, 6);
  });

  it('is the name alone with no grid or position, and none with no station active', () => {
    expect(activeStationBrief(view({ MY_POTA_REF: 'US-0001' }))).toEqual({ name: 'Home' });
    expect(activeStationBrief(view({ MY_GRIDSQUARE: 'DN13' }, null))).toBeNull();
    expect(activeStationBrief(undefined)).toBeNull();
  });
});

describe('Maidenhead and ADIF\'s Location', () => {
  it.each([
    // FN31pr is W1AW's grid, in Newington, Connecticut, at about 41.71 N, 72.73 W.
    ['JJ', 5, 10], ['DN13', 43.5, -117], ['DN13sm', 43.5208, -116.4583], ['FN31pr', 41.7292, -72.7083], ['QF56od', -33.8542, 151.2083],
    ['dn13SM', 43.5208, -116.4583], ['DN13sm46', 43.5271, -116.4625]
  ])('%s is centred at %d, %d', (grid, latitude, longitude) => {
    const centre = gridCentre(grid);
    expect(centre?.latitude).toBeCloseTo(latitude, 3);
    expect(centre?.longitude).toBeCloseTo(longitude, 3);
  });

  it.each(['', 'D', 'DN1', 'SN13', 'DN13zz', 'DN13smAA'])('refuses %j', (grid) => {
    expect(gridCentre(grid)).toBeUndefined();
  });

  it('reads ADIF\'s XDDD MM.MMM', () => {
    expect(fromAdifLocation('N043 37.500')).toBeCloseTo(43.625, 6);
    expect(fromAdifLocation('S033 52.128')).toBeCloseTo(-33.8688, 4);
    expect(fromAdifLocation('W000 00.006')).toBeCloseTo(-0.0001, 6);
    for (const bad of ['N091 00.000', 'X043 37.500', '43.625', 'N043 60.000', undefined]) expect(fromAdifLocation(bad)).toBeUndefined();
  });
});

describe('the grid from a position (KI7MT, 2026-10-22)', () => {
  it.each([
    // W1AW, Newington CT; Boise; Sydney; the four corners and the poles.
    [41.7148, -72.7272, 6, 'FN31pr'], [43.6458, -116.375, 6, 'DN13tp'], [-33.8688, 151.2093, 6, 'QF56od'],
    [43.6458, -116.375, 4, 'DN13'], [43.6458, -116.375, 2, 'DN'], [43.5271, -116.4625, 8, 'DN13sm46'],
    [90, 180, 4, 'RR99'], [-90, -180, 4, 'AA00']
  ] as const)('%d, %d to %d characters is %s', async (latitude, longitude, length, grid) => {
    const { gridOf } = await import('../packages/storage/station-contract.js');
    expect(gridOf(latitude, longitude, length)).toBe(grid);
  });

  it('goes back to the position the grid came from', async () => {
    const { gridOf, gridCentre } = await import('../packages/storage/station-contract.js');
    for (const grid of ['DN13tp', 'FN31pr', 'QF56od', 'AA00aa', 'RR99xx', 'JJ00aa']) {
      const centre = gridCentre(grid)!;
      expect(gridOf(centre.latitude, centre.longitude, 6)).toBe(grid);
    }
  });

  it('gives nothing outside the world', async () => {
    const { gridOf } = await import('../packages/storage/station-contract.js');
    expect(gridOf(91, 0)).toBeUndefined();
    expect(gridOf(0, 181)).toBeUndefined();
    expect(gridOf(Number.NaN, 0)).toBeUndefined();
  });
});
