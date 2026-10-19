// SPDX-License-Identifier: GPL-3.0-only
// Home's channel, checked both ways (QGD-HOM-0002, QGD-HOM-0003, QGD-SEC-0006):
// what the window may ask, and what it accepts as an answer or a pushed card.
import { describe, expect, it } from 'vitest';
import { isCardView, isHomeReply, validateHomeCommand } from '../packages/main/home-contract.js';

const AT = '2026-10-11T18:00:00Z';
const READY = { key: 'on-the-air/conditions', state: 'ready', fetchedAt: AT,
  answer: { ok: true, data: { version: 1, observedAt: AT, sections: [{ shape: 'figures', figures: [{ label: 'SFI', value: '148' }] }] } } };

describe('what the window may ask (QGD-HOM-0003)', () => {
  it('accepts read, visible and a valid pin list, exactly', () => {
    expect(validateHomeCommand({ type: 'read' })).toBe(true);
    expect(validateHomeCommand({ type: 'visible', visible: false })).toBe(true);
    expect(validateHomeCommand({ type: 'pin', pins: ['on-the-air/conditions'] })).toBe(true);
  });

  it('refuses anything else, including a pin list the settings would refuse', () => {
    for (const bad of [
      { type: 'read', extra: 1 }, { type: 'visible', visible: 'yes' }, { type: 'visible' },
      { type: 'pin', pins: Array.from({ length: 7 }, (_, i) => `a-x/c-${i}`) },
      { type: 'pin', pins: ['dup/card', 'dup/card'] }, { type: 'card', key: 'a/b' }, null, []
    ]) expect(validateHomeCommand(bad), JSON.stringify(bad)).toBe(false);
  });
});

describe('what the window accepts (QGD-HOM-0002)', () => {
  it('accepts each card state, and the whole state', () => {
    expect(isCardView(READY)).toBe(true);
    expect(isCardView({ key: 'on-the-air/conditions', state: 'waiting' })).toBe(true);
    expect(isCardView({ key: 'on-the-air/conditions', state: 'failed', reason: 'NOAA did not answer.' })).toBe(true);
    expect(isHomeReply({ ok: true, state: {
      available: [{ key: 'on-the-air/conditions', name: 'Conditions', description: 'Solar flux.', extensionName: 'On the Air' }],
      pins: ['on-the-air/conditions'], cards: [READY], notice: null } })).toBe(true);
  });

  it('refuses a card whose data is off the shapes, carries markup, or has extra fields', () => {
    expect(isCardView({ ...READY, answer: { ok: true, data: { version: 1, observedAt: AT, sections: [{ shape: 'html', html: 'x' }] } } })).toBe(false);
    expect(isCardView({ key: 'on-the-air/conditions', state: 'failed', reason: '<img onerror=1>' })).toBe(false);
    expect(isCardView({ ...READY, colour: 'red' })).toBe(false);
    expect(isCardView({ key: '../x', state: 'waiting' })).toBe(false);
    expect(isHomeReply({ ok: true, state: { available: [{ key: 'a-b/c-d', name: '<b>', description: 'd', extensionName: 'e' }], pins: [], cards: [], notice: null } })).toBe(false);
    // Lists with gaps: every() would skip the holes and pass.
    expect(isHomeReply({ ok: true, state: { available: new Array(1), pins: [], cards: [], notice: null } })).toBe(false);
    expect(isHomeReply({ ok: true, state: { available: [], pins: [], cards: new Array(6), notice: null } })).toBe(false);
  });
});
