// SPDX-License-Identifier: GPL-3.0-only
// The night on the world map (page data version 6): checked against the
// sun's own altitude, which is what the terminator is.
import { describe, expect, it } from 'vitest';
import { antisolar, capPath, capRing, mapDescription, nightPath, terminator } from '../packages/ui/world-map.js';

const rad = (degrees: number) => (degrees * Math.PI) / 180;
// The sun's altitude at a place, from where it is overhead.
const altitude = (sun: { latitude: number; longitude: number }, latitude: number, longitude: number) =>
  (Math.asin(Math.sin(rad(latitude)) * Math.sin(rad(sun.latitude))
    + Math.cos(rad(latitude)) * Math.cos(rad(sun.latitude)) * Math.cos(rad(longitude - sun.longitude))) * 180) / Math.PI;

describe('the world map\'s night', () => {
  it.each([
    [{ latitude: 23.4, longitude: 0 }],
    [{ latitude: -11.4, longitude: -158.2 }],
    [{ latitude: 0, longitude: 90 }],
    [{ latitude: -23.4, longitude: 179.9 }]
  ])('puts the sun on the horizon all along the terminator (%o)', sun => {
    const line = terminator(sun);
    expect(line).toHaveLength(361);
    for (const [longitude, latitude] of line) expect(Math.abs(altitude(sun, latitude, longitude))).toBeLessThan(0.05);
  });

  it('shades the side away from the sun: the south pole in June, the north in December', () => {
    expect(nightPath({ latitude: 23.4, longitude: 0 })).toMatch(/L360 180L0 180Z$/);
    expect(nightPath({ latitude: -23.4, longitude: 0 })).toMatch(/L360 0L0 0Z$/);
    // Under the sun is day, and opposite it is night.
    expect(altitude({ latitude: 23.4, longitude: 0 }, 23.4, 0)).toBeGreaterThan(0);
    expect(altitude({ latitude: 23.4, longitude: 0 }, -23.4, 180)).toBeLessThan(0);
  });

  it.each([
    [{ latitude: 23.4, longitude: 10 }, -10.1],
    [{ latitude: -11.3, longitude: -166.8 }, -10.1],
    [{ latitude: 0.2, longitude: 179 }, -17.2],
    [{ latitude: -23.4, longitude: -179.5 }, -6]
  ])('puts the twilight band\'s edge where the sun is that deep (%o, %d°)', (sun, depth) => {
    const ring = capRing(antisolar(sun), 90 + depth);
    for (const [longitude, latitude] of ring) expect(altitude(sun, latitude, longitude)).toBeCloseTo(depth, 6);
    // Its longitudes never wrap from one edge of the map to the other, which
    // is a jump of nearly 360°. (Close to a pole a degree round the circle
    // can cover tens of degrees of longitude, and that is right.)
    for (let i = 1; i < ring.length; i++) expect(Math.abs(ring[i]![0] - ring[i - 1]![0])).toBeLessThan(180);
    expect(capPath(antisolar(sun), 90 + depth)).not.toMatch(/NaN/);
  });

  it('closes a circle round a pole along that pole\'s edge, and leaves one that misses both closed on itself', () => {
    // June: the night's deep part is round the south pole, drawn to its edge.
    expect(capPath(antisolar({ latitude: 23.4, longitude: 0 }), 79.9)).toMatch(/L[\d.-]+ 180L[\d.-]+ 180Z/);
    // An equinox: −10.1° reaches neither pole.
    expect(capPath(antisolar({ latitude: 0, longitude: 0 }), 79.9)).not.toMatch(/ 180Z| 0Z/);
  });

  it('says in words what it shows', () => {
    expect(mapDescription([])).toBe('World map with the night greyed out, and the sun\'s position marked.');
    expect(mapDescription([{ label: 'Home' }, { label: 'IO91' }], true, -10.1))
      .toBe('World map with the night greyed out, the twilight to 10.1° below the horizon shaded lighter, and the sun\'s and the moon\'s positions marked, showing Home and IO91.');
  });
});
