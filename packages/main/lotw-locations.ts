// SPDX-License-Identifier: GPL-3.0-or-later
import { randomUUID } from 'node:crypto';
import type { NativeLotwPreview } from '../callsign-core/native.js';
import { isStation, sameStationName, MAX_NAME, type Station } from '../storage/station-contract.js';

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
    if (location.reason) { skipped.push({ name: location.name, reason: location.reason }); continue; }
    const station: Station = { id: randomUUID(), name, place: { ...location.place }, ...(location.park ? { lotwPark: location.park } : {}) };
    if (name.length > MAX_NAME || !isStation(station)) {
      skipped.push({ name: location.name, reason: 'The name or place fields cannot be held by a Desktop Location.' });
      continue;
    }
    stations.push(station); taken.push(name);
  }
  return { stations, skipped };
}
