// SPDX-License-Identifier: GPL-3.0-only
// ADIF Lookup's page, checked by the core's own validator. The entries here
// are written for the test in the shape the core answers with; nothing of
// ADIF's files is copied.
import { describe, expect, it } from 'vitest';
import type { AdifEntry } from '../../../packages/extension-api/api-contract.js';
import { validatePageAnswer } from '../../../packages/extension-api/pages.js';
import { adifSays, lookupPage } from '../src/page.js';

const NOW = new Date('2026-10-23T18:00:00Z');
const FOUND: AdifEntry[] = [
  { list: 'Band', key: '20m', columns: [{ name: 'Band', value: '20m' }, { name: 'Lower Freq (MHz)', value: '14.0' }, { name: 'Upper Freq (MHz)', value: '14.35' }] },
  { list: 'Field', key: 'BAND', columns: [{ name: 'Data Type', value: 'Enumeration' }, { name: 'Enumeration', value: 'Band' }, { name: 'Description', value: 'QSO band' }] },
  { list: 'Mode', key: 'FT8', columns: [{ name: 'Mode', value: 'FT8' }] }
];
const sections = (answer: ReturnType<typeof lookupPage>) => {
  const valid = validatePageAnswer(answer);
  if (!valid.ok) throw new Error('not ok');
  return valid.data.sections;
};

describe('ADIF Lookup', () => {
  it('says what it searches before anything is typed', () => {
    expect(sections(lookupPage(undefined, [], NOW))).toEqual([{ shape: 'text', text: expect.stringMatching(/^Search ADIF's own definitions/) }]);
  });

  it('shows ADIF\'s text under ADIF\'s own column names, nothing added, the name not said twice', () => {
    expect(adifSays(FOUND[0]!)).toBe('Lower Freq (MHz): 14.0 · Upper Freq (MHz): 14.35');
    expect(adifSays(FOUND[1]!)).toBe('Data Type: Enumeration · Enumeration: Band · Description: QSO band');
    // A value with nothing but its own name: an empty column is not filled.
    expect(adifSays(FOUND[2]!)).toBe('—');
  });

  it('draws the matches as a sortable table, narrowed by list, Field first', () => {
    const [table] = sections(lookupPage('20m', FOUND, NOW));
    if (!table || table.shape !== 'table' || !('rows' in table)) throw new Error('no table');
    expect(table.columns).toEqual(['List', 'Name', 'ADIF says']);
    expect(table.rows.map(row => row[1])).toEqual(['20m', 'BAND', 'FT8']);
    expect(table.sortable).toBe(true);
    expect(table.filters).toEqual([{ column: 0, label: 'List', options: ['Field', 'Band', 'Mode'] }]);
  });

  it('says so when nothing matches, and passes on in its own words why it could not search', () => {
    expect(sections(lookupPage('ZZZ', [], NOW))).toEqual([{ shape: 'text', text: 'Nothing in ADIF\'s definitions matches ZZZ.' }]);
    const why = 'ADIF\'s definitions are not downloaded. Download them in Settings, then try again.';
    expect(sections(lookupPage('FT8', why, NOW))).toEqual([{ shape: 'alert', level: 'info', text: why }]);
  });

  it('says when it shows only the first forty', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ list: 'Mode', key: `M${i}`, columns: [{ name: 'Description', value: 'x' }] }));
    expect(sections(lookupPage('M', many, NOW)).at(-1)).toEqual({ shape: 'text', text: 'The first 40 matches are shown. A longer search narrows them.' });
  });

  it('keeps ADIF\'s long text whole up to what a cell holds, and never sends markup', () => {
    const long = { list: 'Field', key: 'COMMENT', columns: [{ name: 'Description', value: `<b>${'y'.repeat(300)}</b>` }] };
    const said = adifSays(long);
    expect(said.length).toBeLessThanOrEqual(200);
    expect(said).not.toMatch(/[<>]/);
    expect(() => validatePageAnswer(lookupPage('COMMENT', [long], NOW))).not.toThrow();
  });
});
