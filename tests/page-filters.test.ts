// SPDX-License-Identifier: GPL-3.0-only
// A table's filters as the core applies them (page data version 6): at once,
// in the window, with no new question asked.
import { describe, expect, it } from 'vitest';
import { filterOptions, filteredGroups, sortedGroups, type Section } from '../packages/ui/page-shapes.js';

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

describe('a sortable table (KI7MT, 2026-10-23)', () => {
  const spots: Table = { shape: 'table', sortable: true, columns: ['Activator', 'MHz', 'Band', 'UTC'], rows: [
    ['KI7MT', '14.062', '20m', '18:52'], ['N0CALL', '7.186', '40m', '18:40'], ['KI7MT/P', '1.840', '160m', '18:45'], ['AB1C', '28.074', '10m', '18:40']
  ], filters: [{ column: 2, label: 'Band', options: ['160m', '40m', '20m', '10m'] }] };
  const order = (column: number, direction: 'ascending' | 'descending') =>
    sortedGroups(spots, filteredGroups(spots, {}), { column, direction })[0]!.rows.map(row => row[0]);

  it('keeps the extension\'s order until a heading is chosen', () => {
    expect(sortedGroups(spots, filteredGroups(spots, {}), undefined)[0]!.rows.map(row => row[0])).toEqual(['KI7MT', 'N0CALL', 'KI7MT/P', 'AB1C']);
  });

  it('sorts numbers as numbers, both ways', () => {
    expect(order(1, 'ascending')).toEqual(['KI7MT/P', 'N0CALL', 'KI7MT', 'AB1C']);
    expect(order(1, 'descending')).toEqual(['AB1C', 'KI7MT', 'N0CALL', 'KI7MT/P']);
  });

  it('sorts a column with a filter\'s options in their order: 160m before 10m', () => {
    expect(order(2, 'ascending')).toEqual(['KI7MT/P', 'N0CALL', 'KI7MT', 'AB1C']);
  });

  it('sorts text with its numbers as numbers, and keeps equal rows in the extension\'s order', () => {
    expect(order(0, 'ascending')).toEqual(['AB1C', 'KI7MT', 'KI7MT/P', 'N0CALL']);
    expect(order(3, 'ascending')).toEqual(['N0CALL', 'AB1C', 'KI7MT/P', 'KI7MT']);
  });
});

describe('a table sent in order of a column (KI7MT, 2026-10-23)', () => {
  // Newest first, across midnight UTC: as text, 00:05 would sort below 23:50.
  const spots: Table = { shape: 'table', sortable: true, sortedBy: { column: 1, direction: 'descending' }, columns: ['Activator', 'UTC'], rows: [
    ['KI7MT', '00:05'], ['N0CALL', '23:50'], ['AB1C', '23:40']
  ] };
  const order = (direction: 'ascending' | 'descending') =>
    sortedGroups(spots, filteredGroups(spots, {}), { column: 1, direction })[0]!.rows.map(row => row[0]);

  it('sorts that column by the order sent, and turned round the other way, not by its text', () => {
    expect(order('descending')).toEqual(['KI7MT', 'N0CALL', 'AB1C']);
    expect(order('ascending')).toEqual(['AB1C', 'N0CALL', 'KI7MT']);
  });
});
