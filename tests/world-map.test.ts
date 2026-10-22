// SPDX-License-Identifier: GPL-3.0-only
// The night on the world map (page data version 6): checked against the
// sun's own altitude, which is what the terminator is.
import { describe, expect, it } from 'vitest';
import { mapDescription, nightPath, terminator } from '../packages/ui/world-map.js';

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

  it('says in words what it shows', () => {
    expect(mapDescription([])).toBe('World map with the night greyed out and the sun\'s position marked.');
    expect(mapDescription([{ label: 'Home' }, { label: 'IO91' }])).toMatch(/showing Home and IO91\.$/);
  });
});
