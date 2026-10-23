// SPDX-License-Identifier: GPL-3.0-only
// The active station as an extension may see it (QGD-HOM-0009, QGD-STN-0003).
//
// Built field by field rather than passed through, as personaBriefs is: an
// extension is given the name, the grid, and a position in decimal degrees,
// the centre of the grid square, which is all the position a Location holds
// (KI7MT, 2026-10-23: "a grid square is enough").
//
// Pure, so every case is a unit test.
import type { StationBrief } from '../extension-api/api-contract.js';
import { gridPosition, type StationsView } from '../storage/station-contract.js';
export { fromAdifLocation, gridCentre } from '../storage/station-contract.js';



function positionOf(place: StationsView['list'][number]['place']): { latitude: number; longitude: number } | undefined {
  return gridPosition(place.MY_GRIDSQUARE ?? place.MY_VUCC_GRIDS);
}

export function activeStationBrief(view: StationsView | undefined): StationBrief | null {
  if (!view || view.active === null) return null;
  const station = view.list.find(entry => entry.id === view.active);
  if (!station) return null;
  // A station on a grid line or corner names its grids in MY_VUCC_GRIDS and
  // has no single MY_GRIDSQUARE: its grid is that list, and its position the
  // middle of their centres, which is the line or the corner itself.
  const grid = station.place.MY_GRIDSQUARE ?? station.place.MY_VUCC_GRIDS;
  const position = positionOf(station.place);
  return {
    name: station.name,
    ...(grid ? { grid } : {}),
    ...(position ? { latitude: position.latitude, longitude: position.longitude } : {})
  };
}
