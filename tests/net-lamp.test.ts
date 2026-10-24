// SPDX-License-Identifier: GPL-3.0-only
// The Internet lamp (QGD-HOM-0005; KI7MT and Watson, 2026-10-23): it never
// looks more certain than what it knows.
import { describe, expect, it } from 'vitest';
import { lampState, lampWords } from '../packages/ui/net-lamp.js';
import { isHomeReply } from '../packages/main/home-contract.js';

describe('the Internet lamp', () => {
  it('is red with no network, whatever the last request found', () => {
    for (const reached of [true, false, null]) expect(lampState(false, reached)).toBe('off');
  });
  it('is yellow on a network whose last request could not connect: the wifi login page', () => {
    expect(lampState(true, false)).toBe('trouble');
  });
  it('is green on a network whose last request got through, or before any is made', () => {
    expect(lampState(true, true)).toBe('on');
    expect(lampState(true, null)).toBe('on');
    expect(lampState(undefined, null)).toBe('on');
  });
  it('says each in words', () => {
    expect(lampWords('off')).toBe('Internet: offline');
    expect(lampWords('trouble')).toMatch(/on a network, but the last request could not get through/);
    expect(lampWords('on')).toBe('Internet: online');
  });
  it('is told only a yes, a no or nothing yet', () => {
    const state = (reached: unknown) => isHomeReply({ ok: true, state: { available: [], pins: [], pages: [], notice: null, reached } });
    expect(state(true) && state(false) && state(null)).toBe(true);
    expect(state('yes')).toBe(false);
    expect(state(undefined)).toBe(false);
  });
});
