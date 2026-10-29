// SPDX-License-Identifier: GPL-3.0-only
// P8-shapes: page data is checked before Home draws any of it (QGD-HOM-0002,
// QGD-SEC-0006). Good data in each shape is accepted as given; anything off
// the shape is refused with a reason, never coerced.
import { describe, expect, it } from 'vitest';
import { PAGE_LIMITS, validatePageAnswer } from '../packages/extension-api/pages.js';

const AT = '2026-10-11T18:00:00Z';
const answer = (sections: unknown[], extra: Record<string, unknown> = {}) =>
  ({ ok: true, data: { version: 1, observedAt: AT, sections, ...extra } });
const FIGURES = { shape: 'figures', figures: [{ label: 'Solar flux', value: '148', unit: 'sfu' }, { label: 'K index', value: '2' }] };
const ITEMS = { shape: 'items', items: [{ title: '20 m', detail: 'Good by day' }, { title: '80 m' }] };
const ALERT = { shape: 'alert', level: 'warning', text: 'G1 geomagnetic storm watch' };

describe('P8-shapes: the page shapes (QGD-HOM-0002)', () => {
  it('accepts each shape, and up to three sections, exactly as sent', () => {
    expect(validatePageAnswer(answer([ALERT, FIGURES, ITEMS]))).toEqual(answer([ALERT, FIGURES, ITEMS]));
    expect(validatePageAnswer({ ok: false, reason: 'NOAA did not answer.' })).toEqual({ ok: false, reason: 'NOAA did not answer.' });
  });

  it('refuses markup in any string a page would draw', () => {
    for (const bad of [
      { ...FIGURES, figures: [{ label: '<img src=x onerror=1>', value: '1' }] },
      { ...ITEMS, items: [{ title: 'ok', detail: '<script>' }] },
      { ...ALERT, text: 'a > b' }
    ]) expect(() => validatePageAnswer(answer([bad]))).toThrowError(/holds markup/);
    expect(() => validatePageAnswer({ ok: false, reason: '<b>down</b>' })).toThrowError(/holds markup/);
  });

  it('refuses an extra field, a wrong type or an unknown shape', () => {
    expect(() => validatePageAnswer(answer([FIGURES], { colour: 'red' }))).toThrowError(/"colour"/);
    expect(() => validatePageAnswer(answer([{ ...FIGURES, style: 'big' }]))).toThrowError(/"style"/);
    expect(() => validatePageAnswer(answer([{ shape: 'figures', figures: [{ label: 'K', value: 2 }] }]))).toThrowError(/value is not text/);
    expect(() => validatePageAnswer(answer([{ shape: 'html', html: 'x' }]))).toThrowError(/not a figures, items, alert, text, table, map or fields section/);
    expect(() => validatePageAnswer(answer([{ ...ALERT, level: 'panic' }]))).toThrowError(/no level of info, warning or severe/);
    expect(() => validatePageAnswer({ ok: 'yes', data: {} })).toThrowError(/neither ok nor not/);
  });

  it('refuses data with no time, a time that is not UTC, or another version', () => {
    expect(() => validatePageAnswer(answer([FIGURES], { observedAt: '2026-10-11 18:00' }))).toThrowError(/ISO 8601 UTC/);
    expect(() => validatePageAnswer(answer([FIGURES], { observedAt: '2026-10-11T18:00:00+02:00' }))).toThrowError(/ISO 8601 UTC/);
    expect(() => validatePageAnswer(answer([FIGURES], { observedAt: undefined }))).toThrowError(/ISO 8601 UTC/);
    expect(() => validatePageAnswer(answer([FIGURES], { version: 8 }))).toThrowError(/version 8; this core draws versions 1, 2, 3, 4, 5, 6 and 7/);
    // A time that matches the pattern and does not exist: Date.parse alone
    // would roll it over to 2 March.
    for (const impossible of ['2026-02-30T00:00:00Z', '2026-13-01T00:00Z', '2026-10-11T25:00:00Z', '2026-10-11T18:60:00Z']) {
      expect(() => validatePageAnswer(answer([FIGURES], { observedAt: impossible })), impossible).toThrowError(/ISO 8601 UTC/);
    }
    expect(validatePageAnswer(answer([FIGURES], { observedAt: '2026-10-11T18:00:00.250Z' })).ok).toBe(true);
  });

  it('refuses a list with a gap in it, which a map over the list would skip', () => {
    expect(() => validatePageAnswer(answer(new Array(1)))).toThrowError(/gap at position 1/);
    expect(() => validatePageAnswer(answer([{ shape: 'figures', figures: new Array(2) }]))).toThrowError(/gap at position 1/);
    const holey = [{ title: 'a' }]; holey.length = 3;
    expect(() => validatePageAnswer(answer([{ shape: 'items', items: holey }]))).toThrowError(/gap at position 2/);
  });

  it('holds every page to its bounds', () => {
    expect(() => validatePageAnswer(answer([]))).toThrowError(/no sections/);
    expect(() => validatePageAnswer(answer(Array.from({ length: PAGE_LIMITS.sections + 1 }, () => FIGURES)))).toThrowError(/more than 12/);
    const tooMany = Array.from({ length: PAGE_LIMITS.figures + 1 }, (_, i) => ({ label: `F${i}`, value: '1' }));
    expect(() => validatePageAnswer(answer([{ shape: 'figures', figures: tooMany }]))).toThrowError(/more than 8/);
    expect(() => validatePageAnswer(answer([{ shape: 'figures', figures: [{ label: 'x'.repeat(41), value: '1' }] }]))).toThrowError(/at most 40/);
    const items = Array.from({ length: PAGE_LIMITS.items + 1 }, (_, i) => ({ title: `I${i}` }));
    expect(() => validatePageAnswer(answer([{ shape: 'items', items }]))).toThrowError(/at most 40/);
  });
});

describe('a figure\'s own time, page data version 3 (KI7MT, 2026-10-22)', () => {
  const timed = { shape: 'figures', figures: [{ label: 'Solar flux', value: '115', observedAt: '2026-10-21T20:00:00Z' }] };
  const v = (version: number, sections: unknown[]) => ({ ok: true, data: { version, observedAt: AT, sections } });

  it('carries a figure\'s time in version 3 data', () => {
    expect(validatePageAnswer(v(3, [timed]))).toEqual(v(3, [timed]));
  });

  it('refuses a figure\'s time in older data, or one that is not a real UTC time', () => {
    expect(() => validatePageAnswer(v(2, [timed]))).toThrowError(/version 2 does not have/);
    for (const observedAt of ['2026-02-30T20:00:00Z', '2026-10-21 20:00', 'yesterday', 20]) {
      expect(() => validatePageAnswer(v(3, [{ shape: 'figures', figures: [{ label: 'x', value: '1', observedAt }] }]))).toThrowError(/time/);
    }
  });
});

describe('the table shape, page data version 2 (KI7MT, 2026-10-20)', () => {
  const table = { shape: 'table', columns: ['Band', 'Status', 'Comment'], rows: [['20m', 'Good', 'Reliable daytime DX'], ['6m', 'Sporadic', 'Watch for Es']] };
  const v2 = (sections: unknown[]) => ({ ok: true, data: { version: 2, observedAt: AT, sections } });

  it('draws a table under named columns in version 2 data', () => {
    expect(validatePageAnswer(v2([table]))).toEqual(v2([table]));
  });

  it('still draws version 1 data, and refuses a table in it rather than guessing', () => {
    expect(validatePageAnswer({ ok: true, data: { version: 1, observedAt: AT, sections: [{ shape: 'alert', level: 'info', text: 'Quiet' }] } }).ok).toBe(true);
    expect(() => validatePageAnswer({ ok: true, data: { version: 1, observedAt: AT, sections: [table] } })).toThrowError(/version 1 does not have/);
  });

  it.each([
    [{ ...table, rows: [['20m', 'Good']] }, /does not have 3 cells/],
    [{ ...table, columns: [] }, /no columns/],
    [{ ...table, columns: Array.from({ length: 15 }, (_, i) => `c${i}`), rows: [] }, /more than 14/],
    [{ ...table, rows: Array.from({ length: 501 }, () => ['a', 'b', 'c']) }, /at most 500/],
    [{ ...table, rows: [['20m', 'Good', 'x'.repeat(1001)]] }, /cell 3/],
    [{ ...table, rows: [['20m', 'Good', '<b>x</b>']] }, /./],
    [{ ...table, html: 'x' }, /./]
  ])('refuses an off-shape table (%#)', (value, message) => {
    expect(() => validatePageAnswer(v2([value]))).toThrowError(message);
  });
});

describe('a section\'s heading, page data version 4 (KI7MT, 2026-10-22)', () => {
  const headed = { shape: 'table', heading: 'Sun', columns: ['Event', 'UTC'], rows: [['Sunrise', '12:03']] };
  const v = (version: number, sections: unknown[]) => ({ ok: true, data: { version, observedAt: AT, sections } });

  it('carries a heading on a section in version 4 data', () => {
    expect(validatePageAnswer(v(4, [headed]))).toEqual(v(4, [headed]));
  });

  it('refuses a heading in older data, one with markup, and one too long', () => {
    expect(() => validatePageAnswer(v(3, [headed]))).toThrowError(/version 3 does not have/);
    expect(() => validatePageAnswer(v(4, [{ ...headed, heading: '<b>Sun</b>' }]))).toThrowError(/markup/);
    expect(() => validatePageAnswer(v(4, [{ ...headed, heading: 'x'.repeat(61) }]))).toThrowError(/heading/);
  });
});

describe('a table in groups, and a value across its columns, page data version 5 (Watson and KI7MT, 2026-10-22)', () => {
  const columns = ['Event', 'UTC', 'Your clock'];
  const grouped = { shape: 'table', columns, groups: [
    { heading: 'Sun', rows: [['Sunrise', '13:55', '07:55'], ['Length of day', '10 h 42 min']] },
    { heading: 'Moon', rows: [['Distance', '384,465 km']] }
  ] };
  const v = (version: number, sections: unknown[]) => ({ ok: true, data: { version, observedAt: AT, sections } });

  it('carries groups, and a two-cell row across a wider table, in version 5 data', () => {
    expect(validatePageAnswer(v(5, [grouped]))).toEqual(v(5, [grouped]));
  });

  it('refuses either in older data rather than guessing', () => {
    expect(() => validatePageAnswer(v(4, [grouped]))).toThrowError(/version 4 does not have/);
    const spanning = { shape: 'table', columns, rows: [['Length of day', '10 h 42 min']] };
    expect(() => validatePageAnswer(v(4, [spanning]))).toThrowError(/does not have 3 cells/);
    expect(validatePageAnswer(v(5, [spanning]))).toEqual(v(5, [spanning]));
  });

  it.each([
    [{ ...grouped, rows: [] }, /a field pages do not have: "rows"/],
    [{ ...grouped, groups: [] }, /no groups/],
    [{ ...grouped, groups: Array.from({ length: 41 }, () => ({ heading: 'x', rows: [] })) }, /more than 40/],
    [{ ...grouped, groups: [{ heading: 'Sun', rows: [['Sunrise']] }] }, /does not have 3 cells/],
    [{ ...grouped, groups: [{ heading: '<b>Sun</b>', rows: [] }] }, /markup/],
    [{ ...grouped, groups: [{ heading: 'Sun', rows: [], note: 'x' }] }, /"note"/],
    [{ ...grouped, groups: [{ rows: [] }] }, /heading/],
    // The bound on rows is the table's, across its groups.
    [{ ...grouped, groups: [0, 1].map(() => ({ heading: 'x', rows: Array.from({ length: 251 }, () => ['a', 'b']) })) }, /at most 500/]
  ])('refuses an off-shape grouped table (%#)', (value, message) => {
    expect(() => validatePageAnswer(v(5, [value]))).toThrowError(message);
  });
});

describe('the map, page data version 6 (KI7MT, 2026-10-22)', () => {
  const map = { shape: 'map', sun: { latitude: -11.4, longitude: -158.2 }, marks: [{ label: 'Home', latitude: 43.6, longitude: -116.2 }, { label: 'IO91', latitude: 51.5, longitude: -1 }] };
  const v = (version: number, sections: unknown[]) => ({ ok: true, data: { version, observedAt: AT, sections } });

  it('carries where the sun is overhead and the places marked, in version 6 data', () => {
    expect(validatePageAnswer(v(6, [map]))).toEqual(v(6, [map]));
    expect(validatePageAnswer(v(6, [{ ...map, marks: [] }]))).toEqual(v(6, [{ ...map, marks: [] }]));
  });

  it('carries the moon and a twilight band when the extension gives them', () => {
    const full = { shape: 'map', sun: map.sun, moon: { latitude: 18.2, longitude: 40.1 }, twilight: -10.1, marks: map.marks };
    expect(validatePageAnswer(v(6, [full]))).toEqual(v(6, [full]));
  });

  it('refuses a map in older data rather than guessing', () => {
    expect(() => validatePageAnswer(v(5, [map]))).toThrowError(/version 5 does not have/);
  });

  it.each([
    [{ ...map, sun: { latitude: 91, longitude: 0 } }, /latitude from −90 to 90/],
    [{ ...map, sun: { latitude: 0, longitude: 180.5 } }, /longitude from −180 to 180/],
    [{ ...map, sun: { latitude: Number.NaN, longitude: 0 } }, /latitude/],
    [{ ...map, sun: { latitude: '10', longitude: 0 } }, /latitude/],
    [{ ...map, sun: { latitude: 0, longitude: 0, image: 'x' } }, /"image"/],
    [{ ...map, sun: undefined }, /not a place/],
    [{ ...map, marks: Array.from({ length: 5 }, () => ({ label: 'x', latitude: 0, longitude: 0 })) }, /at most 4/],
    [{ ...map, marks: [{ label: '<b>Home</b>', latitude: 0, longitude: 0 }] }, /markup/],
    [{ ...map, marks: [{ label: 'Home', latitude: 0, longitude: 0, colour: 'red' }] }, /"colour"/],
    [{ ...map, marks: [{ latitude: 0, longitude: 0 }] }, /label/],
    [{ ...map, svg: '<path/>' }, /"svg"/],
    [{ ...map, moon: { latitude: 0, longitude: 200 } }, /moon.*longitude|longitude/],
    [{ ...map, moon: { latitude: 0, longitude: 0, phase: 1 } }, /"phase"/],
    [{ ...map, twilight: 0 }, /twilight/],
    [{ ...map, twilight: 5 }, /twilight/],
    [{ ...map, twilight: -19 }, /twilight/],
    [{ ...map, twilight: '-6' }, /twilight/]
  ])('refuses an off-shape map (%#)', (value, message) => {
    expect(() => validatePageAnswer(v(6, [value]))).toThrowError(message);
  });
});

describe('a table\'s filters, page data version 6 (KI7MT, 2026-10-23)', () => {
  const table = { shape: 'table', columns: ['Activator', 'Band', 'Mode'], rows: [['KI7MT', '20m', 'CW'], ['N0CALL', '40m', 'SSB']] };
  const v = (version: number, sections: unknown[]) => ({ ok: true, data: { version, observedAt: AT, sections } });
  const filters = [{ column: 1, label: 'Band', options: ['40m', '20m'] }, { column: 2, label: 'Mode' }];

  it('carries up to three filters, each naming a column, with options or without', () => {
    expect(validatePageAnswer(v(6, [{ ...table, filters }]))).toEqual(v(6, [{ ...table, filters }]));
  });

  it('refuses filters in older data rather than guessing', () => {
    expect(() => validatePageAnswer(v(5, [{ ...table, filters }]))).toThrowError(/version 5 does not have/);
  });

  it('carries sortable: true, and nothing else for it', () => {
    expect(validatePageAnswer(v(6, [{ ...table, sortable: true }]))).toEqual(v(6, [{ ...table, sortable: true }]));
    expect(() => validatePageAnswer(v(6, [{ ...table, sortable: false }]))).toThrowError(/not true/);
    expect(() => validatePageAnswer(v(6, [{ ...table, sortable: 'yes' }]))).toThrowError(/not true/);
    expect(() => validatePageAnswer(v(5, [{ ...table, sortable: true }]))).toThrowError(/version 5 does not have/);
  });

  it('hides its last columns for filters alone, and refuses what would hide too much (KI7MT, 2026-10-23)', () => {
    const wide = { shape: 'table', columns: ['Call', 'Band', 'Program'], rows: [['W1AW', '20m', 'United States of America']] };
    const hidden = { ...wide, hidden: 1, filters: [{ column: 2, label: 'Program' }] };
    expect(validatePageAnswer(v(6, [hidden]))).toEqual(v(6, [hidden]));
    for (const [section, message] of [
      [{ ...wide, hidden: 1 }, /no filter names/],
      [{ ...wide, hidden: 1, filters: [{ column: 1, label: 'Band' }] }, /no filter names/],
      [{ ...wide, hidden: 3, filters: [{ column: 2, label: 'Program' }] }, /leaving one drawn/],
      [{ ...wide, hidden: 0 }, /leaving one drawn/],
      [{ ...wide, hidden: '1', filters: [{ column: 2, label: 'Program' }] }, /leaving one drawn/],
      [{ ...hidden, sortable: true, sortedBy: { column: 2, direction: 'ascending' } }, /does not draw/],
      [{ shape: 'table', columns: Array.from({ length: 13 }, (_, i) => `c${i}`), rows: [] }, /draws more than 12/]
    ] as const) {
      expect(() => validatePageAnswer(v(6, [section])), String(message)).toThrowError(message);
    }
    expect(() => validatePageAnswer(v(5, [hidden]))).toThrowError(/version 5/);
  });

  it('links a column of references to their pages, by kind only, never a URL (#59)', () => {
    const parks = { shape: 'table', columns: ['Park', 'Name'], rows: [['US-0001', 'Acadia']] };
    expect(validatePageAnswer(v(6, [{ ...parks, links: [{ column: 0, kind: 'pota' }] }]))).toEqual(v(6, [{ ...parks, links: [{ column: 0, kind: 'pota' }] }]));
    for (const [links, message] of [
      [[], /no links/],
      [[{ column: 0, kind: 'https://evil.example/' }], /pota or sota/],
      [[{ column: 0, kind: 'pota', url: 'https://x' }], /"url"/],
      [[{ column: 2, kind: 'pota' }], /does not name a column/],
      [[{ column: 0, kind: 'pota' }, { column: 0, kind: 'sota' }], /one column twice/]
    ] as const) {
      expect(() => validatePageAnswer(v(6, [{ ...parks, links }])), String(message)).toThrowError(message);
    }
    // Not a hidden column: a link must be drawn to be followed.
    const hidden = { shape: 'table', columns: ['Park', 'Entity'], rows: [['US-0001', 'CONUS']], hidden: 1, filters: [{ column: 1, label: 'Entity' }] };
    expect(() => validatePageAnswer(v(6, [{ ...hidden, links: [{ column: 1, kind: 'pota' }] }]))).toThrowError(/does not name a column the table draws/);
    expect(() => validatePageAnswer(v(5, [{ ...parks, links: [{ column: 0, kind: 'pota' }] }]))).toThrowError(/version 5/);
  });

  it('carries up-to choices for a column of numbers (KI7MT, 2026-10-23)', () => {
    const within = { ...table, filters: [{ column: 1, label: 'Distance', upTo: [{ label: 'Within 50 km', value: 50 }], start: 'Within 50 km' }] };
    expect(validatePageAnswer(v(6, [within]))).toEqual(v(6, [within]));
  });

  it('carries the order the rows were sent in, for a sortable table only', () => {
    const sent = { ...table, sortable: true, sortedBy: { column: 1, direction: 'descending' } };
    expect(validatePageAnswer(v(6, [sent]))).toEqual(v(6, [sent]));
    expect(() => validatePageAnswer(v(6, [{ ...table, sortedBy: { column: 1, direction: 'descending' } }]))).toThrowError(/not sortable/);
    for (const sortedBy of [{ column: 3, direction: 'descending' }, { column: 1, direction: 'down' }, { column: 1 }, { column: 1, direction: 'ascending', x: 1 }]) {
      expect(() => validatePageAnswer(v(6, [{ ...table, sortable: true, sortedBy }])), JSON.stringify(sortedBy)).toThrowError(/sortedBy/);
    }
  });

  it.each([
    [[], /no filters/],
    [Array.from({ length: 7 }, (_, column) => ({ column, label: 'x' })), /more than 6/],
    [[{ column: 3, label: 'Band' }], /columns/],
    [[{ column: 1.5, label: 'Band' }], /columns/],
    [[{ column: -1, label: 'Band' }], /columns/],
    [[{ column: 1, label: 'Band' }, { column: 1, label: 'Again' }], /one column twice/],
    [[{ column: 1, label: '<b>Band</b>' }], /markup/],
    [[{ column: 1, label: 'Band', options: [] }], /no options/],
    [[{ column: 1, label: 'Band', options: ['20m', '20m'] }], /same option twice/],
    [[{ column: 1, label: 'Band', options: Array.from({ length: 101 }, (_, i) => `b${i}`) }], /more than 100/],
    [[{ column: 1, label: 'Band', default: '20m' }], /"default"/],
    [[{ column: 1, label: 'Band', multiple: false }], /multiple is not true/],
    [[{ column: 1, label: 'Band', start: 'Nowhere' }], /does not offer/],
    [[{ column: 1, label: 'Band', options: ['20m'], start: '40m' }], /does not offer/],
    [[{ column: 1, label: 'Band', named: [] }], /no named choices/],
    [[{ column: 1, label: 'Band', named: [{ label: 'Mine', values: [] }] }], /no values/],
    [[{ column: 1, label: 'Band', named: [{ label: '<b>', values: ['20m'] }] }], /markup/],
    [[{ column: 1, label: 'km', upTo: [] }], /no up-to choices/],
    [[{ column: 1, label: 'km', upTo: [{ label: 'Within 5', value: 5 }], options: ['5'] }], /beside options/],
    [[{ column: 1, label: 'km', upTo: [{ label: 'Within 5', value: 5 }], named: [{ label: 'x', values: ['5'] }] }], /beside options/],
    [[{ column: 1, label: 'km', upTo: [{ label: 'Within 5', value: '5' }] }], /not a number/],
    [[{ column: 1, label: 'km', upTo: [{ label: 'Within 5', value: Infinity }] }], /not a number/],
    [[{ column: 1, label: 'km', upTo: [{ label: 'Within 5', value: 5 }, { label: 'Within 5', value: 6 }] }], /twice/],
    [[{ column: 1, label: 'km', upTo: [{ label: 'Within 5', value: 5, x: 1 }] }], /"x"/],
    [[{ column: 1, label: 'km', upTo: [{ label: 'Within 5', value: 5 }], start: 'Within 9' }], /does not offer/],
    [[{ column: 3, label: 'km', upTo: [{ label: 'Within 5', value: 5 }] }], /columns/]
  ])('refuses an off-shape filter (%#)', (value, message) => {
    expect(() => validatePageAnswer(v(6, [{ ...table, filters: value }]))).toThrowError(message);
  });
});

describe('where a page\'s fields go, page data version 6 (KI7MT, 2026-10-23)', () => {
  const v = (version: number, sections: unknown[]) => ({ ok: true, data: { version, observedAt: AT, sections } });
  const note = { shape: 'alert', level: 'info', text: 'x' };
  it('places them once, in version 6 data, and nowhere else', () => {
    expect(validatePageAnswer(v(6, [note, { shape: 'fields' }, note]))).toEqual(v(6, [note, { shape: 'fields' }, note]));
    expect(() => validatePageAnswer(v(5, [{ shape: 'fields' }]))).toThrowError(/version 5 does not have/);
    expect(() => validatePageAnswer(v(6, [{ shape: 'fields' }, { shape: 'fields' }]))).toThrowError(/more than once/);
    expect(() => validatePageAnswer(v(6, [{ shape: 'fields', inputs: [] }]))).toThrowError(/"inputs"/);
  });
});

describe('a heading left out of the page\'s contents, page data version 6 (KI7MT, 2026-10-23)', () => {
  const v = (version: number, sections: unknown[]) => ({ ok: true, data: { version, observedAt: AT, sections } });
  const note = { shape: 'alert', level: 'info', text: 'x' };
  it('takes contents: false on a section with a heading, and nothing else', () => {
    expect(validatePageAnswer(v(6, [{ ...note, heading: 'Map', contents: false }]))).toEqual(v(6, [{ ...note, heading: 'Map', contents: false }]));
    expect(() => validatePageAnswer(v(6, [{ ...note, contents: false }]))).toThrowError(/with a heading/);
    expect(() => validatePageAnswer(v(6, [{ ...note, heading: 'Map', contents: true }]))).toThrowError(/not false/);
    expect(() => validatePageAnswer(v(5, [{ ...note, heading: 'Map', contents: false }]))).toThrowError(/version 5 does not have/);
  });
});

describe('plain text, page data version 6 (KI7MT, 2026-10-23)', () => {
  const v = (version: number, sections: unknown[]) => ({ ok: true, data: { version, observedAt: AT, sections } });
  it('carries a sentence with no box, bounded and plain, in version 6 data', () => {
    const note = { shape: 'text', text: 'Times are in UTC.' };
    expect(validatePageAnswer(v(6, [note]))).toEqual(v(6, [note]));
    expect(() => validatePageAnswer(v(5, [note]))).toThrowError(/version 5 does not have/);
    expect(() => validatePageAnswer(v(6, [{ shape: 'text', text: '<b>x</b>' }]))).toThrowError(/markup/);
    expect(() => validatePageAnswer(v(6, [{ shape: 'text', text: 'x'.repeat(201) }]))).toThrowError(/text/);
    expect(() => validatePageAnswer(v(6, [{ shape: 'text', text: 'x', level: 'info' }]))).toThrowError(/"level"/);
  });
});

describe('P13-views: a page in views (QGD-HOM-0016)', () => {
  const VIEWS = [{ id: 'all', label: 'All' }, { id: 'source-0', label: 'WSJT-X - IC-7300' }];
  it('names its views and the one it answered, from version 7', () => {
    const data = validatePageAnswer(answer([FIGURES], { version: 7, views: VIEWS, view: 'source-0' }));
    expect(data.ok && data.data.views).toEqual(VIEWS);
    expect(data.ok && data.data.view).toBe('source-0');
  });
  it('refuses views before version 7, one without the other, an answer that is a view it does not name, and a view id off its shape', () => {
    expect(() => validatePageAnswer(answer([FIGURES], { version: 6, views: VIEWS, view: 'all' }))).toThrowError(/version 6 does not have/);
    expect(() => validatePageAnswer(answer([FIGURES], { version: 7, views: VIEWS }))).toThrowError(/without the one it is/);
    expect(() => validatePageAnswer(answer([FIGURES], { version: 7, view: 'all' }))).toThrowError(/without the one it is/);
    expect(() => validatePageAnswer(answer([FIGURES], { version: 7, views: VIEWS, view: 'source-9' }))).toThrowError(/does not name/);
    expect(() => validatePageAnswer(answer([FIGURES], { version: 7, views: [{ id: 'All Of It', label: 'All' }], view: 'All Of It' }))).toThrowError(/no well-formed, unique id/);
    expect(() => validatePageAnswer(answer([FIGURES], { version: 7, views: [VIEWS[0], VIEWS[0]], view: 'all' }))).toThrowError(/no well-formed, unique id/);
    expect(() => validatePageAnswer(answer([FIGURES], { version: 7, views: [{ id: 'x', label: '<b>' }], view: 'x' }))).toThrowError(/markup/);
    expect(() => validatePageAnswer(answer([FIGURES], { version: 7, views: Array.from({ length: 13 }, (_, n) => ({ id: `v${n}`, label: 'V' })), view: 'v0' }))).toThrowError(/more than 12/);
  });
});
