// SPDX-License-Identifier: GPL-3.0-only
// Home in the window: the pins as tiles, what the open page's view means on
// screen, and that nothing off the contract is kept (QGD-HOM-0002,
// QGD-HOM-0006, QGD-SEC-0006).
import { describe, expect, it } from 'vitest';
import { createHomeStore, shownOf, type HomeApi } from '../packages/renderer/home-store.js';

const AT = '2026-10-11T18:00:00Z';
const SECTIONS = [{ shape: 'alert', level: 'info', text: 'Quiet' }] as const;
const STATE = {
  available: [
    { key: 'air/conditions', name: 'Conditions', description: 'Solar.', extensionName: 'On the Air', icon: 'sun', rail: false, inputs: [], network: true },
    { key: 'air/astro', name: 'Astro', description: 'Sun and moon.', extensionName: 'Astro', icon: 'moon', rail: true, inputs: [], network: false }
  ],
  pins: ['air/conditions', 'gone/page'], pages: [], notice: null, reached: null
};

function api() {
  const sent: unknown[] = [];
  let push: (page: unknown) => void = () => {};
  const value: HomeApi = {
    request: async command => { sent.push(command); return { ok: true, state: STATE }; },
    onPage: listener => { push = listener; return () => {}; }
  };
  return { value, sent, push: (page: unknown) => push(page) };
}
const flush = () => new Promise(settle => setTimeout(settle, 0));

describe('home-store (QGD-HOM-0002, QGD-HOM-0006)', () => {
  it('shows a ready answer, an answer with nothing to show, a failure and waiting', () => {
    expect(shownOf({ key: 'a-a/b-b', state: 'ready', fetchedAt: AT, answer: { ok: true, data: { version: 1, observedAt: AT, sections: [...SECTIONS] } } }))
      .toEqual({ state: 'ready', observedAt: AT, sections: SECTIONS });
    expect(shownOf({ key: 'a-a/b-b', state: 'ready', fetchedAt: AT, answer: { ok: false, reason: 'Nothing yet.' } })).toEqual({ state: 'failed', reason: 'Nothing yet.' });
    expect(shownOf({ key: 'a-a/b-b', state: 'failed', reason: 'Down.' })).toEqual({ state: 'failed', reason: 'Down.' });
    expect(shownOf({ key: 'a-a/b-b', state: 'waiting' })).toEqual({ state: 'waiting' });
  });

  it('draws the pins as tiles in pin order from the manifests alone, skipping a pin no extension offers', async () => {
    const { value } = api();
    const store = createHomeStore(value);
    store.start();
    await flush();
    expect(store.get().tiles).toEqual([{ key: 'air/conditions', name: 'Conditions', description: 'Solar.', icon: 'sun' }]);
    expect(store.get().railPages.map(page => page.key)).toEqual(['air/astro']);
    expect(store.get().page).toBeNull();
  });

  it('shows the open page, waiting until its answer is pushed', async () => {
    const { value, push } = api();
    const store = createHomeStore(value);
    store.start();
    await flush();
    store.openPage('air/conditions');
    expect(store.get().page).toEqual({ key: 'air/conditions', name: 'Conditions', shown: { state: 'waiting' }, network: true, inputs: [], values: {} });
    push({ key: 'air/conditions', state: 'failed', reason: 'NOAA did not answer.' });
    expect(store.get().page?.shown).toEqual({ state: 'failed', reason: 'NOAA did not answer.' });
  });

  it('ignores a pushed page that is off the contract', async () => {
    const { value, push } = api();
    const store = createHomeStore(value);
    store.start();
    await flush();
    store.openPage('air/conditions');
    push({ key: 'air/conditions', state: 'failed', reason: '<img src=x onerror=1>' });
    push({ key: 'air/conditions', state: 'ready', fetchedAt: AT, answer: { ok: true, data: { version: 1, observedAt: AT, sections: [{ shape: 'html', html: 'x' }] } } });
    expect(store.get().page?.shown).toEqual({ state: 'waiting' });
  });

  it('says which page is open only when it changes, and sends the pins as given', async () => {
    const { value, sent } = api();
    const store = createHomeStore(value);
    store.openPage('air/conditions'); store.openPage('air/conditions'); store.openPage(null);
    store.savePins(['air/conditions']);
    await flush();
    expect(sent).toEqual([{ type: 'open', key: 'air/conditions' }, { type: 'open', key: null }, { type: 'pin', pins: ['air/conditions'] }]);
  });

  it('never lets a snapshot read before a push replace the pushed page', async () => {
    let answer: (value: unknown) => void = () => {};
    let push: (page: unknown) => void = () => {};
    const store = createHomeStore({
      request: () => new Promise(settle => { answer = settle; }),
      onPage: listener => { push = listener; return () => {}; }
    });
    store.start();
    store.openPage('air/conditions');
    push({ key: 'air/conditions', state: 'failed', reason: 'NOAA did not answer.' });
    answer({ ok: true, state: { ...STATE, pages: [{ key: 'air/conditions', state: 'waiting' }] } });
    await flush();
    expect(store.get().page?.shown).toEqual({ state: 'failed', reason: 'NOAA did not answer.' });
  });

  it('reads the state again when asked, so a tile whose extension was turned off goes', async () => {
    let state: unknown = STATE;
    const sent: unknown[] = [];
    const store = createHomeStore({ request: async command => { sent.push(command); return { ok: true, state }; }, onPage: () => () => {} });
    store.start();
    await flush();
    expect(store.get().tiles).toHaveLength(1);
    state = { ...STATE, available: [] };
    store.refresh();
    await flush();
    expect(store.get().tiles).toEqual([]);
    expect(sent).toEqual([{ type: 'read' }, { type: 'read' }]);
  });

  it('puts the date in front of a time that is not today, in UTC', async () => {
    const { utc } = await import('../packages/ui/page-shapes.js');
    const now = Date.parse('2026-10-11T20:00:00Z');
    expect(utc('2026-10-11T18:00:00Z', now)).toBe('18:00 UTC');
    expect(utc('2026-10-10T18:00:00Z', now)).toBe('10 Oct 18:00 UTC');
    expect(utc('not a time', now)).toBe('');
  });
});
