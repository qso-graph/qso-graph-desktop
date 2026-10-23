// SPDX-License-Identifier: GPL-3.0-only
// Astro's page (QGD-AST-*), as the core's page shapes, checked by the core's
// own validator.
import { describe, expect, it } from 'vitest';
import { validatePageAnswer } from '../../../packages/extension-api/pages.js';
import { pageContents } from '../../../packages/ui/page-shapes.js';
import { astroPage, subsolar, type Clock } from '../src/page.js';
import { sublunar } from '../src/moon.js';
import { julian } from '../src/sun.js';

const BOISE = { name: 'Home', grid: 'DN13sm', latitude: 43.625, longitude: -116.2083 };
const NOW = new Date('2026-10-22T18:00:00Z');
const UTC_CLOCK: Clock = { offset: () => 0, text: () => 'never shown' };
const MOUNTAIN: Clock = { offset: () => -360, text: at => `local ${at.getUTCHours()}` };
const sections = (answer: ReturnType<typeof astroPage>) => {
  const valid = validatePageAnswer(answer);
  if (!valid.ok) throw new Error('not ok');
  return valid.data.sections;
};
// The one table of the day's events, and its groups.
const today = (answer: ReturnType<typeof astroPage>) => {
  const table = sections(answer).find(section => section.shape === 'table' && 'groups' in section);
  if (!table || table.shape !== 'table' || !('groups' in table)) throw new Error('no table of events');
  return table;
};

describe('Astro\'s page', () => {
  it('passes the core\'s own check, with Sun, Twilight, Moon and Radio depths as groups of one table', () => {
    expect(today(astroPage(BOISE, NOW, {}, UTC_CLOCK)).groups.map(group => group.heading)).toEqual(['Sun', 'Twilight', 'Moon', 'Radio depths']);
  });

  it('gives a value with no clock once, across both time columns', () => {
    const table = today(astroPage(BOISE, NOW, {}, MOUNTAIN));
    const rows = table.groups.flatMap(group => group.rows);
    for (const name of ['Length of day', 'Phase', 'Declination', 'Distance']) {
      expect(rows.find(row => row[0] === name)).toHaveLength(2);
    }
    expect(rows.find(row => row[0] === 'Sunrise')).toEqual(['Sunrise', expect.any(String), expect.stringMatching(/^local /)]);
  });

  it('gives UTC alone when the computer is on UTC, and the operator\'s clock beside it when not (QGD-AST-0010)', () => {
    expect(today(astroPage(BOISE, NOW, {}, UTC_CLOCK)).columns).toEqual(['Event', 'UTC']);
    expect(today(astroPage(BOISE, NOW, {}, MOUNTAIN)).columns).toEqual(['Event', 'UTC', 'Your clock']);
  });

  it('says what it needs, and names the Location, rather than guessing (QGD-AST-0008)', () => {
    const none = sections(astroPage(null, NOW, {}, UTC_CLOCK));
    expect(none).toEqual([{ shape: 'alert', level: 'info', text: expect.stringMatching(/needs a Location/) }]);
    const bare = sections(astroPage({ name: 'Car' }, NOW, {}, UTC_CLOCK));
    expect(bare[0]).toMatchObject({ shape: 'alert', text: expect.stringMatching(/^Car has no grid or coordinates/) });
  });

  it('names an absent event and why, never a blank (QGD-AST-0007)', () => {
    const svalbard = { name: 'Longyearbyen', latitude: 78.2232, longitude: 15.6267 };
    const sun = today(astroPage(svalbard, new Date('2026-06-21T12:00:00Z'), {}, UTC_CLOCK)).groups.find(group => group.heading === 'Sun');
    if (!sun) throw new Error('no sun');
    expect(sun.rows.find(row => row[0] === 'Sunrise')?.[1]).toBe('None: the sun does not set today');
    expect(sun.rows.every(row => row.every(cell => cell !== ''))).toBe(true);
  });

  it('answers the DX question with the depths it used, in the next 24 hours (QGD-AST-0041)', () => {
    const found = sections(astroPage(BOISE, new Date('2026-10-22T00:00:00Z'), { dx: 'MM40' }, UTC_CLOCK));
    const grey = found.find(section => section.heading?.startsWith('Grey line with MM40'));
    if (!grey || grey.shape !== 'table') throw new Error('no grey line');
    expect(grey.rows.map(row => row[0])).toEqual(expect.arrayContaining(['D and E layers (−10.1°)', 'F2 layer (−17.2°)']));
    expect(grey.columns).toEqual(['Both ends within', 'Date (UTC)', 'Start', 'End']);
    // A window: its date, then its start and end in UTC, each on its own.
    const window = grey.rows.find(row => row.length === 4)!;
    expect(window[1]).toMatch(/^\d{1,2} [A-Z][a-z]{2}$/);
    expect(window[2]).toMatch(/^\d\d:\d\d$/);
    expect(window[3]).toMatch(/^(\d{1,2} [A-Z][a-z]{2} )?\d\d:\d\d$/);
    // Under the map, just below the field it answers.
    expect(found[2]).toEqual({ shape: 'fields', heading: 'Grey line DX check' });
    expect(found[3]).toBe(grey);
  });

  it('says in words when the two ends share no twilight, rather than two empty rows', () => {
    const found = sections(astroPage(BOISE, new Date('2026-10-22T00:00:00Z'), { dx: 'IO91' }, UTC_CLOCK));
    expect(found[3]).toEqual({
      shape: 'alert', level: 'info', heading: 'Grey line with IO91, the next 24 hours', contents: false,
      text: 'Home and IO91 are not in twilight at the same time in the next 24 hours.'
    });
  });

  it('signs the sun\'s height: + above the horizon, − below it', () => {
    const height = (now: Date) => {
      const figures = sections(astroPage(BOISE, now, {}, UTC_CLOCK)).find(section => section.shape === 'figures');
      return figures?.shape === 'figures' ? figures.figures.find(figure => figure.label === 'Sun now')?.value : undefined;
    };
    expect(height(new Date('2026-10-22T19:00:00Z'))).toMatch(/^\+\d+\.\d°$/);
    expect(height(new Date('2026-10-22T08:00:00Z'))).toMatch(/^−\d+\.\d°$/);
  });

  it('draws the grey line on the map, with the Location and the DX grid marked', () => {
    const found = sections(astroPage(BOISE, NOW, { dx: 'IO91' }, UTC_CLOCK));
    expect(found[1]).toMatchObject({ shape: 'map', heading: 'Grey line now', twilight: -10.1, moon: expect.any(Object), marks: [
      { label: 'Home', latitude: 43.625, longitude: -116.2083 },
      { label: 'IO91', latitude: expect.closeTo(51.5, 1), longitude: expect.closeTo(-1, 1) }
    ] });
    expect(sections(astroPage(BOISE, NOW, {}, UTC_CLOCK))[1]).toMatchObject({ shape: 'map', marks: [{ label: 'Home' }] });
  });

  it('puts the sun overhead where it is: over the equator near the meridian at noon UTC on an equinox', () => {
    const march = subsolar(new Date('2026-03-20T12:00:00Z'));
    expect(Math.abs(march.latitude)).toBeLessThan(0.5);
    expect(Math.abs(march.longitude)).toBeLessThan(2.5);
    // June solstice, 18:00 UTC: the Tropic of Cancer, a quarter turn west.
    const june = subsolar(new Date('2026-06-21T18:00:00Z'));
    expect(june.latitude).toBeCloseTo(23.4, 0);
    expect(june.longitude).toBeCloseTo(-90, 0);
  });

  it('puts the moon opposite the sun at full moon, and beside it at new moon', () => {
    const apart = (at: Date) => {
      const sun = subsolar(at);
      const moon = sublunar(julian(at.getTime()));
      const r = Math.PI / 180;
      return Math.acos(Math.sin(sun.latitude * r) * Math.sin(moon.latitude * r)
        + Math.cos(sun.latitude * r) * Math.cos(moon.latitude * r) * Math.cos((sun.longitude - moon.longitude) * r)) / r;
    };
    expect(apart(new Date('2026-10-26T04:12:00Z'))).toBeGreaterThan(172);
    expect(apart(new Date('2026-11-09T07:02:00Z'))).toBeLessThan(8);
  });

  it('lists the DX check and the day\'s parts at the top, and not the map or the answer (KI7MT, 2026-10-23)', () => {
    const found = sections(astroPage(BOISE, NOW, { dx: 'IO91' }, UTC_CLOCK));
    expect(pageContents(found).map(entry => entry.label)).toEqual(['Grey line DX check', 'Sun', 'Twilight', 'Moon', 'Radio depths']);
  });

  it('sets the day\'s times apart under a heading of their own', () => {
    const found = sections(astroPage(BOISE, NOW, {}, MOUNTAIN));
    const at = found.findIndex(section => section.heading === 'Today at Home');
    expect(found[at]).toMatchObject({ shape: 'alert', contents: false, text: expect.stringMatching(/^Times are in UTC/) });
    expect(found[at + 1]).toMatchObject({ shape: 'table' });
  });

  it('rates nothing and forecasts nothing (QGD-AST-0050)', () => {
    const text = JSON.stringify(astroPage(BOISE, NOW, { dx: 'FN31' }, UTC_CLOCK));
    expect(text).not.toMatch(/\b(good|poor|fair|excellent|forecast|score|rating)\b/i);
  });
});
