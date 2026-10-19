// SPDX-License-Identifier: GPL-3.0-only
// Home in the window: what each card's view means on screen, and that
// nothing off the contract is kept (QGD-HOM-0002, QGD-HOM-0006, QGD-SEC-0006).
import { describe, expect, it } from 'vitest';
import { createHomeStore, shownOf, type HomeApi } from '../packages/renderer/home-store.js';

const AT = '2026-10-11T18:00:00Z';
const SECTIONS = [{ shape: 'alert', level: 'info', text: 'Quiet' }] as const;
const STATE = {
  available: [{ key: 'air/conditions', name: 'Conditions', description: 'Solar.', extensionName: 'On the Air' }],
  pins: ['air/conditions', 'gone/card'], cards: [], notice: null
};

function api() {
  const sent: unknown[] = [];
  let push: (card: unknown) => void = () => {};
  const value: HomeApi = {
    request: async command => { sent.push(command); return { ok: true, state: STATE }; },
    onCard: listener => { push = listener; return () => {}; }
  };
  return { value, sent, push: (card: unknown) => push(card) };
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

  it('draws pinned cards in pin order, skipping a pin no extension offers, and takes pushed cards', async () => {
    const { value, push } = api();
    const store = createHomeStore(value);
    store.start();
    await flush();
    expect(store.get().cards).toEqual([{ key: 'air/conditions', name: 'Conditions', shown: { state: 'waiting' } }]);
    push({ key: 'air/conditions', state: 'failed', reason: 'NOAA did not answer.' });
    expect(store.get().cards[0].shown).toEqual({ state: 'failed', reason: 'NOAA did not answer.' });
  });

  it('ignores a pushed card that is off the contract', async () => {
    const { value, push } = api();
    const store = createHomeStore(value);
    store.start();
    await flush();
    push({ key: 'air/conditions', state: 'failed', reason: '<img src=x onerror=1>' });
    push({ key: 'air/conditions', state: 'ready', fetchedAt: AT, answer: { ok: true, data: { version: 1, observedAt: AT, sections: [{ shape: 'html', html: 'x' }] } } });
    expect(store.get().cards[0].shown).toEqual({ state: 'waiting' });
  });

  it('says Home is showing only when it changes, and sends the pins as given', async () => {
    const { value, sent } = api();
    const store = createHomeStore(value);
    store.setVisible(true); store.setVisible(true); store.setVisible(false);
    store.savePins(['air/conditions']);
    await flush();
    expect(sent).toEqual([{ type: 'visible', visible: true }, { type: 'visible', visible: false }, { type: 'pin', pins: ['air/conditions'] }]);
  });

  it('never lets a snapshot read before a push replace the pushed card', async () => {
    let answer: (value: unknown) => void = () => {};
    let push: (card: unknown) => void = () => {};
    const store = createHomeStore({
      request: () => new Promise(settle => { answer = settle; }),
      onCard: listener => { push = listener; return () => {}; }
    });
    store.start();
    push({ key: 'air/conditions', state: 'failed', reason: 'NOAA did not answer.' });
    answer({ ok: true, state: { ...STATE, cards: [{ key: 'air/conditions', state: 'waiting' }] } });
    await flush();
    expect(store.get().cards[0].shown).toEqual({ state: 'failed', reason: 'NOAA did not answer.' });
  });

  it('puts the date in front of a time that is not today, in UTC', async () => {
    const { utc } = await import('../packages/ui/home-card.js');
    const now = Date.parse('2026-10-11T20:00:00Z');
    expect(utc('2026-10-11T18:00:00Z', now)).toBe('18:00 UTC');
    expect(utc('2026-10-10T18:00:00Z', now)).toBe('10 Oct 18:00 UTC');
    expect(utc('not a time', now)).toBe('');
  });
});
