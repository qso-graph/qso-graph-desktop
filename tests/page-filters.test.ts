// SPDX-License-Identifier: GPL-3.0-only
// A table's filters as the core applies them (page data version 6): at once,
// in the window, with no new question asked.
import { describe, expect, it } from 'vitest';
import { filterOptions, filteredGroups, type Section } from '../packages/ui/page-shapes.js';

type Table = Extract<Section, { shape: 'table' }>;
const table: Table = { shape: 'table', columns: ['Activator', 'Band', 'Mode'], rows: [
  ['KI7MT', '20m', 'CW'], ['N0CALL', '40m', 'SSB'], ['KI7MT/P', '20m', 'SSB']
], filters: [{ column: 1, label: 'Band', options: ['40m', '20m'] }, { column: 2, label: 'Mode' }] };

describe('a table\'s filters', () => {
  it('offers the extension\'s options in its order, or else the column\'s values as they first appear', () => {
    expect(filterOptions(table, table.filters![0]!)).toEqual(['40m', '20m']);
    expect(filterOptions(table, table.filters![1]!)).toEqual(['CW', 'SSB']);
  });

  it('shows every row with nothing chosen, and only the rows every choice matches', () => {
    expect(filteredGroups(table, {})[0]!.rows).toHaveLength(3);
    expect(filteredGroups(table, { 1: '' })[0]!.rows).toHaveLength(3);
    expect(filteredGroups(table, { 1: '20m' })[0]!.rows.map(row => row[0])).toEqual(['KI7MT', 'KI7MT/P']);
    expect(filteredGroups(table, { 1: '20m', 2: 'SSB' })[0]!.rows.map(row => row[0])).toEqual(['KI7MT/P']);
    expect(filteredGroups(table, { 1: '40m', 2: 'CW' })).toEqual([]);
  });

  it('leaves a group out when none of its rows match, and a spanning row out once anything is chosen', () => {
    const grouped: Table = { shape: 'table', columns: ['Event', 'UTC', 'Your clock'], groups: [
      { heading: 'Sun', rows: [['Sunrise', '13:55', '07:55'], ['Length of day', '10 h 42 min']] },
      { heading: 'Moon', rows: [['Moonrise', '23:07', '17:07']] }
    ] };
    expect(filteredGroups(grouped, { 1: '13:55' })).toEqual([{ heading: 'Sun', rows: [['Sunrise', '13:55', '07:55']] }]);
  });
});
