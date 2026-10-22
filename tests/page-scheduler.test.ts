// SPDX-License-Identifier: GPL-3.0-only
// P8-fetch and P8-failure: the broker decides when each page is asked for
// (QGD-HOM-0005), and one page failing leaves the others alone (QGD-HOM-0006).
// Time is the test's: fake timers, and `now` read from the same fake clock.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageAnswer } from '../packages/extension-api/pages.js';
import { createPageScheduler, type PageView, type CataloguePage } from '../packages/main/page-scheduler.js';
import type { PageOutcome } from '../packages/main/extension-host-supervisor.js';

const AT = '2026-10-11T18:00:00Z';
const answer = (text: string): PageAnswer => ({ ok: true, data: { version: 1, observedAt: AT, sections: [{ shape: 'alert', level: 'info', text }] } });
const CARDS: CataloguePage[] = [
  { key: 'air/conditions', extension: 'air', extensionName: 'On the Air', page: 'conditions', name: 'Conditions', description: 'Solar.', refreshSeconds: 900, icon: 'sun', rail: false, inputs: [] },
  { key: 'air/station', extension: 'air', extensionName: 'On the Air', page: 'station', name: 'Your station', description: 'Time.', refreshSeconds: 60, icon: 'extension', rail: false, inputs: [] },
  { key: 'air/spare', extension: 'air', extensionName: 'On the Air', page: 'spare', name: 'Spare', description: 'Unpinned.', refreshSeconds: 60, icon: 'extension', rail: false, inputs: [] }
];

function harness(options: { pins?: string[]; respond?: (page: string, signal: AbortSignal) => Promise<PageOutcome> } = {}) {
  let pins = options.pins ?? ['air/conditions', 'air/station'];
  const asked: string[] = [];
  const published: PageView[] = [];
  const scheduler = createPageScheduler({
    catalogue: () => CARDS,
    pins: () => pins,
    page: (_extension, page, signal) => {
      asked.push(page);
      return options.respond ? options.respond(page, signal) : Promise.resolve({ outcome: 'completed', answer: answer(page) });
    },
    publish: view => published.push(view),
    now: () => Date.now()
  });
  return { scheduler, asked, published, setPins: (next: string[]) => { pins = next; scheduler.changed(); } };
}
const flush = async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); };

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(AT)); });
afterEach(() => { vi.useRealTimers(); });

describe('P8-fetch: only pinned pages, only while Home shows, never sooner than their interval (QGD-HOM-0005)', () => {
  it('asks for nothing while Home is not showing', async () => {
    const { asked } = harness();
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(asked).toEqual([]);
  });

  it('asks for each pinned page once when Home shows, and never for an unpinned one', async () => {
    const { scheduler, asked, published } = harness();
    scheduler.setVisible(true);
    await flush();
    expect(asked.sort()).toEqual(['conditions', 'station']);
    expect(published.filter(view => view.state === 'ready').map(view => view.key).sort()).toEqual(['air/conditions', 'air/station']);
    expect(asked).not.toContain('spare');
    scheduler.stop();
  });

  it('refreshes each page at its own interval and no sooner', async () => {
    const { scheduler, asked } = harness();
    scheduler.setVisible(true);
    await flush();
    await vi.advanceTimersByTimeAsync(59_000);
    expect(asked.filter(page => page === 'station')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(asked.filter(page => page === 'station')).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(899_000 - 60_000);
    expect(asked.filter(page => page === 'conditions')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(asked.filter(page => page === 'conditions')).toHaveLength(2);
    scheduler.stop();
  });

  it('stops asking while Home is hidden, and does not ask early when it shows again', async () => {
    const { scheduler, asked } = harness({ pins: ['air/conditions'] });
    scheduler.setVisible(true);
    await flush();
    scheduler.setVisible(false);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(asked).toHaveLength(1);
    scheduler.setVisible(true); // ten minutes after the last answer: not yet due
    await flush();
    expect(asked).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(asked).toHaveLength(2);
    scheduler.stop();
  });

  it('cancels a page in flight when Home is left or the page is unpinned', async () => {
    const aborted: string[] = [];
    const { scheduler, setPins } = harness({
      respond: (page, signal) => new Promise(settle => { signal.addEventListener('abort', () => { aborted.push(page); settle({ outcome: 'cancelled' }); }); })
    });
    scheduler.setVisible(true);
    await flush();
    setPins(['air/station']);
    expect(aborted).toEqual(['conditions']);
    scheduler.setVisible(false);
    expect(aborted).toEqual(['conditions', 'station']);
    scheduler.stop();
  });

  it('starts asking for a page as soon as it is pinned, if Home is showing', async () => {
    const { scheduler, asked, setPins } = harness({ pins: ['air/station'] });
    scheduler.setVisible(true);
    await flush();
    setPins(['air/station', 'air/spare']);
    await flush();
    expect(asked).toContain('spare');
    scheduler.stop();
  });

  it('drops what was shown and asked for the old callsign, and asks again for the new one', async () => {
    let finish: (outcome: PageOutcome) => void = () => {};
    let calls = 0;
    const { scheduler, published, asked } = harness({
      pins: ['air/station'],
      respond: () => { calls++; return calls === 1 ? new Promise(settle => { finish = settle; }) : Promise.resolve({ outcome: 'completed', answer: answer('new callsign') }); }
    });
    scheduler.setVisible(true);
    await flush();
    scheduler.callsignsChanged();
    await flush();
    finish({ outcome: 'completed', answer: answer('old callsign') });
    await flush();
    expect(JSON.stringify(published)).not.toContain('old callsign');
    // Asked again as soon as the old question settled, not after the
    // interval: a page must not sit on "Getting the latest…" for fifteen
    // minutes because a callsign was made.
    expect(asked).toHaveLength(2);
    expect(JSON.stringify(scheduler.views())).toContain('new callsign');
    scheduler.stop();
  });

  it('asks again after a callsign change only when Home shows, and once', async () => {
    const { scheduler, asked } = harness({ pins: ['air/conditions'] });
    scheduler.setVisible(true);
    await flush();
    expect(asked).toEqual(['conditions']);
    scheduler.setVisible(false);
    scheduler.callsignsChanged();
    scheduler.callsignsChanged();
    await flush();
    expect(asked).toHaveLength(1);
    scheduler.setVisible(true);
    await flush();
    expect(asked).toHaveLength(2);
    // And the interval holds again from there.
    scheduler.setVisible(false);
    scheduler.setVisible(true);
    await flush();
    expect(asked).toHaveLength(2);
    scheduler.stop();
  });

  it('shows pins in pin order, and skips a pin no extension offers without forgetting it', () => {
    const { scheduler } = harness({ pins: ['air/station', 'gone/page', 'air/conditions'] });
    expect(scheduler.shown().map(page => page.key)).toEqual(['air/station', 'air/conditions']);
    expect(scheduler.views()).toEqual([{ key: 'air/station', state: 'waiting' }, { key: 'air/conditions', state: 'waiting' }]);
  });
});

describe('P8-failure: a failing page fails alone (QGD-HOM-0006)', () => {
  it('shows one page\'s failure in words while the others draw normally', async () => {
    const { scheduler, published } = harness({
      respond: page => Promise.resolve(page === 'conditions'
        ? { outcome: 'unknown', reason: 'The extension did not answer in time.' }
        : { outcome: 'completed', answer: answer('fine') })
    });
    scheduler.setVisible(true);
    await flush();
    expect(published).toContainEqual({ key: 'air/conditions', state: 'failed', reason: 'The extension did not answer in time.' });
    expect(published.filter(view => view.key === 'air/station').at(-1)).toMatchObject({ state: 'ready' });
    scheduler.stop();
  });

  it('tries a failed page again at its interval', async () => {
    let calls = 0;
    const { scheduler, asked } = harness({
      pins: ['air/station'],
      respond: () => { calls++; return Promise.resolve(calls === 1 ? { outcome: 'unknown', reason: 'down' } : { outcome: 'completed', answer: answer('back') }); }
    });
    scheduler.setVisible(true);
    await flush();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(asked).toHaveLength(2);
    expect(scheduler.views()[0]).toMatchObject({ state: 'ready' });
    scheduler.stop();
  });
});

describe('review findings, each held by a test (S3)', () => {
  it('never has two questions for one page in flight, and drops an answer to one asked before Home was hidden', async () => {
    const pending: ((outcome: PageOutcome) => void)[] = [];
    const { scheduler, asked, published } = harness({
      pins: ['air/station'],
      // An extension that ignores cancellation and answers anyway.
      respond: () => new Promise(settle => { pending.push(settle); })
    });
    scheduler.setVisible(true); await flush();
    scheduler.setVisible(false); scheduler.setVisible(true); await flush();
    expect(asked).toHaveLength(1);
    pending[0]({ outcome: 'completed', answer: answer('stale') });
    await flush();
    expect(JSON.stringify(published)).not.toContain('stale');
    scheduler.stop();
  });

  it('does not ask a page early because it was unpinned and pinned again', async () => {
    const { scheduler, asked, setPins } = harness({ pins: ['air/station'] });
    scheduler.setVisible(true); await flush();
    setPins([]); setPins(['air/station']); await flush();
    expect(asked).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(asked).toHaveLength(2);
    scheduler.stop();
  });
});

describe('a page\'s fields (inputs.ts, KI7MT 2026-10-22)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('asks with what is in the fields, and asks again at once when they change, not when the interval allows', async () => {
    let inputs: Record<string, string> = {};
    const asked: Record<string, string>[] = [];
    const published: PageView[] = [];
    const scheduler = createPageScheduler({
      catalogue: () => CARDS,
      pins: () => ['air/conditions'],
      page: (_extension, _page, _signal, given) => { asked.push({ ...given }); return Promise.resolve({ outcome: 'completed', answer: answer('x') }); },
      inputs: () => inputs,
      publish: view => published.push(view),
      now: () => Date.now()
    });
    scheduler.setVisible(true);
    for (let i = 0; i < 6; i++) await Promise.resolve();
    inputs = { dx: 'FN31' };
    scheduler.inputsChanged('air/conditions');
    for (let i = 0; i < 6; i++) await Promise.resolve();
    expect(asked).toEqual([{}, { dx: 'FN31' }]);
    // What was shown for the old values was dropped before the new answer.
    expect(published.map(view => view.state)).toContain('waiting');
    scheduler.stop();
  });
});
