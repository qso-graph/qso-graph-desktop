// SPDX-License-Identifier: GPL-3.0-only
// The moon against an independent reference (QGD-AST-0005, QGD-AST-0006):
// PyEphem 4.2, a high-precision ephemeris sharing no code with moon.ts, asked
// for each place's own day with refraction off and the horizon at -0°34′ on
// the upper limb, topocentric: what Meeus's h0 for the moon stands for. Five
// places from the equator to inside the Arctic circle, six dates across a
// year. moon-reference.json is PyEphem's output, made by moon-reference.py
// beside it, not typed in.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { moonAt, moonCrossings, moonPhase } from '../src/moon.js';
import { julian } from '../src/sun.js';

interface Reference {
  place: string; latitude: number; longitude: number; day: string;
  rise: string | null; set: string | null; noon: string;
  declination: number; distanceKm: number; illuminated: number;
}
const REFERENCE: Reference[] = JSON.parse(readFileSync('extensions/astro/tests/moon-reference.json', 'utf8'));
const toMinute = (at: string) => Math.round(Date.parse(at) / 60_000) * 60_000;
// Noon of the station's own day, so the day asked for is the reference's.
const middle = (entry: Reference) => new Date(Date.parse(`${entry.day}T12:00:00Z`) - (entry.longitude / 15) * 3_600_000);

describe('moonrise and moonset, within a minute of an independent ephemeris', () => {
  it.each(REFERENCE.map(entry => [`${entry.place}, ${entry.day}`, entry] as const))('%s', (_name, entry) => {
    const found = moonCrossings(middle(entry), entry.latitude, entry.longitude);
    for (const [ours, theirs] of [[found.rising, entry.rise], [found.setting, entry.set]] as const) {
      if (theirs === null) {
        // A day with no rise, or no set, is an answer (QGD-AST-0007).
        expect(ours).toBeUndefined();
      } else {
        expect(ours, theirs).toBeDefined();
        expect(Math.abs(ours!.getTime() - toMinute(theirs)), theirs).toBeLessThanOrEqual(60_000);
      }
    }
  });
});

describe('the moon\'s declination, distance and illuminated fraction', () => {
  it.each(REFERENCE.filter(entry => entry.place === 'Greenwich').map(entry => [entry.day, entry] as const))('%s', (_day, entry) => {
    const at = julian(Date.parse(entry.noon));
    const moon = moonAt(at);
    expect(Math.abs(moon.declination - entry.declination)).toBeLessThan(0.05);
    expect(Math.abs(moon.distance - entry.distanceKm)).toBeLessThan(60);
    expect(Math.abs(moonPhase(at).fraction - entry.illuminated)).toBeLessThan(0.005);
  });

  it('names the phase from the moon\'s elongation', () => {
    // PyEphem: full moon 2026-10-26 04:11:45 UTC, new moon 2026-10-10 15:50:01 UTC.
    expect(moonPhase(julian(Date.parse('2026-10-26T04:12:00Z'))).name).toBe('Full moon');
    expect(moonPhase(julian(Date.parse('2026-10-10T16:00:00Z'))).name).toBe('New moon');
    expect(moonPhase(julian(Date.parse('2026-10-14T12:00:00Z'))).name).toBe('Waxing crescent');
  });
});
