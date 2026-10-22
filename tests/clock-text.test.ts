// SPDX-License-Identifier: GPL-3.0-only
// The header clock at the edges of a day: does the UTC date roll over with the
// time? (KI7MT, 2026-10-22.) It must, at 00:00:00 UTC, not a second later.
import { describe, expect, it } from 'vitest';
import { clockText } from '../packages/ui/clock-text.js';

describe('the header clock\'s UTC date and time', () => {
  it.each([
    ['the last second of a day', '2026-10-22T23:59:59Z', '2026-10-22', '23:59:59'],
    ['the first second of the next', '2026-10-23T00:00:00Z', '2026-10-23', '00:00:00'],
    ['a month\'s end', '2026-10-31T23:59:59Z', '2026-10-31', '23:59:59'],
    ['the next month', '2026-11-01T00:00:00Z', '2026-11-01', '00:00:00'],
    ['a year\'s end', '2026-12-31T23:59:59Z', '2026-12-31', '23:59:59'],
    ['the next year', '2027-01-01T00:00:00Z', '2027-01-01', '00:00:00'],
    ['a leap day', '2028-02-29T12:00:00Z', '2028-02-29', '12:00:00']
  ])('%s', (_when, instant, date, time) => {
    const shown = clockText(new Date(instant));
    expect(shown.utcDate).toBe(date);
    expect(shown.utcTime).toBe(time);
  });

  it('takes date and time from the same instant, so one never runs ahead of the other', () => {
    const a = clockText(new Date('2026-10-22T23:59:59.999Z'));
    expect(`${a.utcDate} ${a.utcTime}`).toBe('2026-10-22 23:59:59');
    const b = clockText(new Date('2026-10-23T00:00:00.000Z'));
    expect(`${b.utcDate} ${b.utcTime}`).toBe('2026-10-23 00:00:00');
  });

  it('shows the local time in the computer\'s own zone', () => {
    const at = new Date('2026-10-22T09:01:41Z');
    const two = (value: number) => String(value).padStart(2, '0');
    expect(clockText(at).localTime).toBe(`${two(at.getHours())}:${two(at.getMinutes())}:${two(at.getSeconds())}`);
  });
});
