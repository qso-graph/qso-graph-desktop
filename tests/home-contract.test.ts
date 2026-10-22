// SPDX-License-Identifier: GPL-3.0-only
// Home's channel, checked both ways (QGD-HOM-0002, QGD-HOM-0003, QGD-SEC-0006):
// what the window may ask, and what it accepts as an answer or a pushed page.
import { describe, expect, it } from 'vitest';
import { isPageView, isHomeReply, validateHomeCommand } from '../packages/main/home-contract.js';

const AT = '2026-10-11T18:00:00Z';
const READY = { key: 'on-the-air/conditions', state: 'ready', fetchedAt: AT,
  answer: { ok: true, data: { version: 1, observedAt: AT, sections: [{ shape: 'figures', figures: [{ label: 'SFI', value: '148' }] }] } } };

describe('what the window may ask (QGD-HOM-0003)', () => {
  it('accepts read, the page open or none, and a valid pin list, exactly', () => {
    expect(validateHomeCommand({ type: 'read' })).toBe(true);
    expect(validateHomeCommand({ type: 'open', key: 'on-the-air/conditions' })).toBe(true);
    expect(validateHomeCommand({ type: 'open', key: null })).toBe(true);
    expect(validateHomeCommand({ type: 'pin', pins: ['on-the-air/conditions'] })).toBe(true);
    // Eight pins: two rows of four (KI7MT, 2026-10-22).
    expect(validateHomeCommand({ type: 'pin', pins: Array.from({ length: 8 }, (_, i) => `a-x/c-${i}`) })).toBe(true);
  });

  it('refuses anything else, including a pin list the settings would refuse', () => {
    for (const bad of [
      { type: 'read', extra: 1 }, { type: 'open', key: '../x' }, { type: 'open' }, { type: 'open', key: 7 },
      { type: 'visible', visible: true },
      { type: 'pin', pins: Array.from({ length: 9 }, (_, i) => `a-x/c-${i}`) },
      { type: 'pin', pins: ['dup/page', 'dup/page'] }, { type: 'page', key: 'a/b' }, null, []
    ]) expect(validateHomeCommand(bad), JSON.stringify(bad)).toBe(false);
  });
});

describe('what the window accepts (QGD-HOM-0002)', () => {
  it('accepts each page state, and the whole state', () => {
    expect(isPageView(READY)).toBe(true);
    expect(isPageView({ key: 'on-the-air/conditions', state: 'waiting' })).toBe(true);
    expect(isPageView({ key: 'on-the-air/conditions', state: 'failed', reason: 'NOAA did not answer.' })).toBe(true);
    expect(isHomeReply({ ok: true, state: {
      available: [{ key: 'on-the-air/conditions', name: 'Conditions', description: 'Solar flux.', extensionName: 'On the Air', icon: 'sun', rail: false }],
      pins: ['on-the-air/conditions'], pages: [READY], notice: null } })).toBe(true);
  });

  it('refuses a page whose data is off the shapes, carries markup, or has extra fields', () => {
    expect(isPageView({ ...READY, answer: { ok: true, data: { version: 1, observedAt: AT, sections: [{ shape: 'html', html: 'x' }] } } })).toBe(false);
    expect(isPageView({ key: 'on-the-air/conditions', state: 'failed', reason: '<img onerror=1>' })).toBe(false);
    expect(isPageView({ ...READY, colour: 'red' })).toBe(false);
    expect(isPageView({ key: '../x', state: 'waiting' })).toBe(false);
    expect(isHomeReply({ ok: true, state: { available: [{ key: 'a-b/c-d', name: '<b>', description: 'd', extensionName: 'e', icon: 'sun', rail: false }], pins: [], pages: [], notice: null } })).toBe(false);
    expect(isHomeReply({ ok: true, state: { available: [{ key: 'a-b/c-d', name: 'n', description: 'd', extensionName: 'e', icon: '../x', rail: false }], pins: [], pages: [], notice: null } })).toBe(false);
    // One page open at most, so at most one view.
    expect(isHomeReply({ ok: true, state: { available: [], pins: [], pages: [READY, READY], notice: null } })).toBe(false);
    // Lists with gaps: every() would skip the holes and pass.
    expect(isHomeReply({ ok: true, state: { available: new Array(1), pins: [], pages: [], notice: null } })).toBe(false);
    expect(isHomeReply({ ok: true, state: { available: [], pins: [], pages: new Array(6), notice: null } })).toBe(false);
  });
});
