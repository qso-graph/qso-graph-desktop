// SPDX-License-Identifier: GPL-3.0-only
// The grey line between two stations (QGD-AST-0040, QGD-AST-0041): the
// windows in which both ends are inside the same radio depth at once, the
// sun below the horizon at each but not yet below that depth, so the layer
// above both is in sunlight while the ground beneath is not. Which depth an
// answer used is said with it, because that choice is the whole of what the
// answer means (QGD-AST-0022: no single grey-line width is defined here).
import { D_LAYER, F2_LAYER, HORIZON, julian, sunAltitude } from './sun.js';

export interface Window {
  start: Date;
  end: Date;
}

export interface DepthWindows {
  depth: number;
  windows: Window[];
}

// The centre of a Maidenhead locator of 2 to 8 characters, as inputs.ts
// writes one; undefined for anything else.
export function gridCentre(grid: string): { latitude: number; longitude: number } | undefined {
  const g = grid.toUpperCase();
  if (!/^[A-R]{2}([0-9]{2}([A-X]{2}([0-9]{2})?)?)?$/.test(g) || g.length % 2 !== 0) return undefined;
  let longitude = -180 + (g.charCodeAt(0) - 65) * 20;
  let latitude = -90 + (g.charCodeAt(1) - 65) * 10;
  let width = 20;
  let height = 10;
  if (g.length >= 4) { width = 2; height = 1; longitude += Number(g[2]) * 2; latitude += Number(g[3]); }
  if (g.length >= 6) { width = 2 / 24; height = 1 / 24; longitude += (g.charCodeAt(4) - 65) * width; latitude += (g.charCodeAt(5) - 65) * height; }
  if (g.length >= 8) { width /= 10; height /= 10; longitude += Number(g[6]) * width; latitude += Number(g[7]) * height; }
  return { latitude: latitude + height / 2, longitude: longitude + width / 2 };
}

const inside = (altitude: number, depth: number) => altitude < HORIZON && altitude >= depth;

// Each depth's windows over the next 24 hours from `from`, to the minute.
export function greyLine(from: Date, here: { latitude: number; longitude: number }, there: { latitude: number; longitude: number }): DepthWindows[] {
  const start = Math.floor(from.getTime() / 60_000) * 60_000;
  return [D_LAYER, F2_LAYER].map(depth => {
    const windows: Window[] = [];
    let open: number | undefined;
    for (let minute = 0; minute <= 1440; minute += 1) {
      const at = start + minute * 60_000;
      const both = inside(sunAltitude(julian(at), here.latitude, here.longitude), depth)
        && inside(sunAltitude(julian(at), there.latitude, there.longitude), depth);
      if (both && open === undefined) open = at;
      if ((!both || minute === 1440) && open !== undefined) {
        windows.push({ start: new Date(open), end: new Date(both ? at : at - 60_000) });
        open = undefined;
      }
    }
    return { depth, windows };
  });
}
