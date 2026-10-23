// SPDX-License-Identifier: GPL-3.0-only
// A table's filters as the core applies them (page data version 6): at once,
// in the window, with no new question asked.
import { describe, expect, it } from 'vitest';
import { filterOptions, filteredGroups, offeredOptions, pageContents, shortList, sortedGroups, startingChoices, type Section } from '../packages/ui/page-shapes.js';

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
    const grouped: Table = { shape: 'table', columns: ['Event', 'UTC', 'Your clock'], filters: [{ column: 1, label: 'UTC' }], groups: [
      { heading: 'Sun', rows: [['Sunrise', '13:55', '07:55'], ['Length of day', '10 h 42 min']] },
      { heading: 'Moon', rows: [['Moonrise', '23:07', '17:07']] }
    ] };
    expect(filteredGroups(grouped, { 1: '13:55' })).toEqual([{ heading: 'Sun', at: 0, rows: [['Sunrise', '13:55', '07:55']] }]);
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

describe('the page\'s contents line (KI7MT, 2026-10-23)', () => {
  const note = (heading?: string, contents?: false): Section => ({ shape: 'alert', level: 'info', text: 'x', ...(heading ? { heading } : {}), ...(contents === false ? { contents } : {}) });
  it('lists headings and table groups in order, each with where it goes, leaving out what is left out', () => {
    const grouped: Section = { shape: 'table', columns: ['Event', 'UTC'], groups: [{ heading: 'Sun', rows: [] }, { heading: 'Moon', rows: [] }] };
    expect(pageContents([note('Map', false), note('DX check'), note(), grouped])).toEqual([
      { id: 'page-part-1', label: 'DX check' }, { id: 'page-part-3-0', label: 'Sun' }, { id: 'page-part-3-1', label: 'Moon' }
    ]);
  });
  it('gives a short page none', () => {
    expect(pageContents([note('One'), note('Two')])).toEqual([]);
  });
});

describe('a choice the table no longer offers (Codex review, 2026-10-23)', () => {
  it('is not applied: a refreshed table without that filter shows all its rows', () => {
    const refreshed: Table = { shape: 'table', columns: ['Mode', 'Count'], rows: [['CW', '3'], ['SSB', '5']] };
    // Column 0 was set to 20m while it was a Band filter; now it is Mode, unfiltered.
    expect(filteredGroups(refreshed, { 0: '20m' })[0]!.rows).toHaveLength(2);
  });
});

describe('groups that share a heading (Codex review, 2026-10-23)', () => {
  it('keep their own places, so each contents link reaches its own group', () => {
    const repeated: Table = { shape: 'table', columns: ['Event', 'Time'], groups: [
      { heading: 'Repeated', rows: [['a', '1']] }, { heading: 'Repeated', rows: [['b', '2']] }, { heading: 'Other', rows: [['c', '3']] }
    ] };
    expect(filteredGroups(repeated, {}).map(group => group.at)).toEqual([0, 1, 2]);
    expect(pageContents([repeated, repeated]).map(entry => entry.id)).toContain('page-part-0-1');
  });
});

describe('a filter over cells with several values (KI7MT, 2026-10-23)', () => {
  const parks: Table = { shape: 'table', columns: ['Park', 'Location'], rows: [
    ['JP-0011', 'JP-FS, JP-GM, JP-NI, JP-TC'], ['JP-1874', 'JP-FS'], ['GB-0612', 'GB-ENG']
  ], filters: [{ column: 1, label: 'Location', multiple: true }] };
  it('offers each value on its own, and keeps a row any of whose values is chosen', () => {
    expect(filterOptions(parks, parks.filters![0]!)).toEqual(['JP-FS', 'JP-GM', 'JP-NI', 'JP-TC', 'GB-ENG']);
    expect(filteredGroups(parks, { 1: 'JP-FS' })[0]!.rows.map(row => row[0])).toEqual(['JP-0011', 'JP-1874']);
    expect(filteredGroups(parks, { 1: 'JP-TC' })[0]!.rows.map(row => row[0])).toEqual(['JP-0011']);
  });
});

describe('a named choice and where a filter starts (KI7MT, 2026-10-23)', () => {
  const parks: Table = { shape: 'table', columns: ['Park', 'Location'], rows: [
    ['JP-0011', 'JP-FS, JP-GM'], ['US-0001', 'US-ID'], ['US-0002', 'US-MT'], ['GB-0612', 'GB-ENG']
  ], filters: [{ column: 1, label: 'Location', multiple: true, named: [{ label: 'My area', values: ['US-ID', 'US-MT'] }], start: 'My area' }] };
  it('keeps the rows any of whose values is among the named choice\'s, and starts there', () => {
    expect(startingChoices(parks)).toEqual({ 1: 'My area' });
    expect(filteredGroups(parks, startingChoices(parks))[0]!.rows.map(row => row[0])).toEqual(['US-0001', 'US-0002']);
    expect(filteredGroups(parks, { 1: '' })[0]!.rows).toHaveLength(4);
  });
});

describe('an up-to choice over a column of numbers (KI7MT, 2026-10-23)', () => {
  const section = { shape: 'table' as const, columns: ['Park', 'km'], rows: [['A', '9'], ['B', '50'], ['C', '51'], ['D', '—']],
    filters: [{ column: 1, label: 'Distance', upTo: [{ label: 'Within 50 km', value: 50 }] }] };
  it('keeps the rows whose number is at most the bound, a cell that is not a number never', () => {
    expect(filteredGroups(section, { 1: 'Within 50 km' })[0]!.rows.map(row => row[0])).toEqual(['A', 'B']);
    expect(filteredGroups(section, { 1: '' })[0]!.rows).toHaveLength(4);
  });
  it('offers no values of its own beside its choices', () => {
    expect(filterOptions(section, section.filters[0]!)).toEqual([]);
  });
});

describe('sorting a column of counts with a filter over some of them (KI7MT, 2026-10-23)', () => {
  // Parks Near Me: activations, a null shown as none, and a filter whose
  // options are only none and 0 to 9.
  const section = { shape: 'table' as const, columns: ['Park', 'Activations'], sortable: true as const,
    rows: [['A', '12'], ['B', 'none'], ['C', '3'], ['D', '150'], ['E', '0'], ['F', '27']],
    filters: [{ column: 1, label: 'Activations', options: ['none', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'] }] };
  const order = (direction: 'ascending' | 'descending') =>
    sortedGroups(section, filteredGroups(section, {}), { column: 1, direction })[0]!.rows.map(row => row[0]);
  it('sorts every count as a number, the word before them, both ways', () => {
    expect(order('ascending')).toEqual(['B', 'E', 'C', 'A', 'F', 'D']);
    expect(order('descending')).toEqual(['D', 'F', 'A', 'C', 'E', 'B']);
  });
  it('still sorts by the options\' order when every cell is one of them, as bands do', () => {
    const bands = { shape: 'table' as const, columns: ['Call', 'Band'], sortable: true as const,
      rows: [['A', '20m'], ['B', '160m'], ['C', '6m']], filters: [{ column: 1, label: 'Band', options: ['160m', '20m', '6m'] }] };
    expect(sortedGroups(bands, filteredGroups(bands, {}), { column: 1, direction: 'ascending' })[0]!.rows.map(row => row[0])).toEqual(['B', 'A', 'C']);
  });
});

describe('each filter offers what the others leave (KI7MT, 2026-10-23)', () => {
  // Spotted now's Program and Entity: United States should leave the United
  // States' entities, and Location its locations.
  const section = { shape: 'table' as const, columns: ['Call', 'Location', 'Program', 'Entity'], hidden: 2,
    rows: [
      ['A', 'US-ID', 'United States of America', 'United States of America'],
      ['B', 'US-AK', 'United States of America', 'Alaska'],
      ['C', 'IT-LZ', 'Italy', 'Italy'],
      ['D', 'US-ID, US-OR', 'United States of America', 'United States of America']
    ],
    filters: [
      { column: 2, label: 'Program', options: ['Italy', 'United States of America'], multiple: true as const },
      { column: 3, label: 'Entity', options: ['Alaska', 'Italy', 'United States of America'], multiple: true as const },
      { column: 1, label: 'Location', multiple: true as const }
    ] };
  const [program, entity, location] = section.filters;

  it('offers every option while nothing else is chosen', () => {
    expect(offeredOptions(section, entity!, {})).toEqual(['Alaska', 'Italy', 'United States of America']);
    expect(offeredOptions(section, entity!, { 3: '' })).toEqual(['Alaska', 'Italy', 'United States of America']);
  });

  it('narrows each filter by the others\' choices, never by its own', () => {
    const us = { 2: 'United States of America' };
    expect(offeredOptions(section, entity!, us)).toEqual(['Alaska', 'United States of America']);
    expect(offeredOptions(section, location!, us)).toEqual(['US-ID', 'US-AK', 'US-OR']);
    expect(offeredOptions(section, program!, us)).toEqual(['Italy', 'United States of America']);
    expect(offeredOptions(section, location!, { 2: 'United States of America', 3: 'Alaska' })).toEqual(['US-AK']);
  });

  it('keeps a filter\'s own choice offered when the others would leave it no row', () => {
    expect(offeredOptions(section, entity!, { 2: 'Italy', 3: 'Alaska' })).toEqual(['Alaska', 'Italy']);
  });
});

describe('a long list drawn short (KI7MT, 2026-10-23)', () => {
  it('draws three values and how many more, and leaves a short list as it is', () => {
    expect(shortList('US-IA, US-ID, US-IL, US-IN, US-KS')).toBe('US-IA, US-ID, US-IL +2 more');
    expect(shortList('US-ID, US-MT, US-OR')).toBeUndefined();
    expect(shortList('US-ID')).toBeUndefined();
  });
});
