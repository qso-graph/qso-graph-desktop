// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { createShellStore, shownTab, visiblePages } from '../packages/renderer/shell-store.js';

describe('P14-tabs (QGD-FRM-0023, QGD-FRM-0024)', () => {
  it('opens a destination once and shows an existing tab in place', () => {
    const store = createShellStore();
    store.set({ page: 'callsigns' });
    store.set({ page: 'stations' });
    store.set({ page: 'callsigns' });
    expect(store.get().tabs).toEqual(['home', 'callsigns', 'stations']);
    expect(shownTab(store.get())).toBe('callsigns');
    expect(store.get().tabMru).toEqual(['callsigns', 'stations', 'home']);
  });

  it('keys areas by id, keeps their pages inside one tab and remembers the chosen page', () => {
    const store = createShellStore();
    store.openExtension('parks/near', 'parks/near');
    store.openExtension('parks/spots', 'parks/near');
    store.openExtension('other/near', 'other/near');
    expect(store.get().tabs).toEqual(['home', 'ext:parks/near', 'ext:other/near']);
    store.showTab('ext:parks/near');
    expect(store.get().extensionPage).toBe('parks/spots');
    expect(shownTab(store.get())).toBe('ext:parks/near');
    store.set({ extensionSettings: true });
    store.set({ page: 'settings' });
    expect(store.get().extensionSettings).toBe(false);
    store.showTab('ext:parks/near');
    expect(store.get().extensionSettings).toBe(true);
  });

  it('closes a background tab without changing the shown page or its MRU', () => {
    const store = createShellStore();
    store.set({ page: 'callsigns' });
    store.set({ page: 'stations' });
    store.closeTab('callsigns');
    expect(store.get().tabs).toEqual(['home', 'stations']);
    expect(store.get().page).toBe('stations');
    expect(store.get().tabMru).toEqual(['stations', 'home']);
  });

  it('shows the most recently used tab after closing the shown tab, regardless of position', () => {
    const store = createShellStore();
    store.set({ page: 'callsigns' });
    store.set({ page: 'stations' });
    store.set({ page: 'integrations' });
    store.showTab('callsigns');
    store.closeTab('callsigns');
    expect(store.get().page).toBe('integrations');
    expect(store.get().tabMru).toEqual(['integrations', 'stations', 'home']);
  });

  it('closes others around the named tab and shows it', () => {
    const store = createShellStore();
    store.set({ page: 'callsigns' });
    store.set({ page: 'stations' });
    store.closeOtherTabs('callsigns');
    expect(store.get().tabs).toEqual(['callsigns']);
    expect(store.get().tabMru).toEqual(['callsigns']);
    expect(store.get().page).toBe('callsigns');
  });

  it('closes all tabs and opens Home', () => {
    const store = createShellStore();
    store.set({ page: 'stations' });
    store.closeAllTabs();
    expect(store.get().tabs).toEqual(['home']);
    expect(store.get().tabMru).toEqual(['home']);
    expect(store.get().page).toBe('home');
  });

  it('opens Home when the last individual tab closes', () => {
    const store = createShellStore();
    store.set({ page: 'stations' });
    store.closeTab('home');
    store.closeTab('stations');
    expect(store.get().tabs).toEqual(['home']);
    expect(store.get().page).toBe('home');
    expect(store.get().extensionPage).toBeNull();
  });

  it('reorders by destination id without changing selection or MRU', () => {
    const store = createShellStore();
    store.set({ page: 'callsigns' });
    store.set({ page: 'stations' });
    store.reorderTab('home', 'stations');
    expect(store.get().tabs).toEqual(['callsigns', 'stations', 'home']);
    store.reorderTab('home', 'callsigns');
    expect(store.get().tabs).toEqual(['home', 'callsigns', 'stations']);
    expect(store.get().page).toBe('stations');
    expect(store.get().tabMru).toEqual(['stations', 'callsigns', 'home']);
  });

  it('never removes a rail destination when its tab closes, and can open it again', () => {
    const store = createShellStore();
    const before = visiblePages();
    store.set({ page: 'callsigns' });
    store.closeTab('callsigns');
    expect(store.get().tabs).not.toContain('callsigns');
    expect(visiblePages()).toEqual(before);
    store.set({ page: 'callsigns' });
    expect(store.get().tabs).toEqual(['home', 'callsigns']);
  });

  it('ignores unknown tab actions and publishes nothing when nothing changes', () => {
    const store = createShellStore();
    const states: unknown[] = [];
    store.subscribe(state => states.push(state));
    store.showTab('missing');
    store.closeTab('missing');
    store.closeOtherTabs('missing');
    store.reorderTab('home', 'missing');
    store.reorderTab('home', 'home');
    store.set({ page: 'home' });
    expect(states).toHaveLength(1);
  });
});
