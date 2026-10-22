// SPDX-License-Identifier: GPL-3.0-only
// The header clock at the edges of a day: does the UTC date roll over with the
// time? (KI7MT, 2026-10-22.) It must, at 00:00:00 UTC, not a second later.
import { describe, expect, it } from 'vitest';
import { clockText, sunText } from '../packages/ui/clock-text.js';

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

describe('sunrise and sunset in the header (QGD-FRM-0014)', () => {
  // A day with fixed events, so the test is about what is shown, not about
  // the sun: sun.ts has its own tests against PyEphem.
  const at = (iso: string) => new Date(iso);
  const day = (now: Date) => now < at('2026-10-23T00:00:00Z')
    ? { sunrise: at('2026-10-22T08:09:00Z'), sunset: at('2026-10-22T18:51:00Z') }
    : { sunrise: at('2026-10-23T08:10:00Z'), sunset: at('2026-10-23T18:49:00Z') };
  const local = (iso: string) => { const d = at(iso); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

  it('before sunrise: today\'s sunrise is next', () => {
    expect(sunText(at('2026-10-22T06:00:00Z'), day)).toEqual({ sunrise: local('2026-10-22T08:09:00Z'), sunset: local('2026-10-22T18:51:00Z'), next: 'sunrise' });
  });

  it('in the day: sunset is next, and the order does not change', () => {
    expect(sunText(at('2026-10-22T12:00:00Z'), day)).toEqual({ sunrise: local('2026-10-22T08:09:00Z'), sunset: local('2026-10-22T18:51:00Z'), next: 'sunset' });
  });

  it('after sunset: the sunrise shown is tomorrow\'s, and it is next', () => {
    expect(sunText(at('2026-10-22T20:00:00Z'), day)).toEqual({ sunrise: local('2026-10-23T08:10:00Z'), sunset: local('2026-10-22T18:51:00Z'), next: 'sunrise' });
  });

  it('where the sun does not set or rise, says so', () => {
    expect(sunText(at('2026-06-21T12:00:00Z'), () => ({ allDay: 'up' }))).toEqual({ allDay: 'Sun up all day' });
    expect(sunText(at('2026-12-21T12:00:00Z'), () => ({ allDay: 'down' }))).toEqual({ allDay: 'Sun down all day' });
  });

  it('shows minutes, not seconds', () => {
    const shown = sunText(at('2026-10-22T06:00:00Z'), () => ({ sunrise: at('2026-10-22T08:09:41Z'), sunset: at('2026-10-22T18:51:12Z') }));
    expect(shown.sunrise).toMatch(/^\d\d:\d\d$/);
  });
});
