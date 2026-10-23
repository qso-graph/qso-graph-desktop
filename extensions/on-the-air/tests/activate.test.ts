// SPDX-License-Identifier: GPL-3.0-only
// Parks to Activate (QGD-HOM-0013): My Area's parks, nearest first, starting
// on the never activated. Made-up parks: nothing of POTA's is committed.
import { describe, expect, it } from 'vitest';
import type { ActivationPark } from '../../../packages/extension-api/api-contract.js';
import { validatePageAnswer } from '../../../packages/extension-api/pages.js';
import { SHOWN, activatePage, bearingDegrees, distanceKm } from '../src/activate.js';

const BOISE = { name: 'Home', latitude: 43.615, longitude: -116.202 };
const park = (reference: string, latitude: number, longitude: number, activations: number | null, locations = 'US-ID'): ActivationPark =>
  ({ reference, name: `Park ${reference}`, latitude, longitude, locations, activations });
const FETCHED = '2026-10-23T12:00:00Z';
const table = (answer: ReturnType<typeof activatePage>) => {
  if (!answer.ok) throw new Error(answer.reason);
  const section = answer.data.sections.find(entry => entry.shape === 'table');
  if (!section || section.shape !== 'table' || !('rows' in section)) throw new Error('no table');
  return section;
};

describe('distance and bearing', () => {
  it('measures a great circle', () => {
    // Boise to Idaho Falls is about 337 km, a little north of east.
    const falls = { latitude: 43.4917, longitude: -112.0339 };
    expect(Math.round(distanceKm(BOISE, falls))).toBeGreaterThan(330);
    expect(Math.round(distanceKm(BOISE, falls))).toBeLessThan(345);
    expect(bearingDegrees(BOISE, falls)).toBeGreaterThan(85);
    expect(bearingDegrees(BOISE, falls)).toBeLessThan(95);
    expect(Math.round(bearingDegrees(BOISE, { latitude: 50, longitude: -116.202 }))).toBe(0);
    expect(Math.round(bearingDegrees(BOISE, { latitude: 40, longitude: -116.202 }))).toBe(180);
  });
});

describe('Parks to Activate (QGD-HOM-0013)', () => {
  const parks = [park('US-0003', 44.5, -116.2, 12), park('US-0001', 43.7, -116.2, null), park('US-0002', 43.9, -116.2, 0),
    park('US-0004', 45.0, -116.2, 3, 'US-ID,US-OR')];

  it('lists the nearest first, with the distance, the bearing and POTA\'s count, a null shown as none', () => {
    const answer = activatePage(parks, FETCHED, BOISE);
    const shown = table(answer);
    expect(shown.columns).toEqual(['Park', 'Name', 'km', 'Bearing °', 'Activations', 'Location']);
    expect(shown.rows.map(row => [row[0], row[4]])).toEqual([['US-0001', 'none'], ['US-0002', '0'], ['US-0003', '12'], ['US-0004', '3']]);
    expect(shown.rows[0]![2]).toBe('9');
    expect(shown.rows[0]![3]).toBe('1');
    expect(shown.rows[3]![5]).toBe('US-ID, US-OR');
    expect(shown.sortedBy).toEqual({ column: 2, direction: 'ascending' });
    // A page the core accepts, as the core checks it.
    expect(() => validatePageAnswer(answer)).not.toThrow();
  });

  it('starts on the never activated, with fewer than 5 and 10 one choice away', () => {
    const filter = table(activatePage(parks, FETCHED, BOISE)).filters![0]!;
    expect(filter.start).toBe('Never activated');
    expect(filter.named!.map(choice => choice.label)).toEqual(['Never activated', 'Fewer than 5', 'Fewer than 10']);
    expect(filter.named![0]!.values).toEqual(['none', '0']);
  });

  it('counts the never activated, a null with a zero', () => {
    const answer = activatePage(parks, FETCHED, BOISE);
    if (!answer.ok) throw new Error(answer.reason);
    expect(answer.data.sections[0]).toMatchObject({ shape: 'figures', figures: [
      { label: 'Parks', value: '4' }, { label: 'Never activated', value: '2' }, { label: 'Fewer than 5', value: '3' }] });
  });

  it('without a position, lists the fewest activations first and says why there is no distance', () => {
    const answer = activatePage(parks, FETCHED, { name: 'Somewhere' });
    const shown = table(answer);
    expect(shown.columns).toEqual(['Park', 'Name', 'Activations', 'Location']);
    expect(shown.rows.map(row => row[0])).toEqual(['US-0001', 'US-0002', 'US-0004', 'US-0003']);
    expect(shown.filters![0]!.column).toBe(2);
    if (answer.ok) expect(answer.data.sections.some(section => section.shape === 'alert' && section.text.includes('no position'))).toBe(true);
    expect(() => validatePageAnswer(answer)).not.toThrow();
  });

  it('shows the nearest 500 and says how many there are', () => {
    const many = Array.from({ length: SHOWN + 20 }, (_, at) => park(`US-${String(at).padStart(4, '0')}`, 43 + at / 1000, -116, at % 7));
    const answer = activatePage(many, FETCHED, BOISE);
    expect(table(answer).rows).toHaveLength(SHOWN);
    if (answer.ok) expect(answer.data.sections.at(-1)).toMatchObject({ shape: 'alert', text: `The nearest ${SHOWN} of ${SHOWN + 20} parks are shown.` });
    expect(() => validatePageAnswer(answer)).not.toThrow();
  });

  it('says so when My Area has no active park', () => {
    expect(activatePage([], FETCHED, BOISE)).toMatchObject({ ok: true, data: { sections: [{ shape: 'alert' }] } });
  });
});
