// SPDX-License-Identifier: GPL-3.0-only
// Parks Near Me (QGD-HOM-0013, #62; named by KI7MT, 2026-10-23): the parks of My Area with how many
// times POTA has counted each activated, nearest first, for an activator
// looking for one nobody has worked from (KI7MT, 2026-10-23: "Some in Idaho
// have never been activated, that would be my target list").
//
// Pure: it takes the parks and the active station and returns the page, so it
// runs under unit tests. The parks come from reference data already on this
// computer (pota.activations), so the page works with no network at all.
import type { ActivationPark, PotaPlace, StationBrief } from '../../../packages/extension-api/api-contract.js';
import { placeCells, placesBy, withPlaces } from './places.js';
import type { PageAnswer, Section } from '../../../packages/extension-api/pages.js';

const EARTH_KM = 6371;
const radians = (degrees: number) => degrees * Math.PI / 180;

// Great-circle distance in km, and the initial bearing in degrees from true
// north, from one place to another.
export function distanceKm(from: { latitude: number; longitude: number }, to: { latitude: number; longitude: number }): number {
  const dLat = radians(to.latitude - from.latitude);
  const dLon = radians(to.longitude - from.longitude);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(from.latitude)) * Math.cos(radians(to.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function bearingDegrees(from: { latitude: number; longitude: number }, to: { latitude: number; longitude: number }): number {
  const dLon = radians(to.longitude - from.longitude);
  const y = Math.sin(dLon) * Math.cos(radians(to.latitude));
  const x = Math.cos(radians(from.latitude)) * Math.sin(radians(to.latitude))
    - Math.sin(radians(from.latitude)) * Math.cos(radians(to.latitude)) * Math.cos(dLon);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

// A park POTA publishes with a null count is one nobody has attempted; it is
// shown as none, and counted with the never activated.
const NONE = 'none';
const countText = (park: ActivationPark) => (park.activations === null ? NONE : String(park.activations));
const count = (park: ActivationPark) => park.activations ?? 0;

// The Distance filter's bounds, in km.
export const WITHIN = [25, 50, 100, 200, 400] as const;

// The page's table holds at most 500 rows (PAGE_LIMITS).
export const SHOWN = 500;

// Fewer than n activations, as the filter's values: none, 0, 1 … n−1.
const fewerThan = (n: number) => [NONE, ...Array.from({ length: n }, (_, at) => String(at))];

// `area` is the POTA locations My Area covers: the Location filter offers
// those alone, so a trail through sixteen states does not offer all sixteen
// to an operator whose area is Idaho (KI7MT, 2026-10-23).
// `places` names each location's program and entity (pota.places): Program
// and Entity lead the filters, as POTA's own do, where My Area spans more
// than one of either.
export function activatePage(parks: readonly ActivationPark[], fetchedAt: string, station: StationBrief | null, area: readonly string[] = [],
  places: readonly PotaPlace[] = []): PageAnswer {
  const observedAt = fetchedAt;
  if (parks.length === 0) {
    return { ok: true, data: { version: 6, observedAt, sections: [
      { shape: 'alert', level: 'info', text: 'POTA lists no active parks in My Area.' }
    ] } };
  }
  const here = station && typeof station.latitude === 'number' && typeof station.longitude === 'number'
    ? { latitude: station.latitude, longitude: station.longitude } : undefined;
  const measured = parks.map(park => ({ park, km: here ? distanceKm(here, park) : 0, bearing: here ? bearingDegrees(here, park) : 0 }));
  // Nearest first, the fewest activations first among equals; without a
  // position, the fewest first.
  measured.sort((a, b) => (here ? a.km - b.km : 0) || count(a.park) - count(b.park) || a.park.reference.localeCompare(b.park.reference));
  const shown = measured.slice(0, SHOWN);
  const drawn = shown.map(({ park, km, bearing }) => [
    park.reference,
    park.name,
    ...(here ? [String(Math.round(km)), String(Math.round(bearing) % 360)] : []),
    countText(park),
    park.locations.split(',').map(value => value.trim()).filter(Boolean).join(', ')
  ]);
  // Program and Entity, not drawn, for their filters alone, and only where
  // My Area spans more than one of either (places.ts).
  const byPlace = placesBy(places);
  const located = withPlaces(drawn, byPlace.size === 0 ? [] : shown.map(({ park }) =>
    placeCells(park.locations.split(',').map(value => value.trim()).filter(Boolean), byPlace)), 2);
  const rows = located.rows;
  const columns = ['Park', 'Name', ...(here ? ['km', 'Bearing °'] : []), 'Activations', 'Location', ...located.columns];
  const activations = here ? 4 : 2;
  const location = activations + 1;
  const inArea = new Set(area);
  const locationOptions = [...new Set(rows.flatMap(row => row[location]!.split(',').map(value => value.trim()).filter(Boolean)))]
    .filter(value => inArea.size === 0 || inArea.has(value))
    .sort((a, b) => a.localeCompare(b)).slice(0, 100);

  const never = parks.filter(park => count(park) === 0).length;
  const sections: Section[] = [
    { shape: 'figures', figures: [
      { label: 'Parks', value: String(parks.length) },
      { label: 'Never activated', value: String(never) },
      { label: 'Fewer than 5', value: String(parks.filter(park => count(park) < 5).length) }
    ] },
    ...(here ? [] : [{ shape: 'alert' as const, level: 'info' as const,
      text: 'The active Location has no position, so distances are not shown. Give it a grid or a latitude and longitude on the Locations page.' }]),
    { shape: 'table', columns, rows, sortable: true,
      ...(here ? { sortedBy: { column: 2, direction: 'ascending' as const } } : {}),
      ...(located.hidden ? { hidden: located.hidden } : {}),
      filters: [
        // Program and Entity first, as POTA's own park list starts.
        ...located.filters,
        // Starts on the never activated: the target list (KI7MT, 2026-10-23).
        { column: activations, label: 'Activations', options: fewerThan(10),
          named: [
            { label: 'Never activated', values: fewerThan(1) },
            { label: 'Fewer than 5', values: fewerThan(5) },
            { label: 'Fewer than 10', values: fewerThan(10) }
          ],
          start: 'Never activated' },
        // How far, in km (KI7MT, 2026-10-23): only with a position to measure from.
        ...(here ? [{ column: 2, label: 'Distance', upTo: WITHIN.map(km => ({ label: `Within ${km} km`, value: km })) }] : []),
        { column: location, label: 'Location', options: locationOptions, multiple: true }
      ] }
  ];
  if (measured.length > shown.length) {
    sections.push({ shape: 'alert', level: 'info', text: `The ${here ? 'nearest' : 'least activated'} ${SHOWN} of ${measured.length} parks are shown.` });
  }
  return { ok: true, data: { version: 6, observedAt, sections } };
}
