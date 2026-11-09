// SPDX-License-Identifier: GPL-3.0-or-later
import { randomUUID } from 'node:crypto';
import type { NativeLotwPreview } from '../callsign-core/native.js';
import { isStation, sameStationName, MAX_NAME, type Station, type Place } from '../storage/station-contract.js';

// QGD-LTW-0008, QGD-STN-0008/0009. Only ADIF's public place fields leave the preview.
export function lotwLocations(locations: NativeLotwPreview['locations'], existing: readonly string[]) {
  const taken = [...existing];
  const has = (name: string) => taken.some(other => sameStationName(other, name));
  const stations: Station[] = [];
  const skipped: { name: string; reason: string }[] = [];
  for (const location of locations) {
    let name = location.name.trim();
    if (has(name)) {
      name = `${location.name.trim()} (TQSL)`;
      let number = 2;
      while (has(name)) name = `${location.name.trim()} (TQSL) ${number++}`;
    }
    const fields = Object.fromEntries(location.fields.map(f => [f.name, f.value]));
    const place: Place = {};
    const copy = (source: string, target: keyof Place) => { if (fields[source]) place[target] = fields[source]; };
    copy('DXCC', 'MY_DXCC'); copy('CQZ', 'MY_CQ_ZONE'); copy('ITUZ', 'MY_ITU_ZONE'); copy('IOTA', 'MY_IOTA');
    for (const field of ['US_STATE', 'CA_PROVINCE', 'RU_OBLAST', 'CN_PROVINCE', 'AU_STATE', 'JA_PREFECTURE', 'FI_KUNTA']) copy(field, 'MY_STATE');
    if (fields.US_COUNTY) place.MY_CNTY = `${fields.US_STATE},${fields.US_COUNTY}`;
    copy('JA_CITY_GUN_KU', 'MY_CNTY');
    if (fields.GRIDSQUARE) {
      const grid = fields.GRIDSQUARE.split(',').map(g => g.slice(0,4).toUpperCase() + g.slice(4,6).toLowerCase() + g.slice(6)).join(',');
      place[grid.includes(',') ? 'MY_VUCC_GRIDS' : 'MY_GRIDSQUARE'] = grid;
    }
    const lotwPark = fields.US_PARK || fields.CA_US_PARK || fields.DX_US_PARK;
    const station: Station = { id: randomUUID(), name, place, ...(lotwPark ? { lotwPark } : {}) };
    if (name.length > MAX_NAME || !isStation(station)) {
      skipped.push({ name: location.name, reason: 'The name or place fields cannot be held by a Desktop Location.' });
      continue;
    }
    stations.push(station); taken.push(name);
  }
  return { stations, skipped };
}
