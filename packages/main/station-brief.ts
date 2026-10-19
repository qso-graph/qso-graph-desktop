// SPDX-License-Identifier: GPL-3.0-only
// The active station as an extension may see it (QGD-HOM-0009, QGD-STN-0003).
//
// Built field by field rather than passed through, as personaBriefs is: a
// station holds the operator's street, city and postal code, and an extension
// has no business seeing them. What it gets is the name, the grid, and a
// position in decimal degrees: the station's own MY_LAT and MY_LON where it
// has them, the centre of its grid square where it does not.
//
// Pure, so every case is a unit test.
import type { StationBrief } from '../extension-api/api-contract.js';
import type { StationsView } from '../storage/station-contract.js';

// ADIF's Location, "XDDD MM.MMM", to signed decimal degrees.
export function fromAdifLocation(value: string | undefined): number | undefined {
  if (!value || value.length !== 11) return undefined;
  const hemisphere = value[0].toUpperCase();
  const degrees = Number(value.slice(1, 4));
  const minutes = Number(value.slice(5));
  if (!'NSEW'.includes(hemisphere) || !Number.isFinite(degrees) || !Number.isFinite(minutes) || minutes >= 60) return undefined;
  const magnitude = degrees + minutes / 60;
  if (magnitude > ((hemisphere === 'N' || hemisphere === 'S') ? 90 : 180)) return undefined;
  return hemisphere === 'S' || hemisphere === 'W' ? -magnitude : magnitude;
}

// The centre of a 2, 4, 6 or 8 character Maidenhead locator. Undefined for
// anything else: the grid was checked against ADIF's definition when it was
// saved, so this is a second line, not the first.
export function gridCentre(grid: string | undefined): { latitude: number; longitude: number } | undefined {
  if (!grid || grid.length % 2 !== 0 || grid.length < 2 || grid.length > 8) return undefined;
  const upper = grid.toUpperCase();
  let longitude = -180;
  let latitude = -90;
  // Each pair halves into finer cells: fields 20°×10°, squares 2°×1°,
  // subsquares 5'×2.5', extended squares 30"×15".
  const sizes = [[20, 10], [2, 1], [2 / 24, 1 / 24], [2 / 240, 1 / 240]];
  for (let pair = 0; pair < upper.length / 2; pair += 1) {
    const [width, height] = sizes[pair];
    const a = upper[pair * 2];
    const b = upper[pair * 2 + 1];
    const letters = pair % 2 === 0;
    const x = letters ? a.charCodeAt(0) - 65 : Number(a);
    const y = letters ? b.charCodeAt(0) - 65 : Number(b);
    const limit = pair === 0 ? 18 : letters ? 24 : 10;
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= limit || y >= limit) return undefined;
    longitude += x * width;
    latitude += y * height;
  }
  const [width, height] = sizes[upper.length / 2 - 1];
  return { latitude: latitude + height / 2, longitude: longitude + width / 2 };
}

export function activeStationBrief(view: StationsView | undefined): StationBrief | null {
  if (!view || view.active === null) return null;
  const station = view.list.find(entry => entry.id === view.active);
  if (!station) return null;
  const grid = station.place.MY_GRIDSQUARE;
  const latitude = fromAdifLocation(station.place.MY_LAT);
  const longitude = fromAdifLocation(station.place.MY_LON);
  const position = latitude !== undefined && longitude !== undefined ? { latitude, longitude } : gridCentre(grid);
  return {
    name: station.name,
    ...(grid ? { grid } : {}),
    ...(position ? { latitude: position.latitude, longitude: position.longitude } : {})
  };
}
