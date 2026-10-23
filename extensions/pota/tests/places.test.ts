// SPDX-License-Identifier: GPL-3.0-only
// Program and Entity, the filters POTA's own park list starts with (KI7MT,
// 2026-10-23), carried in columns the core does not draw.
import { describe, expect, it } from 'vitest';
import { placeCells, placesBy, withPlaces } from '../src/places.js';

const places = placesBy([
  { location: 'US-ID', program: 'United States of America', entity: 'United States of America' },
  { location: 'US-OR', program: 'United States of America', entity: 'United States of America' },
  { location: 'US-AK', program: 'United States of America', entity: 'Alaska' },
  { location: 'IT-LZ', program: 'Italy', entity: 'Italy' }
]);

describe('Program and Entity', () => {
  it('names a row\'s program and entity once each, and an unknown place as —', () => {
    expect(placeCells(['US-ID', 'US-OR'], places)).toEqual({ program: 'United States of America', entity: 'United States of America' });
    expect(placeCells(['US-ID', 'US-AK'], places)).toEqual({ program: 'United States of America', entity: 'United States of America, Alaska' });
    expect(placeCells(['ZZ-QQ'], places)).toEqual({ program: '—', entity: '—' });
  });

  it('adds a column, hidden, with its filter, only where it offers two choices or more (KI7MT, 2026-10-23)', () => {
    const rows = [['A'], ['B'], ['C']];
    // Idaho, Alaska and nowhere: one program, two entities, so Entity alone.
    const added = withPlaces(rows, [placeCells(['US-ID'], places), placeCells(['US-AK'], places), placeCells(['ZZ-QQ'], places)]);
    expect(added.columns).toEqual(['Entity']);
    expect(added.hidden).toBe(1);
    expect(added.rows[1]).toEqual(['B', 'Alaska']);
    expect(added.filters).toEqual([{ column: 1, label: 'Entity', options: ['Alaska', 'United States of America'], multiple: true }]);
    // Idaho and Italy: two of each.
    const both = withPlaces([['A'], ['B']], [placeCells(['US-ID'], places), placeCells(['IT-LZ'], places)]);
    expect(both.columns).toEqual(['Program', 'Entity']);
    expect(both.filters.map(filter => [filter.column, filter.label])).toEqual([[1, 'Program'], [2, 'Entity']]);
  });

  it('adds nothing without places, or where each has a single choice', () => {
    expect(withPlaces([['A']], [])).toEqual({ rows: [['A']], columns: [], filters: [] });
    expect(withPlaces([['A']], [placeCells(['ZZ-QQ'], places)])).toEqual({ rows: [['A']], columns: [], filters: [] });
    expect(withPlaces([['A'], ['B']], [placeCells(['US-ID'], places), placeCells(['US-OR'], places)]).columns).toEqual([]);
  });

  it('starts each filter on a given choice it offers, and on All otherwise', () => {
    const added = withPlaces([['A'], ['B']], [placeCells(['US-ID'], places), placeCells(['IT-LZ'], places)],
      { program: 'United States of America', entity: 'Hawaii' });
    expect(added.filters.map(filter => filter.start)).toEqual(['United States of America', undefined]);
  });
});

describe('only the levels a page wants (KI7MT, 2026-10-23)', () => {
  it('gives Spots Entity alone, the DXCC entity a chaser counts', () => {
    const added = withPlaces([['A'], ['B']], [placeCells(['US-ID'], places), placeCells(['IT-LZ'], places)], {}, ['entity']);
    expect(added.columns).toEqual(['Entity']);
    expect(added.filters.map(filter => filter.label)).toEqual(['Entity']);
  });
});
