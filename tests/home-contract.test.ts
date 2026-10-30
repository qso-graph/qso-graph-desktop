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
    expect(validateHomeCommand({ type: 'open', key: 'astro/astro', inputs: { dx: 'FN31' } })).toBe(true);
    // The shape only: which fields, and what each takes, the broker checks.
    for (const inputs of [{ dx: 7 }, { 'Bad Id': 'x' }, { dx: 'x'.repeat(65) }, ['FN31'], { a1: '', b1: '', c1: '', d1: '', e1: '' }]) {
      expect(validateHomeCommand({ type: 'open', key: 'astro/astro', inputs }), JSON.stringify(inputs)).toBe(false);
    }
    expect(validateHomeCommand({ type: 'pin', pins: ['on-the-air/conditions'] })).toBe(true);
    expect(validateHomeCommand({ type: 'refresh', key: 'on-the-air/parks' })).toBe(true);
    expect(validateHomeCommand({ type: 'connection', online: false })).toBe(true);
    // Eight pins: two rows of four (KI7MT, 2026-10-22).
    expect(validateHomeCommand({ type: 'pin', pins: Array.from({ length: 8 }, (_, i) => `a-x/c-${i}`) })).toBe(true);
  });

  it('refuses anything else, including a pin list the settings would refuse', () => {
    for (const bad of [
      { type: 'read', extra: 1 }, { type: 'open', key: '../x' }, { type: 'open' }, { type: 'open', key: 7 },
      { type: 'visible', visible: true },
      { type: 'connection' }, { type: 'connection', online: 'no' }, { type: 'connection', online: true, url: 'x' },
      { type: 'refresh' }, { type: 'refresh', key: '../x' }, { type: 'refresh', key: 'on-the-air/parks', now: true },
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
      available: [{ key: 'on-the-air/conditions', name: 'Conditions', description: 'Solar flux.', extensionName: 'On the Air', icon: 'sun', rail: false, inputs: [], network: false, area: 'on-the-air/conditions', tab: 'Conditions', hue: 'general', settings: [] }],
      pins: ['on-the-air/conditions'], pages: [READY], notice: null, reached: null } })).toBe(true);
  });

  it('refuses a page whose data is off the shapes, carries markup, or has extra fields', () => {
    expect(isPageView({ ...READY, answer: { ok: true, data: { version: 1, observedAt: AT, sections: [{ shape: 'html', html: 'x' }] } } })).toBe(false);
    expect(isPageView({ key: 'on-the-air/conditions', state: 'failed', reason: '<img onerror=1>' })).toBe(false);
    expect(isPageView({ ...READY, colour: 'red' })).toBe(false);
    expect(isPageView({ key: '../x', state: 'waiting' })).toBe(false);
    // A field's hint is one of the fields an input may have: leaving it out
    // of this check would refuse the whole of Home's state.
    const hinted = (hint: unknown) => isHomeReply({ ok: true, state: { available: [{ key: 'astro/astro', name: 'Astro', description: 'd', extensionName: 'Astro', icon: 'moon', rail: true, network: false, area: 'astro/astro', tab: 'Astro', hue: 'general', settings: [],
      inputs: [{ id: 'dx', label: 'Grey line with', kind: 'grid', hint }] }], pins: [], pages: [], notice: null, reached: null } });
    expect(hinted('A DX station\'s grid, as IO91.')).toBe(true);
    expect(hinted('<b>x</b>')).toBe(false);
    expect(hinted('x'.repeat(81))).toBe(false);
    // Whether a page needs the internet is part of what a page is.
    expect(isHomeReply({ ok: true, state: { available: [{ key: 'a-b/c-d', name: 'n', description: 'd', extensionName: 'e', icon: 'sun', rail: false, inputs: [] }], pins: [], pages: [], notice: null, reached: null } })).toBe(false);
    expect(isHomeReply({ ok: true, state: { available: [{ key: 'a-b/c-d', name: '<b>', description: 'd', extensionName: 'e', icon: 'sun', rail: false, inputs: [], network: false, area: 'a-b/c-d', tab: '<b>', hue: 'general', settings: [] }], pins: [], pages: [], notice: null, reached: null } })).toBe(false);
    expect(isHomeReply({ ok: true, state: { available: [{ key: 'a-b/c-d', name: 'n', description: 'd', extensionName: 'e', icon: '../x', rail: false, inputs: [], network: false, area: 'a-b/c-d', tab: 'n', hue: 'general', settings: [] }], pins: [], pages: [], notice: null, reached: null } })).toBe(false);
    // One page open at most, so at most one view.
    expect(isHomeReply({ ok: true, state: { available: [], pins: [], pages: [READY, READY], notice: null, reached: null } })).toBe(false);
    // Lists with gaps: every() would skip the holes and pass.
    expect(isHomeReply({ ok: true, state: { available: new Array(1), pins: [], pages: [], notice: null, reached: null } })).toBe(false);
    expect(isHomeReply({ ok: true, state: { available: [], pins: [], pages: new Array(6), notice: null, reached: null } })).toBe(false);
  });
});

describe('a page\'s own settings (QGD-HOM-0017)', () => {
  const page = (settings: unknown) => ({ ok: true, state: { available: [{ key: 'monitor/monitor', name: 'Monitor', description: 'd', extensionName: 'Monitor', icon: 'tower-broadcast',
    rail: true, inputs: [], network: false, area: 'monitor/monitor', tab: 'Monitor', hue: 'general', settings }], pins: [], pages: [], notice: null, reached: null } });
  const CYCLES = { id: 'cycles', label: 'Cycles shown', choices: ['10', '20', '40'], value: '20' };
  it('carries each with the choice in force, and refuses one whose choice is not among its own', () => {
    expect(isHomeReply(page([CYCLES]))).toBe(true);
    expect(isHomeReply(page([{ ...CYCLES, hint: 'Newest first.' }]))).toBe(true);
    expect(isHomeReply(page([{ ...CYCLES, value: '7' }]))).toBe(false);
    expect(isHomeReply(page([{ ...CYCLES, label: '<b>' }]))).toBe(false);
    expect(isHomeReply(page([{ ...CYCLES, extra: 1 }]))).toBe(false);
  });
  it('takes a setting from the window by page, id and value, and nothing else', () => {
    expect(validateHomeCommand({ type: 'page-setting', key: 'monitor/monitor', id: 'cycles', value: '40' })).toBe(true);
    expect(validateHomeCommand({ type: 'page-setting', key: 'monitor', id: 'cycles', value: '40' })).toBe(false);
    expect(validateHomeCommand({ type: 'page-setting', key: 'monitor/monitor', id: 'cycles', value: '<40>' })).toBe(false);
    expect(validateHomeCommand({ type: 'page-setting', key: 'monitor/monitor', id: 'cycles', value: '40', extra: true })).toBe(false);
  });
});
