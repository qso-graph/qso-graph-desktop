// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it, vi } from 'vitest';
import { createShellStore } from '../packages/renderer/shell-store.js';
import type { PageWork } from '../packages/renderer/page-work.js';
import { createHomeStore } from '../packages/renderer/home-store.js';
import { createPageScheduler } from '../packages/main/page-scheduler.js';
import type { PageOutcome } from '../packages/main/extension-host-supervisor.js';

function draft(store: ReturnType<typeof createShellStore>, id: string, saveResult: unknown = true) {
  let dirty = true;
  const work: PageWork = {
    isDirty: () => dirty,
    save: vi.fn(async () => { if (saveResult === true) dirty = false; return saveResult as boolean; }),
    discard: vi.fn(() => { dirty = false; }), reveal: vi.fn()
  };
  const stop = store.registerWork(id, work);
  return { work, stop, edit: () => { dirty = true; } };
}
function tabs() {
  const store = createShellStore();
  store.set({ page: 'callsigns' }); store.set({ page: 'stations' }); store.set({ page: 'settings' });
  return store;
}

describe('P14-close-work (QGD-FRM-0025)', () => {
  it('shows a dirty background tab and Cancel retains the whole closing set and every draft', async () => {
    const store = tabs(); const one = draft(store, 'callsigns'); const two = draft(store, 'stations');
    const before = store.get().tabs;
    const closing = store.closeAllTabs();
    expect(store.get().page).toBe('callsigns');
    expect(one.work.reveal).toHaveBeenCalledOnce();
    expect(store.get().closeQuestion).toEqual(['Callsigns', 'Locations']);
    store.answerClose('cancel');
    expect(await closing).toBe(false);
    expect(store.get().tabs).toEqual(before);
    expect(one.work.isDirty()).toBe(true); expect(two.work.isDirty()).toBe(true);
    expect(one.work.discard).not.toHaveBeenCalled(); expect(one.work.save).not.toHaveBeenCalled();
  });

  it('close others asks once, excludes the kept tab, and discards only after the answer', async () => {
    const store = tabs(); const kept = draft(store, 'settings'); const one = draft(store, 'callsigns'); const two = draft(store, 'stations');
    const questions: unknown[] = []; store.subscribe(state => { if (state.closeQuestion) questions.push(state.closeQuestion); });
    const closing = store.closeOtherTabs('settings');
    expect(questions).toEqual([['Callsigns', 'Locations']]);
    expect(one.work.discard).not.toHaveBeenCalled();
    store.answerClose('discard');
    expect(await closing).toBe(true);
    expect(store.get().tabs).toEqual(['settings']);
    expect(one.work.discard).toHaveBeenCalledOnce(); expect(two.work.discard).toHaveBeenCalledOnce();
    expect(kept.work.isDirty()).toBe(true); expect(one.work.save).not.toHaveBeenCalled();
  });

  it('waits for confirmed saves of all participants before closing any tab', async () => {
    const store = tabs(); const one = draft(store, 'callsigns'); const two = draft(store, 'callsigns');
    let saved = false; let finish!: (value: boolean) => void;
    one.work.isDirty = () => !saved;
    one.work.save = vi.fn(() => new Promise(resolve => { finish = value => { saved = value; resolve(value); }; }));
    const closing = store.closeAllTabs(); store.answerClose('save');
    await Promise.resolve();
    expect(store.get().tabs).toContain('callsigns'); expect(two.work.save).not.toHaveBeenCalled();
    finish(true);
    expect(await closing).toBe(true);
    expect(two.work.save).toHaveBeenCalledOnce(); expect(store.get().tabs).toEqual(['home']);
  });

  it.each([false, undefined, null, 'completed', { outcome: 'unknown' }])('refuses an unconfirmed save (%j)', async result => {
    const store = tabs(); const page = draft(store, 'stations', result);
    if (result === undefined) page.work.save = async () => undefined as unknown as boolean;
    const before = store.get().tabs;
    const closing = store.closeAllTabs(); store.answerClose('save');
    expect(await closing).toBe(false);
    expect(store.get().tabs).toEqual(before); expect(page.work.isDirty()).toBe(true);
    expect(page.work.discard).not.toHaveBeenCalled(); expect(store.get().closeError).toContain('confirmed saved');
  });

  it('keeps a failed save and a new edit made during a save', async () => {
    const store = tabs(); const page = draft(store, 'stations');
    page.work.save = async () => { throw new Error('failed'); };
    let closing = store.closeTab('stations'); store.answerClose('save');
    expect(await closing).toBe(false); expect(page.work.isDirty()).toBe(true);
    page.work.save = async () => true; // A success for an older revision is insufficient.
    closing = store.closeTab('stations'); store.answerClose('save');
    expect(await closing).toBe(false); expect(store.get().tabs).toContain('stations');
  });

  it('stops an entire extension disable on Cancel or failed save, and closes only after disable succeeds', async () => {
    const store = tabs(); store.openExtension('test/page', 'test/page');
    store.setTabLabels({ 'ext:test/page': 'Test destination' });
    const page = draft(store, 'ext:test/page'); const disable = vi.fn(async () => true);
    let closing = store.withClosingTabs(['ext:test/page'], disable);
    expect(store.get().closeQuestion).toEqual(['Test destination']); store.answerClose('cancel');
    expect(await closing).toBe(false); expect(disable).not.toHaveBeenCalled();
    page.work.save = async () => false;
    closing = store.withClosingTabs(['ext:test/page'], disable); store.answerClose('save');
    expect(await closing).toBe(false); expect(disable).not.toHaveBeenCalled();
    closing = store.withClosingTabs(['ext:test/page'], async () => false); store.answerClose('discard');
    expect(await closing).toBe(false); expect(page.work.isDirty()).toBe(true);
    closing = store.withClosingTabs(['ext:test/page'], disable); store.answerClose('discard');
    expect(await closing).toBe(true); expect(disable).toHaveBeenCalledOnce();
    expect(store.get().tabs).not.toContain('ext:test/page'); expect(store.get().tabs).toContain('stations');
  });

  it('exposes a window-close check with the same question and leaves tabs intact for step 5', async () => {
    const store = tabs(); const page = draft(store, 'callsigns'); const before = store.get().tabs;
    let closing = store.mayCloseWindow(); store.answerClose('cancel');
    expect(await closing).toBe(false);
    closing = store.mayCloseWindow(); store.answerClose('discard');
    expect(await closing).toBe(true); expect(store.get().tabs).toEqual(before); expect(page.work.isDirty()).toBe(true);
    closing = store.mayCloseWindow(); store.answerClose('save');
    expect(await closing).toBe(true); expect(page.work.isDirty()).toBe(false); expect(store.get().tabs).toEqual(before);
  });

  it('refuses overlapping closes and unregisters a participant when its page leaves', async () => {
    const store = tabs(); const page = draft(store, 'callsigns');
    const closing = store.closeTab('callsigns');
    expect(await store.closeAllTabs()).toBe(false);
    store.answerClose('cancel'); await closing;
    page.stop(); expect(await store.closeTab('callsigns')).toBe(true);
    expect(store.get().closeQuestion).toBeNull();
  });
});

describe('closing a tab (QGD-FRM-0025, QGD-HOM-0005)', () => {
  it('cancels a closed page\'s data request and publishes no late reply', async () => {
    const store = createShellStore(); let shown: string[] = []; let finish!: (answer: PageOutcome) => void;
    const published = vi.fn(); let signal!: AbortSignal;
    const scheduler = createPageScheduler({
      catalogue: () => [{ key: 'test/page', extension: 'test', extensionName: 'Test', page: 'page', name: 'Test', description: 'Test', refreshSeconds: 60, icon: 'extension', rail: true, network: false, inputs: [] }],
      pins: () => shown, now: () => 0, publish: published,
      page: (_extension, _page, current) => { signal = current; return new Promise(resolve => { finish = resolve; }); }
    });
    scheduler.setVisible(true);
    const stop = store.subscribe(state => { shown = state.extensionPage ? [state.extensionPage] : []; scheduler.changed(); });
    store.openExtension('test/page', 'test/page');
    await store.closeTab('ext:test/page');
    expect(signal.aborted).toBe(true);
    finish({ outcome: 'unknown', reason: 'The outcome is unknown.' });
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(published.mock.calls.map(([view]) => view.state)).toEqual(['waiting']);
    stop(); scheduler.stop();
  });

  it('lets a write action finish after closing, without replaying it', async () => {
    let finish!: (value: unknown) => void;
    const requests: unknown[] = [];
    const available = [{ key: 'test/page', area: 'test/page', name: 'Test', extensionName: 'Test', description: 'Test', icon: 'extension', hue: 'general', rail: true, inputs: [], network: false, tab: 'Test', settings: [] }];
    const state = { available, pins: [], pages: [], notice: null, reached: null };
    const home = createHomeStore({ request: command => {
      requests.push(command);
      return (command as { type: string }).type === 'page.action' ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({ ok: true, state });
    }, onPage: () => () => {} }, { state });
    const shell = createShellStore();
    const stop = shell.subscribe(state => home.openPage(state.extensionPage));
    shell.openExtension('test/page', 'test/page');
    const action = home.pressAction('test/page', 'save');
    await shell.closeAllTabs();
    finish({ ok: false, error: 'The outcome is unknown. Read before retrying.' }); await action;
    shell.openExtension('test/page', 'test/page');
    expect(home.get().page?.actionStatus).toContain('unknown');
    expect(requests.filter(command => (command as { type: string }).type === 'page.action')).toHaveLength(1);
    stop();
  });
});

it('names every distinct dirty tab even when destinations share the same display name', async () => {
  const shell = createShellStore(); shell.openExtension('test/one', 'test/one'); shell.openExtension('test/two', 'test/two');
  shell.setTabLabels({ 'ext:test/one': 'Same name', 'ext:test/two': 'Same name' });
  draft(shell, 'ext:test/one'); draft(shell, 'ext:test/two');
  const close = shell.closeAllTabs(); expect(shell.get().closeQuestion).toEqual(['Same name', 'Same name']);
  shell.answerClose('cancel'); expect(await close).toBe(false);
});

it('keeps every tab when a later save fails or an earlier saved draft changes during that save', async () => {
  const shell = tabs(); const one = draft(shell, 'callsigns'); const two = draft(shell, 'stations', false);
  let close = shell.closeAllTabs(); shell.answerClose('save');
  expect(await close).toBe(false); expect(shell.get().tabs).toContain('callsigns'); expect(shell.get().tabs).toContain('stations');
  one.edit();
  two.work.save = async () => { one.edit(); two.work.isDirty = () => false; return true; };
  close = shell.closeAllTabs(); shell.answerClose('save');
  expect(await close).toBe(false); expect(one.work.isDirty()).toBe(true); expect(shell.get().page).toBe('callsigns');
});

it('also retains a previously clean page edited while another page is saving', async () => {
  const shell = tabs(); let changed = false;
  shell.registerWork('callsigns', { isDirty: () => changed, save: async () => true, discard: () => { changed = false; } });
  const pending = draft(shell, 'stations');
  pending.work.save = async () => { changed = true; pending.work.isDirty = () => false; return true; };
  const close = shell.closeAllTabs(); shell.answerClose('save');
  expect(await close).toBe(false); expect(changed).toBe(true); expect(shell.get().tabs).toContain('callsigns');
});
