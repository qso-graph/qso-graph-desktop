// SPDX-License-Identifier: GPL-3.0-only
// ADIF Lookup's page, checked by the core's own validator. The entries here
// are written for the test in the shape the core answers with; nothing of
// ADIF's files is copied.
import { describe, expect, it } from 'vitest';
import type { AdifEntry } from '../../../packages/extension-api/api-contract.js';
import { validatePageAnswer } from '../../../packages/extension-api/pages.js';
import { adifRows, lookupPage } from '../src/page.js';
import { pageContents } from '../../../packages/ui/page-shapes.js';

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

  it('gives each of ADIF\'s columns its own row, under ADIF\'s own name, nothing joined or left out', () => {
    expect(adifRows(FOUND[0]!)).toEqual([
      ['Band', 'Band', '20m'], ['Band', 'Lower Freq (MHz)', '14.0'], ['Band', 'Upper Freq (MHz)', '14.35']
    ]);
    expect(adifRows(FOUND[1]!)).toEqual([
      ['Field', 'Data Type', 'Enumeration'], ['Field', 'Enumeration', 'Band'], ['Field', 'Description', 'QSO band']
    ]);
  });

  it('draws each match as a group headed by its name, narrowed by list, Field first, and not as forty contents links', () => {
    const found = sections(lookupPage('20m', FOUND, NOW));
    const [table] = found;
    if (!table || table.shape !== 'table' || !('groups' in table)) throw new Error('no table');
    expect(table.columns).toEqual(['List', 'ADIF column', 'Value']);
    expect(table.groups.map(group => group.heading)).toEqual(['20m', 'BAND', 'FT8']);
    expect(table.filters).toEqual([{ column: 0, label: 'List', options: ['Field', 'Band', 'Mode'] }]);
    expect(pageContents(found)).toEqual([]);
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

  it('keeps ADIF\'s longest text whole: 3.1.7\'s longest description is 634 characters', () => {
    const long = 'y'.repeat(634);
    const entry = { list: 'Field', key: 'MY_GRIDSQUARE_EXT', columns: [{ name: 'Description', value: long }] };
    expect(adifRows(entry)[0]![2]).toBe(long);
    expect(() => validatePageAnswer(lookupPage('MY_GRIDSQUARE_EXT', [entry], NOW))).not.toThrow();
  });

  it('never sends markup to the page', () => {
    const entry = { list: 'Field', key: 'COMMENT', columns: [{ name: 'Description', value: '<b>bold</b>' }] };
    expect(adifRows(entry)[0]![2]).toBe('bbold/b');
  });
});
