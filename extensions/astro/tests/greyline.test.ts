// SPDX-License-Identifier: GPL-3.0-only
// The grey line between two stations (QGD-AST-0040, QGD-AST-0041).
import { describe, expect, it } from 'vitest';
import { greyLine, gridCentre } from '../src/greyline.js';
import { D_LAYER, F2_LAYER, HORIZON, julian, sunAltitude } from '../src/sun.js';

describe('a grid locator\'s centre', () => {
  it('is the middle of the square at each precision', () => {
    expect(gridCentre('FN31')).toEqual({ latitude: 41.5, longitude: -73 });
    const fine = gridCentre('FN31pr')!;
    expect(fine.latitude).toBeCloseTo(41.729, 3);
    expect(fine.longitude).toBeCloseTo(-72.708, 3);
    expect(gridCentre('AA')).toEqual({ latitude: -85, longitude: -170 });
    for (const bad of ['FN3', 'SN31', 'FN31YZ', '']) expect(gridCentre(bad), bad).toBeUndefined();
  });
});

describe('the windows both ends share', () => {
  const boise = { latitude: 43.625, longitude: -116.2083 };
  // Boise and Turkmenistan lie close to one terminator, dusk at one end as
  // dawn at the other: they share windows at both depths that day.
  const turkmen = { latitude: 40, longitude: 60 };
  const london = { latitude: 51.5, longitude: -0.12 };

  it('names each depth, and every minute inside a window is inside it at both ends', () => {
    const found = greyLine(new Date('2026-10-22T00:00:00Z'), boise, turkmen);
    expect(found.map(entry => entry.depth)).toEqual([D_LAYER, F2_LAYER]);
    // Not vacuous: there is something to check inside.
    expect(found[0].windows.length).toBe(2);
    for (const { depth, windows } of found) {
      // The ends are Boise and Turkmenistan, as above.
      for (const window of windows) {
        expect(window.end.getTime()).toBeGreaterThanOrEqual(window.start.getTime());
        for (let at = window.start.getTime(); at <= window.end.getTime(); at += 60_000) {
          for (const end of [boise, turkmen]) {
            const altitude = sunAltitude(julian(at), end.latitude, end.longitude);
            expect(altitude).toBeLessThan(HORIZON);
            expect(altitude).toBeGreaterThanOrEqual(depth);
          }
        }
      }
    }
  });

  it('finds none when the two ends are never in twilight together, which is an answer', () => {
    // Boise and London: when one is at dusk the other is deep in night.
    expect(greyLine(new Date('2026-10-22T00:00:00Z'), boise, london).map(entry => entry.windows)).toEqual([[], []]);
  });

  it('gives a station its own twilight with itself, dusk and dawn', () => {
    const [dLayer] = greyLine(new Date('2026-10-22T00:00:00Z'), boise, boise);
    expect(dLayer.windows.length).toBeGreaterThanOrEqual(1);
    expect(dLayer.windows.length).toBeLessThanOrEqual(3);
  });
});
