// SPDX-License-Identifier: GPL-3.0-only
// Sunrise and sunset, against an independent calculation. For the Astro extension.
//
// The expected times are PyEphem's (4.2), with its refraction off and the
// horizon at -0°34' as NOAA's method has it, asked for each place's own solar
// day: a high-precision ephemeris that shares no code with sun.ts. astral was
// the first reference and was replaced: it holds the sun's declination at its
// noon value all day, which put it 36 minutes out at Svalbard in late August,
// where PyEphem and sun.ts agree to the minute. Within a minute is the
// requirement.
import { describe, expect, it } from 'vitest';
import { sunDay } from '../packages/ui/sun.js';

const CASES: [string, number, number, string, string, string][] = [
  ['Boise DN13sm, June solstice', 43.625, -116.2083, '2026-06-21T19:44Z', '2026-06-21T12:03:31Z', '2026-06-22T03:29:54Z'],
  ['Greenwich, equinox', 51.4769, 0.0, '2026-03-20T12:00Z', '2026-03-20T06:02:53Z', '2026-03-20T18:12:59Z'],
  ['Sydney, southern summer', -33.8688, 151.2093, '2026-01-15T01:55Z', '2026-01-14T18:59:28Z', '2026-01-15T09:09:00Z'],
  ['Quito, on the equator', -0.1807, -78.4678, '2026-09-23T17:13Z', '2026-09-23T11:02:56Z', '2026-09-23T23:09:24Z'],
  ['Tromsø, inside the Arctic circle', 69.6492, 18.9553, '2026-03-01T10:44Z', '2026-03-01T06:10:12Z', '2026-03-01T15:44:30Z'],
  ['Longyearbyen, two days after the midnight sun', 78.2232, 15.6267, '2026-08-26T10:57Z', '2026-08-26T00:05:30Z', '2026-08-26T21:34:02Z']
];

// The card shows minutes, so the reference is taken to its minute too.
const toMinute = (at: string) => Math.round(Date.parse(at) / 60_000) * 60_000;

describe('sunrise and sunset at a station', () => {
  it.each(CASES)('%s, within a minute of an independent calculation', (_place, latitude, longitude, now, sunrise, sunset) => {
    const day = sunDay(new Date(now), latitude, longitude);
    if (!day.sunrise || !day.sunset) throw new Error('no sunrise or sunset');
    expect(Math.abs(day.sunrise.getTime() - toMinute(sunrise))).toBeLessThanOrEqual(60_000);
    expect(Math.abs(day.sunset.getTime() - toMinute(sunset))).toBeLessThanOrEqual(60_000);
  });

  it('is the station\'s own day: an Idaho evening after 00:00 UTC still has its own sunset ahead', () => {
    const day = sunDay(new Date('2026-06-22T02:00Z'), 43.625, -116.2083);
    if (!day.sunset) throw new Error('no sunset');
    expect(Math.abs(day.sunset.getTime() - toMinute('2026-06-22T03:29:54Z'))).toBeLessThanOrEqual(60_000);
  });

  it('says when the sun does not set or does not rise', () => {
    expect(sunDay(new Date('2026-06-21T12:00Z'), 78.2232, 15.6267)).toEqual({ allDay: 'up' });
    expect(sunDay(new Date('2026-12-21T12:00Z'), 78.2232, 15.6267)).toEqual({ allDay: 'down' });
  });

  // The evening the midnight sun ends at Longyearbyen: the sun goes below the
  // horizon late in the day and does not come back up until after midnight. A
  // method that decides from one moment of the day calls this a day the sun
  // never sets (found by Turing in review; astral 3.2 and PyEphem both do).
  it('finds a sunset with no sunrise on the evening the midnight sun ends', () => {
    const day = sunDay(new Date('2026-08-24T10:57Z'), 78.2232, 15.6267);
    expect(day.sunrise).toBeUndefined();
    expect(day.allDay).toBeUndefined();
    expect(day.sunset?.toISOString().slice(0, 10)).toBe('2026-08-24');
    // It sets before it rises again: the next day's sunrise, which PyEphem
    // puts at 23:33:02 on the 24th, comes after it, within a minute.
    expect(day.sunset!.getTime()).toBeLessThan(Date.parse('2026-08-24T23:33:02Z'));
    const next = sunDay(new Date('2026-08-25T10:57Z'), 78.2232, 15.6267);
    expect(Math.abs(next.sunrise!.getTime() - toMinute('2026-08-24T23:33:02Z'))).toBeLessThanOrEqual(60_000);
    expect(Math.abs(next.sunset!.getTime() - toMinute('2026-08-25T21:55:39Z'))).toBeLessThanOrEqual(60_000);
  });
});
