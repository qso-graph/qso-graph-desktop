// SPDX-License-Identifier: GPL-3.0-only
// #70: the Callsigns page lists the active callsign first, then the rest by
// start date, newest first (KI7MT, 2026-10-24).
import { describe, expect, it } from 'vitest';
import { callsignDates, isExpired, orderCallsigns } from '../packages/renderer/callsign-order.js';

const today = '2026-10-24';
const list = [
  { id: 'c', call: 'KI7MT', start: '2015-03-01' },
  { id: 'a', call: 'AB1CD', start: '1995-06-01', end: '2001-01-01' },
  { id: 'b', call: 'N7XYZ', start: '2026-09-01', end: '2026-09-30' },
  { id: 'd', call: 'K7OLD', start: '2001-02-01', end: '2015-02-28' },
  { id: 'e', call: 'W1AW', start: '2015-03-01' },
  { id: 'f', call: 'N0DATE' }
];

describe('the order callsigns are listed in', () => {
  it('puts the active one first, then the rest newest first by start date', () => {
    expect(orderCallsigns(list, 'c').map(c => c.call)).toEqual(['KI7MT', 'N7XYZ', 'W1AW', 'K7OLD', 'AB1CD', 'N0DATE']);
  });

  it('with none active, by start date alone; a tie by call', () => {
    expect(orderCallsigns(list, null).map(c => c.call)).toEqual(['N7XYZ', 'KI7MT', 'W1AW', 'K7OLD', 'AB1CD', 'N0DATE']);
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
