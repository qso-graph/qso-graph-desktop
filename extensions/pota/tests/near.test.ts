// SPDX-License-Identifier: GPL-3.0-only
// Near Me (QGD-HOM-0013): the parks nearest the active Location, from POTA's
// park list alone. Made-up parks: nothing of POTA's is committed.
import { describe, expect, it } from 'vitest';
import type { NearPark } from '../../../packages/extension-api/api-contract.js';
import { validatePageAnswer } from '../../../packages/extension-api/pages.js';
import { nearPage } from '../src/near.js';

const AT = '2026-10-23T12:00:00Z';
// Eastern Idaho, near the Montana and Wyoming lines.
const HERE = { name: 'Camp', latitude: 44.4, longitude: -111.4 };
const park = (reference: string, latitude: number, longitude: number, locations: string): NearPark =>
  ({ reference, name: `Park ${reference}`, latitude, longitude, locations });
const parks = [park('US-0003', 44.9, -111.1, 'US-MT'), park('US-0001', 44.45, -111.4, 'US-ID'), park('US-0002', 44.4, -110.9, 'US-WY')];
const places = [
  { location: 'US-ID', program: 'United States of America', entity: 'United States of America' },
  { location: 'US-MT', program: 'United States of America', entity: 'United States of America' },
  { location: 'US-WY', program: 'United States of America', entity: 'United States of America' }
];
const table = (answer: ReturnType<typeof nearPage>) => {
  if (!answer.ok) throw new Error(answer.reason);
  const section = answer.data.sections.find(entry => entry.shape === 'table');
  if (!section || section.shape !== 'table' || !('rows' in section)) throw new Error('no table');
  return section;
};

describe('Near Me (QGD-HOM-0013)', () => {
  it('lists the nearest first across borders, with distance, bearing and location, and no activations', () => {
    const answer = nearPage(parks, AT, HERE, places, places[0]);
    const shown = table(answer);
    expect(shown.columns.slice(0, 5)).toEqual(['Park', 'Name', 'km', 'Bearing °', 'Location']);
    expect(shown.rows.map(row => [row[0], row[4]])).toEqual([['US-0001', 'US-ID'], ['US-0002', 'US-WY'], ['US-0003', 'US-MT']]);
    expect(shown.sortedBy).toEqual({ column: 2, direction: 'ascending' });
    expect(() => validatePageAnswer(answer)).not.toThrow();
  });

  it('leads with Location at the active Location, then Distance; Program and Entity only with two choices', () => {
    // All of it in CONUS: Program and Entity would each offer one, so neither shows.
    const shown = table(nearPage(parks, AT, HERE, places, places[0]));
    expect(shown.filters!.map(filter => [filter.label, filter.start])).toEqual([['Location', 'US-ID'], ['Distance', undefined]]);
    // Montana and Wyoming one choice away.
    expect(shown.filters![0]!.options).toEqual(['US-ID', 'US-MT', 'US-WY']);
    // Near the Canadian line both show, starting where the Location is.
    const canada = { location: 'CA-BC', program: 'Canada', entity: 'Canada' };
    const border = table(nearPage([...parks, park('CA-0001', 44.6, -111.4, 'CA-BC')], AT, HERE, [...places, canada], places[0]));
    expect(border.filters!.map(filter => [filter.label, filter.start])).toEqual([
      ['Program', 'United States of America'], ['Entity', 'United States of America'], ['Location', 'US-ID'], ['Distance', undefined]]);
  });

  it('works without POTA\'s names, with Location and Distance alone', () => {
    const answer = nearPage(parks, AT, HERE);
    expect(table(answer).filters!.map(filter => filter.label)).toEqual(['Location', 'Distance']);
    expect(() => validatePageAnswer(answer)).not.toThrow();
  });

  it('says what to do with no position, and so when no park is near', () => {
    expect(nearPage(parks, AT, { name: 'Somewhere' })).toMatchObject({ ok: false, reason: expect.stringMatching(/no position/) });
    expect(nearPage(parks, AT, null)).toMatchObject({ ok: false });
    expect(nearPage([], AT, HERE)).toMatchObject({ ok: true, data: { sections: [{ shape: 'alert' }] } });
  });
});
