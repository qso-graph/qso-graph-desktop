// SPDX-License-Identifier: GPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPageScheduler, type CataloguePage, type PageView } from '../packages/main/page-scheduler.js';
import type { PageOutcome } from '../packages/main/extension-host-supervisor.js';
import { createShellStore } from '../packages/renderer/shell-store.js';
import { createHomeStore } from '../packages/renderer/home-store.js';
import { isHomeReply } from '../packages/main/home-contract.js';

const AT = '2026-11-12T18:00:00.000Z';
const catalogue: CataloguePage[] = ['near', 'spots', 'monitor'].map(page => ({
  key: `test/${page}`, area: page === 'monitor' ? 'test/monitor' : 'test/near',
  extension: 'test', extensionName: 'Test', page, name: 'Same name', description: 'Test page',
  refreshSeconds: 60, icon: 'extension', rail: true, inputs: [], network: false
}));
const outcome: PageOutcome = { outcome: 'completed', answer: { ok: true, data: {
  version: 1, observedAt: AT, sections: [{ shape: 'alert', level: 'info', text: 'Test answer' }]
} } };
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

function harness(delayed = false) {
  const shell = createShellStore();
  let shown: string[] = [];
  const asked: string[] = [];
  const published: PageView[] = [];
  const pending: { signal: AbortSignal; finish: (answer: PageOutcome) => void }[] = [];
  const scheduler = createPageScheduler({
    catalogue: () => catalogue, pins: () => shown, now: () => Date.now(),
    publish: view => published.push(view),
    page: (_extension, page, signal) => {
      asked.push(page);
      return delayed ? new Promise(finish => { pending.push({ signal, finish }); }) : Promise.resolve(outcome);
    }
  });
  scheduler.setVisible(true);
  const unsubscribe = shell.subscribe(state => {
    shown = state.page === 'extension' && state.extensionPage ? [state.extensionPage] : [];
    scheduler.changed();
  });
  return { shell, scheduler, asked, published, pending, stop: () => { unsubscribe(); scheduler.stop(); } };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(AT)); });
afterEach(() => { vi.useRealTimers(); });

describe('P14-shown-page (QGD-HOM-0005)', () => {
  it('asks only the chosen inner page of the shown destination, independently of open tabs', async () => {
    const run = harness();
    await flush();
    expect(run.asked).toEqual([]);
    run.shell.openExtension('test/near', 'test/near');
    await flush();
    run.shell.openExtension('test/spots', 'test/near');
    await flush();
    run.shell.openExtension('test/monitor', 'test/monitor');
    await flush();
    expect(run.shell.get().tabs).toEqual(['home', 'ext:test/near', 'ext:test/monitor']);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(run.asked).toEqual(['near', 'spots', 'monitor', 'monitor', 'monitor']);
    run.stop();
  });

  it('stops refresh on a core destination and resumes the remembered inner page when shown', async () => {
    const run = harness();
    run.shell.openExtension('test/spots', 'test/near');
    await flush();
    run.shell.set({ page: 'callsigns' });
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(180_000);
    expect(run.asked).toEqual(['spots']);
    expect(vi.getTimerCount()).toBe(0);
    run.shell.showTab('ext:test/near');
    await flush();
    expect(run.asked).toEqual(['spots', 'spots']);
    run.stop();
  });

  it('aborts hidden work and discards a reply delivered after switching destinations', async () => {
    const run = harness(true);
    run.shell.openExtension('test/spots', 'test/near');
    run.shell.openExtension('test/monitor', 'test/monitor');
    expect(run.pending[0].signal.aborted).toBe(true);
    run.pending[0].finish(outcome);
    await flush();
    expect(run.published.filter(view => view.key === 'test/spots' && view.state === 'ready')).toEqual([]);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(run.asked).toEqual(['spots', 'monitor']);
    run.stop();
  });

  it('discards the old reply even when its tab is shown again before it arrives', async () => {
    const run = harness(true);
    run.shell.openExtension('test/spots', 'test/near');
    run.shell.showTab('home');
    run.shell.showTab('ext:test/near');
    expect(run.asked).toEqual(['spots']);
    run.pending[0].finish(outcome);
    await flush();
    expect(run.published.filter(view => view.state === 'ready')).toEqual([]);
    expect(run.asked).toEqual(['spots', 'spots']);
    run.pending[1].finish(outcome);
    await flush();
    expect(run.published.filter(view => view.state === 'ready')).toHaveLength(1);
    run.stop();
  });
});

describe('the renderer discards replies after hiding (QGD-HOM-0005)', () => {
  const state = { available: catalogue.map(page => ({ key: page.key, name: page.name, description: page.description,
    extensionName: page.extensionName, icon: page.icon, rail: page.rail, inputs: page.inputs, network: page.network,
    area: page.area!, tab: page.page, hue: 'general', settings: [] })),
    pins: ['test/near'], pages: [], notice: null, reached: null };
  const late: PageView = { key: 'test/spots', state: 'failed', reason: 'Old reply' };

  it('discards a hidden page push instead of keeping it for the next visit', async () => {
    let push: (view: unknown) => void = () => {};
    const store = createHomeStore({ request: async () => ({ ok: true, state }),
      onPage: listener => { push = listener; return () => {}; } }, { state });
    const stop = store.start();
    await flush();
    store.openPage('test/spots');
    store.openPage(null);
    push(late);
    store.openPage('test/spots');
    expect(store.get().page?.shown).toEqual({ state: 'waiting' });
    stop();
  });

  it('discards a delayed snapshot from before a page was hidden, even after returning', async () => {
    const replies: ((reply: unknown) => void)[] = [];
    expect(isHomeReply({ ok: true, state: { ...state, pages: [late] } })).toBe(true);
    const store = createHomeStore({ request: () => new Promise(finish => replies.push(finish)), onPage: () => () => {} }, { state });
    store.openPage('test/spots');
    store.openPage(null);
    store.openPage('test/spots');
    replies[0]({ ok: true, state: { ...state, pages: [late] } });
    await flush();
    expect(store.get().page?.shown).toEqual({ state: 'waiting' });
    replies[2]({ ok: true, state: { ...state, pages: [late] } });
    await flush();
    expect(store.get().page?.shown).toEqual({ state: 'failed', reason: 'Old reply' });
  });
});
