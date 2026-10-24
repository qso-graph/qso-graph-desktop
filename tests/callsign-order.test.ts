// SPDX-License-Identifier: GPL-3.0-only
// #70: the Callsigns page lists the active callsign first, then those in use,
// then those whose end date has passed, each group by call.
import { describe, expect, it } from 'vitest';
import { callsignDates, isExpired, orderCallsigns } from '../packages/renderer/callsign-order.js';

const today = '2026-10-24';
const list = [
  { id: 'c', call: 'KI7MT' },
  { id: 'a', call: 'AB1CD', end: '2001-01-01' },
  { id: 'b', call: 'N7XYZ', end: '2030-01-01' },
  { id: 'd', call: 'K7OLD', end: '2026-10-23' },
  { id: 'e', call: 'W1AW', end: '2026-10-24' }
];

describe('the order callsigns are listed in', () => {
  it('puts the active one first, then those in use, then the expired, each by call', () => {
    expect(orderCallsigns(list, 'c', today).map(c => c.call)).toEqual(['KI7MT', 'N7XYZ', 'W1AW', 'AB1CD', 'K7OLD']);
  });

  it('with none active, those in use come first', () => {
    expect(orderCallsigns(list, null, today).map(c => c.call)).toEqual(['KI7MT', 'N7XYZ', 'W1AW', 'AB1CD', 'K7OLD']);
    expect(orderCallsigns(list, 'a', today)[0].call).toBe('AB1CD');
  });

  it('a callsign is in use through its end date', () => {
    expect(isExpired({ id: 'x', call: 'X', end: today }, today)).toBe(false);
    expect(isExpired({ id: 'x', call: 'X', end: '2026-10-23' }, today)).toBe(true);
    expect(isExpired({ id: 'x', call: 'X', end: null }, today)).toBe(false);
  });

  it('says its dates as they were entered', () => {
    expect(callsignDates('2026-01-01', null)).toBe('From 2026-01-01');
    expect(callsignDates('2001-05-01', '2010-12-31')).toBe('2001-05-01 to 2010-12-31');
    expect(callsignDates(null, null)).toBe('');
  });
});
