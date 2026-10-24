// SPDX-License-Identifier: GPL-3.0-only
// Near Me (QGD-HOM-0013): the parks nearest the active Location, from POTA's
// park list alone, for an activator in the field with or without internet
// (KI7MT, 2026-10-23: "Near Me can't rely on internet, and must be stand
// alone, and we already have that data"). Pure: it takes the parks and the
// station and returns the page.
import type { NearPark, PotaPlace, StationBrief } from '../../../packages/extension-api/api-contract.js';
import type { PageAnswer, Section } from '../../../packages/extension-api/pages.js';
import { WITHIN, bearingDegrees, distanceKm } from './activate.js';
import { placeCells, placesBy, withPlaces } from './places.js';

export function nearPage(parks: readonly NearPark[], observedAt: string, station: StationBrief | null,
  places: readonly PotaPlace[] = [], home?: PotaPlace): PageAnswer {
  if (!station || typeof station.latitude !== 'number' || typeof station.longitude !== 'number') {
    return { ok: false, reason: 'The active Location has no position. Give it a grid or a latitude and longitude on the Locations page.' };
  }
  if (parks.length === 0) {
    return { ok: true, data: { version: 6, observedAt, sections: [{ shape: 'alert', level: 'info', text: `POTA lists no active park within ${WITHIN.at(-1)} km.` }] } };
  }
  const here = { latitude: station.latitude, longitude: station.longitude };
  // Sent nearest first; measured again here so the page says the distance.
  const measured = parks.map(park => ({ park, km: distanceKm(here, park), bearing: bearingDegrees(here, park) }))
    .sort((a, b) => a.km - b.km || a.park.reference.localeCompare(b.park.reference));
  const locationsOf = (park: NearPark) => park.locations.split(',').map(value => value.trim()).filter(Boolean);
  const drawn = measured.map(({ park, km, bearing }) => [
    park.reference, park.name, String(Math.round(km)), String(Math.round(bearing) % 360), locationsOf(park).join(', ')
  ]);
  // Program and Entity, not drawn, for their filters alone, starting where
  // the active Location is (places.ts).
  const byPlace = placesBy(places);
  const located = withPlaces(drawn, byPlace.size === 0 ? [] : measured.map(({ park }) => placeCells(locationsOf(park), byPlace)), home ?? {});
  const locationOptions = [...new Set(drawn.flatMap(row => row[4]!.split(',').map(value => value.trim()).filter(Boolean)))]
    .sort((a, b) => a.localeCompare(b)).slice(0, 100);
  const farthest = Math.round(measured.at(-1)!.km);
  const sections: Section[] = [
    { shape: 'figures', figures: [
      { label: 'Parks', value: String(parks.length) },
      { label: 'Nearest', value: String(Math.round(measured[0]!.km)), unit: 'km' },
      { label: 'Farthest shown', value: String(farthest), unit: 'km' }
    ] },
    { shape: 'table', columns: ['Park', 'Name', 'km', 'Bearing °', 'Location', ...located.columns], rows: located.rows, sortable: true,
      sortedBy: { column: 2, direction: 'ascending' }, ...(located.hidden ? { hidden: located.hidden } : {}),
      // Each park's reference opens its page on pota.app (#59).
      links: [{ column: 0, kind: 'pota' }],
      filters: [
        // Program, Entity and Location first, as POTA's own park list starts,
        // each where the active Location is; then how far.
        ...located.filters,
        { column: 4, label: 'Location', options: locationOptions, multiple: true,
          ...(home && locationOptions.includes(home.location) ? { start: home.location } : {}) },
        { column: 2, label: 'Distance', upTo: WITHIN.map(km => ({ label: `Within ${km} km`, value: km })) }
      ] }
  ];
  return { ok: true, data: { version: 6, observedAt, sections } };
}
