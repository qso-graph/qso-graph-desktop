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

  it('adds both columns, hidden, with their two filters, offering only real names', () => {
    const rows = [['A'], ['B'], ['C']];
    const cells = [placeCells(['US-ID'], places), placeCells(['US-AK'], places), placeCells(['ZZ-QQ'], places)];
    const added = withPlaces(rows, cells);
    expect(added.columns).toEqual(['Program', 'Entity']);
    expect(added.hidden).toBe(2);
    expect(added.rows[1]).toEqual(['B', 'United States of America', 'Alaska']);
    expect(added.filters).toEqual([
      { column: 1, label: 'Program', options: ['United States of America'], multiple: true },
      { column: 2, label: 'Entity', options: ['Alaska', 'United States of America'], multiple: true }
    ]);
  });

  it('adds nothing without places, or where none has a choice to offer', () => {
    expect(withPlaces([['A']], [])).toEqual({ rows: [['A']], columns: [], filters: [] });
    expect(withPlaces([['A']], [placeCells(['ZZ-QQ'], places)])).toEqual({ rows: [['A']], columns: [], filters: [] });
    // Near me asks for two: an area all in Idaho has nothing to choose.
    expect(withPlaces([['A'], ['B']], [placeCells(['US-ID'], places), placeCells(['US-OR'], places)], 2).columns).toEqual([]);
    expect(withPlaces([['A'], ['B']], [placeCells(['US-ID'], places), placeCells(['IT-LZ'], places)], 2).columns).toEqual(['Program', 'Entity']);
  });
});
