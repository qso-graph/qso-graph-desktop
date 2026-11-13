// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it, vi } from 'vitest';
import { isSavedTabs, readSettings, validateSettingsCommand } from '../packages/main/settings-contract.js';
import { createShellStore } from '../packages/renderer/shell-store.js';
import { createTabSession } from '../packages/renderer/tab-session.js';
import { createHomeStore } from '../packages/renderer/home-store.js';

const available = [{ key: 'test/first', area: 'test/first', name: 'Test' }, { key: 'test/second', area: 'test/first', name: 'Second' }];
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

describe('P14-tab-restore (QGD-FRM-0026)', () => {
  it('validates stored and written destinations strictly, refusing the entire bad value', () => {
    const good = ['settings', 'ext:test/first', 'stations', 'home'];
    expect(isSavedTabs(good)).toBe(true);
    expect(readSettings({ tabs: good }).tabs).toEqual(good);
    expect(validateSettingsCommand({ type: 'write', key: 'tabs', value: good })).toBe(true);
    const sparse = new Array(2); sparse[1] = 'home';
    for (const value of [null, 'home', [1], ['Home'], [' home'], ['home', 'home'], ['ext:test/first', 'ext:test/first'], ['ext:test'], ['ext:../first'], ['ext:test/<img>'], ['missing'], sparse, Array.from({ length: 1030 }, (_, at) => `ext:test/page${at}`)]) {
      expect(isSavedTabs(value), String(value)).toBe(false);
      expect(readSettings({ tabs: value }).tabs).toEqual(['home']);
      expect(validateSettingsCommand({ type: 'write', key: 'tabs', value })).toBe(false);
    }
    expect(readSettings({}).tabs).toEqual(['home']);
    expect(readSettings(Object.create({ tabs: good })).tabs).toEqual(['home']);
    expect(isSavedTabs([])).toBe(true);
  });

  it('restores saved order on Home and omits gone or off destinations', async () => {
    const shell = createShellStore(); const write = vi.fn(async () => true);
    const session = createTabSession(shell, { catalogue: () => available, write });
    session.restore(['settings', 'ext:gone/page', 'ext:test/first', 'stations']);
    expect(shell.get().tabs).toEqual(['settings', 'ext:test/first', 'stations', 'home']);
    expect(shell.get().page).toBe('home'); expect(shell.get().extensionPage).toBeNull();
    expect(shell.get().tabMru).toEqual(['home']);
    shell.showTab('ext:test/first'); expect(shell.get().extensionPage).toBe('test/first');
    shell.reorderTab('home', 'settings'); await session.settled();
    expect(write.mock.calls.at(-1)?.[0]).toEqual(['home', 'settings', 'ext:test/first', 'stations']);
    session.stop();
  });

  it('persists close, close others, close all and drag order in the existing settings value', async () => {
    let saved: readonly string[] = [];
    const shell = createShellStore(); const session = createTabSession(shell, { catalogue: () => [], write: async tabs => { saved = tabs; } });
    session.restore(['settings', 'home']);
    shell.set({ page: 'stations' }); shell.set({ page: 'callsigns' });
    shell.reorderTab('callsigns', 'settings'); await session.settled();
    expect(saved).toEqual(['callsigns', 'settings', 'home', 'stations']);
    await shell.closeTab('stations'); await session.settled(); expect(saved).toEqual(['callsigns', 'settings', 'home']);
    await shell.closeOtherTabs('settings'); await session.settled(); expect(saved).toEqual(['settings']);
    await shell.closeAllTabs(); await session.settled(); expect(saved).toEqual(['home']);
    const restarted = createShellStore(); restarted.restoreTabs(saved, []); expect(restarted.get().tabs).toEqual(['home']);
    session.stop();
  });

  it('waits for a checked catalogue, including a genuinely empty catalogue, without overwriting saved tabs', async () => {
    let catalogue: typeof available | undefined;
    const shell = createShellStore(); const write = vi.fn(async () => true);
    const session = createTabSession(shell, { catalogue: () => catalogue, write });
    session.restore(['ext:test/first', 'stations', 'home']);
    shell.set({ themeChoice: 'light' }); await flush();
    expect(write).not.toHaveBeenCalled(); expect(shell.get().tabs).toEqual(['home']);
    catalogue = []; session.catalogueChanged(); await session.settled();
    expect(shell.get().tabs).toEqual(['stations', 'home']);
    expect(write).toHaveBeenCalledWith(['stations', 'home']);
    session.stop();
  });

  it('does not reset navigation made while startup replies were delayed', () => {
    const shell = createShellStore(); shell.set({ page: 'callsigns' });
    shell.restoreTabs(['stations', 'home'], available);
    expect(shell.get().page).toBe('callsigns'); expect(shell.get().tabs).toEqual(['stations', 'home', 'callsigns']);
  });

  it('serializes writes and continues after a rejected write, without writing selection changes', async () => {
    const shell = createShellStore(); let first!: () => void;
    const write = vi.fn<(tabs: readonly string[]) => Promise<unknown>>()
      .mockImplementationOnce(() => new Promise(resolve => { first = () => resolve(true); }))
      .mockRejectedValueOnce(new Error('unavailable')).mockResolvedValue(true);
    const session = createTabSession(shell, { catalogue: () => available, write });
    session.restore(['home', 'callsigns']); await flush();
    shell.set({ page: 'stations' }); shell.reorderTab('stations', 'home'); await flush();
    expect(write).toHaveBeenCalledTimes(1);
    first(); await session.settled(); expect(write.mock.calls).toEqual([
      [['home', 'callsigns']], [['home', 'callsigns', 'stations']], [['stations', 'home', 'callsigns']]
    ]);
    shell.showTab('callsigns'); await session.settled(); expect(write).toHaveBeenCalledTimes(3);
    session.stop();
  });

  it('restores extension tabs without asking them until shown (QGD-INV-0012)', async () => {
    const catalogue = available.map(page => ({ ...page, extensionName: 'Test', description: 'Test', icon: 'extension', hue: 'general', rail: true, inputs: [], network: false, tab: page.name, settings: [] }));
    const state = { available: catalogue, pins: [], pages: [], notice: null, reached: null };
    const request = vi.fn(async () => ({ ok: true, state }));
    const home = createHomeStore({ request, onPage: () => () => {} });
    const shell = createShellStore(); const session = createTabSession(shell, { catalogue: () => home.catalogue(), write: async () => true });
    home.subscribe(() => session.catalogueChanged());
    const unsubscribe = shell.subscribe(state => home.openPage(state.extensionPage));
    session.restore(['ext:test/first', 'callsigns', 'home']);
    const stop = home.start(); await flush();
    expect(shell.get().tabs).toEqual(['ext:test/first', 'callsigns', 'home']);
    expect(request.mock.calls.map(([command]) => command)).toEqual([{ type: 'read' }]);
    shell.showTab('ext:test/first'); await flush();
    expect(request.mock.calls.map(([command]) => command)).toContainEqual({ type: 'open', key: 'test/first' });
    stop(); unsubscribe(); session.stop();
  });
});
