// SPDX-License-Identifier: GPL-3.0-only
// P8-shapes: card data is checked before Home draws any of it (QGD-HOM-0002,
// QGD-SEC-0006). Good data in each shape is accepted as given; anything off
// the shape is refused with a reason, never coerced.
import { describe, expect, it } from 'vitest';
import { CARD_LIMITS, validateCardAnswer } from '../packages/extension-api/cards.js';

const AT = '2026-10-11T18:00:00Z';
const answer = (sections: unknown[], extra: Record<string, unknown> = {}) =>
  ({ ok: true, data: { version: 1, observedAt: AT, sections, ...extra } });
const FIGURES = { shape: 'figures', figures: [{ label: 'Solar flux', value: '148', unit: 'sfu' }, { label: 'K index', value: '2' }] };
const ITEMS = { shape: 'items', items: [{ title: '20 m', detail: 'Good by day' }, { title: '80 m' }] };
const ALERT = { shape: 'alert', level: 'warning', text: 'G1 geomagnetic storm watch' };

describe('P8-shapes: the card shapes (QGD-HOM-0002)', () => {
  it('accepts each shape, and up to three sections, exactly as sent', () => {
    expect(validateCardAnswer(answer([ALERT, FIGURES, ITEMS]))).toEqual(answer([ALERT, FIGURES, ITEMS]));
    expect(validateCardAnswer({ ok: false, reason: 'NOAA did not answer.' })).toEqual({ ok: false, reason: 'NOAA did not answer.' });
  });

  it('refuses markup in any string a card would draw', () => {
    for (const bad of [
      { ...FIGURES, figures: [{ label: '<img src=x onerror=1>', value: '1' }] },
      { ...ITEMS, items: [{ title: 'ok', detail: '<script>' }] },
      { ...ALERT, text: 'a > b' }
    ]) expect(() => validateCardAnswer(answer([bad]))).toThrowError(/holds markup/);
    expect(() => validateCardAnswer({ ok: false, reason: '<b>down</b>' })).toThrowError(/holds markup/);
  });

  it('refuses an extra field, a wrong type or an unknown shape', () => {
    expect(() => validateCardAnswer(answer([FIGURES], { colour: 'red' }))).toThrowError(/"colour"/);
    expect(() => validateCardAnswer(answer([{ ...FIGURES, style: 'big' }]))).toThrowError(/"style"/);
    expect(() => validateCardAnswer(answer([{ shape: 'figures', figures: [{ label: 'K', value: 2 }] }]))).toThrowError(/value is not text/);
    expect(() => validateCardAnswer(answer([{ shape: 'html', html: 'x' }]))).toThrowError(/not a figures, items, alert or table section/);
    expect(() => validateCardAnswer(answer([{ ...ALERT, level: 'panic' }]))).toThrowError(/no level of info, warning or severe/);
    expect(() => validateCardAnswer({ ok: 'yes', data: {} })).toThrowError(/neither ok nor not/);
  });

  it('refuses data with no time, a time that is not UTC, or another version', () => {
    expect(() => validateCardAnswer(answer([FIGURES], { observedAt: '2026-10-11 18:00' }))).toThrowError(/ISO 8601 UTC/);
    expect(() => validateCardAnswer(answer([FIGURES], { observedAt: '2026-10-11T18:00:00+02:00' }))).toThrowError(/ISO 8601 UTC/);
    expect(() => validateCardAnswer(answer([FIGURES], { observedAt: undefined }))).toThrowError(/ISO 8601 UTC/);
    expect(() => validateCardAnswer(answer([FIGURES], { version: 4 }))).toThrowError(/version 4; this core draws versions 1, 2 and 3/);
    // A time that matches the pattern and does not exist: Date.parse alone
    // would roll it over to 2 March.
    for (const impossible of ['2026-02-30T00:00:00Z', '2026-13-01T00:00Z', '2026-10-11T25:00:00Z', '2026-10-11T18:60:00Z']) {
      expect(() => validateCardAnswer(answer([FIGURES], { observedAt: impossible })), impossible).toThrowError(/ISO 8601 UTC/);
    }
    expect(validateCardAnswer(answer([FIGURES], { observedAt: '2026-10-11T18:00:00.250Z' })).ok).toBe(true);
  });

  it('refuses a list with a gap in it, which a map over the list would skip', () => {
    expect(() => validateCardAnswer(answer(new Array(1)))).toThrowError(/gap at position 1/);
    expect(() => validateCardAnswer(answer([{ shape: 'figures', figures: new Array(2) }]))).toThrowError(/gap at position 1/);
    const holey = [{ title: 'a' }]; holey.length = 3;
    expect(() => validateCardAnswer(answer([{ shape: 'items', items: holey }]))).toThrowError(/gap at position 2/);
  });

  it('holds every card to its bounds', () => {
    expect(() => validateCardAnswer(answer([]))).toThrowError(/no sections/);
    expect(() => validateCardAnswer(answer([FIGURES, FIGURES, FIGURES, FIGURES]))).toThrowError(/more than 3/);
    const tooMany = Array.from({ length: CARD_LIMITS.figures + 1 }, (_, i) => ({ label: `F${i}`, value: '1' }));
    expect(() => validateCardAnswer(answer([{ shape: 'figures', figures: tooMany }]))).toThrowError(/more than 8/);
    expect(() => validateCardAnswer(answer([{ shape: 'figures', figures: [{ label: 'x'.repeat(41), value: '1' }] }]))).toThrowError(/at most 40/);
    const items = Array.from({ length: CARD_LIMITS.items + 1 }, (_, i) => ({ title: `I${i}` }));
    expect(() => validateCardAnswer(answer([{ shape: 'items', items }]))).toThrowError(/at most 10/);
  });
});

describe('a figure\'s own time, card data version 3 (KI7MT, 2026-10-22)', () => {
  const timed = { shape: 'figures', figures: [{ label: 'Solar flux', value: '115', observedAt: '2026-10-21T20:00:00Z' }] };
  const v = (version: number, sections: unknown[]) => ({ ok: true, data: { version, observedAt: AT, sections } });

  it('carries a figure\'s time in version 3 data', () => {
    expect(validateCardAnswer(v(3, [timed]))).toEqual(v(3, [timed]));
  });

  it('refuses a figure\'s time in older data, or one that is not a real UTC time', () => {
    expect(() => validateCardAnswer(v(2, [timed]))).toThrowError(/version 2 does not have/);
    for (const observedAt of ['2026-02-30T20:00:00Z', '2026-10-21 20:00', 'yesterday', 20]) {
      expect(() => validateCardAnswer(v(3, [{ shape: 'figures', figures: [{ label: 'x', value: '1', observedAt }] }]))).toThrowError(/time/);
    }
  });
});

describe('the table shape, card data version 2 (KI7MT, 2026-10-20)', () => {
  const table = { shape: 'table', columns: ['Band', 'Status', 'Comment'], rows: [['20m', 'Good', 'Reliable daytime DX'], ['6m', 'Sporadic', 'Watch for Es']] };
  const v2 = (sections: unknown[]) => ({ ok: true, data: { version: 2, observedAt: AT, sections } });

  it('draws a table under named columns in version 2 data', () => {
    expect(validateCardAnswer(v2([table]))).toEqual(v2([table]));
  });

  it('still draws version 1 data, and refuses a table in it rather than guessing', () => {
    expect(validateCardAnswer({ ok: true, data: { version: 1, observedAt: AT, sections: [{ shape: 'alert', level: 'info', text: 'Quiet' }] } }).ok).toBe(true);
    expect(() => validateCardAnswer({ ok: true, data: { version: 1, observedAt: AT, sections: [table] } })).toThrowError(/version 1 does not have/);
  });

  it.each([
    [{ ...table, rows: [['20m', 'Good']] }, /does not have 3 cells/],
    [{ ...table, columns: [] }, /no columns/],
    [{ ...table, columns: ['a', 'b', 'c', 'd', 'e'], rows: [] }, /more than 4/],
    [{ ...table, rows: Array.from({ length: 13 }, () => ['a', 'b', 'c']) }, /at most 12/],
    [{ ...table, rows: [['20m', 'Good', 'x'.repeat(81)]] }, /cell 3/],
    [{ ...table, rows: [['20m', 'Good', '<b>x</b>']] }, /./],
    [{ ...table, html: 'x' }, /./]
  ])('refuses an off-shape table (%#)', (value, message) => {
    expect(() => validateCardAnswer(v2([value]))).toThrowError(message);
  });
});
