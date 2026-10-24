// SPDX-License-Identifier: GPL-3.0-only
// A page's typed fields (KI7MT, 2026-10-22): each value checked by its kind
// before an extension sees it, refused rather than coerced (QGD-SEC-0006).
import { describe, expect, it } from 'vitest';
import { inputValue, inputValues, type PageInput } from '../packages/extension-api/inputs.js';

const GRID = { kind: 'grid' } as const;
const CALL = { kind: 'callsign' } as const;
const TEXT = { kind: 'text', max: 20 } as const;

describe('a grid, a callsign and a text, each by its kind', () => {
  it('writes a grid as hams do, at 2, 4, 6 and 8 characters, and refuses anything else', () => {
    expect(['fn', 'fn31', 'FN31PR', 'fn31pr57'].map(value => inputValue(GRID, value))).toEqual(['FN', 'FN31', 'FN31pr', 'FN31pr57']);
    for (const bad of ['F', 'FN3', 'FN31p', 'SN31', 'FN31YZ', 'FN31pr5', 'FN31pr571', 'FN 31', '']) expect(inputValue(GRID, bad), bad).toBeUndefined();
  });

  it('takes a callsign in capitals with its suffix, and refuses spaces and markup', () => {
    expect(inputValue(CALL, ' w1aw/p ')).toBe('W1AW/P');
    for (const bad of ['W1 AW', '<b>', '/W1AW', 'W1AW;x', 'x'.repeat(33)]) expect(inputValue(CALL, bad), bad).toBeUndefined();
  });

  it('bounds a text, and refuses markup and control characters', () => {
    expect(inputValue(TEXT, ' FT4 ')).toBe('FT4');
    for (const bad of ['x'.repeat(21), '<script>', 'a\u0000b', 7]) expect(inputValue(TEXT, bad), String(bad)).toBeUndefined();
  });
});

describe('the set a page is asked with', () => {
  const inputs: PageInput[] = [{ id: 'dx', label: 'DX grid', kind: 'grid' }, { id: 'q', label: 'Search', kind: 'text', max: 40 }];

  it('checks each against the input it names, and leaves out an empty one', () => {
    expect(inputValues(inputs, { dx: 'fn31pr', q: '' })).toEqual({ dx: 'FN31pr' });
    expect(inputValues(inputs, undefined)).toEqual({});
  });

  it('refuses the whole set for a field the page did not declare, or a value its kind refuses', () => {
    expect(inputValues(inputs, { dx: 'FN31', url: 'https://x.example/' })).toBeUndefined();
    expect(inputValues(inputs, { dx: 'not a grid' })).toBeUndefined();
    expect(inputValues(inputs, ['FN31'])).toBeUndefined();
  });
});
