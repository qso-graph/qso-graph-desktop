// SPDX-License-Identifier: GPL-3.0-only
// Your station (QGD-HOM-0009): UTC first, local time, the callsign, the active
// station, and sunrise and sunset there; with no persona or no station it says
// so; and it needs no network. P8-your-station and P9-your-station.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validateCardAnswer, type Section } from '../../../packages/extension-api/cards.js';
import { stationCard } from '../src/station.js';

// Local time is the machine's, so the tests set one: Boise, UTC-6 in June.
const zone = process.env.TZ;
beforeAll(() => { process.env.TZ = 'America/Boise'; });
afterAll(() => { if (zone === undefined) delete process.env.TZ; else process.env.TZ = zone; });

const now = new Date('2026-06-21T19:44:42Z');
const persona = { name: 'Home', callsign: 'W1AW' };
const boise = { name: 'Home', grid: 'DN13sm', latitude: 43.625, longitude: -116.2083 };

function sections(card: ReturnType<typeof stationCard>): { figures: Extract<Section, { shape: 'figures' }>; items: Extract<Section, { shape: 'items' }> } {
  const checked = validateCardAnswer(card);
  if (!checked.ok) throw new Error('expected a card');
  const [figures, items] = checked.data.sections;
  if (figures.shape !== 'figures' || items.shape !== 'items') throw new Error('shapes');
  return { figures, items };
}

describe('P8-your-station and P9-your-station (QGD-HOM-0009)', () => {
  it('shows UTC first, then local time, the callsign, the station, and sunrise and sunset there', () => {
    const { figures, items } = sections(stationCard(now, persona, boise));
    expect(figures.figures.map(figure => figure.label)).toEqual(['UTC', 'Local', 'Sunrise', 'Sunset']);
    expect(figures.figures[0]).toEqual({ label: 'UTC', value: '19:44' });
    // Within a minute of PyEphem's 12:03:31 and 03:29:54 UTC
    // (sun.test.ts holds the method to that for six places).
    // On the local clock (KI7MT, 2026-10-22): 12:03 and 03:30 UTC are
    // 06:03 and 21:30 in Boise.
    expect(figures.figures[1]).toEqual({ label: 'Local', value: '13:44' });
    expect(figures.figures[2]).toEqual({ label: 'Sunrise', value: '06:03', unit: 'local' });
    expect(figures.figures[3]).toEqual({ label: 'Sunset', value: '21:30', unit: 'local' });
    expect(items.items).toEqual([
      { title: 'Operating as', detail: 'W1AW' },
      { title: 'Station', detail: 'Home · DN13sm' }
    ]);
    const checked = validateCardAnswer(stationCard(now, persona, boise));
    if (!checked.ok) throw new Error('expected a card');
    expect(checked.data.observedAt).toBe('2026-06-21T19:44:00Z');
  });

  it('says so when no persona is active', () => {
    expect(JSON.stringify(stationCard(now, null, boise))).toContain('No persona is active yet.');
  });

  it('with no station active, says so and shows the clock alone', () => {
    const { figures, items } = sections(stationCard(now, persona, null));
    expect(figures.figures.map(figure => figure.label)).toEqual(['UTC', 'Local']);
    expect(items.items[1]).toEqual({ title: 'Station', detail: 'No station is active. Choose one in Stations.' });
  });

  it('names a station with no location, and says sunrise and sunset need it', () => {
    const { figures, items } = sections(stationCard(now, persona, { name: 'Car' }));
    expect(figures.figures.map(figure => figure.label)).toEqual(['UTC', 'Local']);
    expect(items.items.slice(1)).toEqual([
      { title: 'Station', detail: 'Car' },
      { title: 'Sun', detail: 'Sunrise and sunset need the station\'s grid. Add it in Stations.' }
    ]);
  });

  it('says when the sun does not set there', () => {
    const svalbard = { name: 'Longyearbyen', grid: 'JQ78', latitude: 78.2232, longitude: 15.6267 };
    const { items } = sections(stationCard(new Date('2026-06-21T12:00Z'), persona, svalbard));
    expect(items.items[2]).toEqual({ title: 'Sun', detail: 'The sun does not set there today.' });
  });
});
