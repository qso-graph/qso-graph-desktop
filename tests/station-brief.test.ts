// SPDX-License-Identifier: GPL-3.0-only
// The active station as an extension sees it (QGD-HOM-0009, QGD-STN-0003):
// name, grid and position, never the address.
import { describe, expect, it } from 'vitest';
import { activeStationBrief, fromAdifLocation, gridCentre } from '../packages/main/station-brief.js';
import type { StationsView } from '../packages/storage/station-contract.js';

const ID = '0b6f4a2e-1c3d-4e5f-8a9b-0c1d2e3f4a5b';
const view = (place: Record<string, string>, active: string | null = ID): StationsView =>
  ({ list: [{ id: ID, name: 'Home', place }], defaults: {}, active, checked: true });

describe('the active station for an extension', () => {
  it('carries the name, grid and position, and never the street, city or postal code', () => {
    const brief = activeStationBrief(view({
      MY_GRIDSQUARE: 'DN13sm', MY_LAT: 'N043 37.500', MY_LON: 'W116 12.500',
      MY_STREET: '1 Main', MY_CITY: 'Boise', MY_POSTAL_CODE: '83702', MY_STATE: 'ID'
    }));
    expect(brief).toEqual({ name: 'Home', grid: 'DN13sm', latitude: 43.625, longitude: -(116 + 12.5 / 60) });
    expect(JSON.stringify(brief)).not.toMatch(/Main|Boise|83702/);
  });

  it('takes the position from the grid\'s centre when the station has no MY_LAT and MY_LON', () => {
    expect(activeStationBrief(view({ MY_GRIDSQUARE: 'DN13' }))).toEqual({ name: 'Home', grid: 'DN13', latitude: 43.5, longitude: -117 });
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
