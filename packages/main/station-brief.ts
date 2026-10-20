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
import { fromAdifLocation, type StationsView } from '../storage/station-contract.js';
export { fromAdifLocation } from '../storage/station-contract.js';


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

function positionOf(place: StationsView['list'][number]['place']): { latitude: number; longitude: number } | undefined {
  if (place.MY_GRIDSQUARE) return gridCentre(place.MY_GRIDSQUARE);
  const centres = (place.MY_VUCC_GRIDS ?? '').split(',').map(grid => gridCentre(grid.trim()));
  if (centres.length === 0 || centres.some(centre => centre === undefined)) return undefined;
  const known = centres as { latitude: number; longitude: number }[];
  // Longitudes unwrapped against the first before they are averaged, so a
  // pair across the date line (RJ90,AJ00) lands on it, not at Greenwich.
  const first = known[0].longitude;
  const unwrapped = known.map(centre => centre.longitude - 360 * Math.round((centre.longitude - first) / 360));
  let longitude = unwrapped.reduce((sum, value) => sum + value, 0) / known.length;
  if (longitude > 180) longitude -= 360;
  if (longitude <= -180) longitude += 360;
  return {
    latitude: known.reduce((sum, centre) => sum + centre.latitude, 0) / known.length,
    longitude
  };
}

export function activeStationBrief(view: StationsView | undefined): StationBrief | null {
  if (!view || view.active === null) return null;
  const station = view.list.find(entry => entry.id === view.active);
  if (!station) return null;
  // A station on a grid line or corner names its grids in MY_VUCC_GRIDS and
  // has no single MY_GRIDSQUARE: its grid is that list, and its position the
  // middle of their centres, which is the line or the corner itself.
  const grid = station.place.MY_GRIDSQUARE ?? station.place.MY_VUCC_GRIDS;
  const latitude = fromAdifLocation(station.place.MY_LAT);
  const longitude = fromAdifLocation(station.place.MY_LON);
  const position = latitude !== undefined && longitude !== undefined ? { latitude, longitude } : positionOf(station.place);
  return {
    name: station.name,
    ...(grid ? { grid } : {}),
    ...(position ? { latitude: position.latitude, longitude: position.longitude } : {})
  };
}
