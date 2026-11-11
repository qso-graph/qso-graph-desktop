// SPDX-License-Identifier: GPL-3.0-or-later
import { beforeEach, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type { TqslSyncPlan, TqslSyncRow } from '../packages/main/tqsl-sync.js';

const electron = vi.hoisted(() => ({ windows: [] as any[], ipc: undefined as any }));
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  class Window extends EventEmitter {
    static getFocusedWindow() { return undefined; }
    webContents = Object.assign(new EventEmitter(), { mainFrame: {}, setWindowOpenHandler: vi.fn() });
    destroyed = false;
    constructor() { super(); electron.windows.push(this); }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; this.emit('closed'); }
    show = vi.fn();
    loadURL = vi.fn(async () => { this.emit('ready-to-show'); });
  }
  electron.ipc = new EventEmitter();
  return {
    BrowserWindow: Window,
    ipcMain: electron.ipc,
    session: { fromPartition: () => ({ setPermissionRequestHandler: vi.fn(), webRequest: { onBeforeRequest: vi.fn() } }) }
  };
});
import { tqslSyncDialog } from '../packages/main/tqsl-sync-dialog.js';

const row = (over: Partial<TqslSyncRow>): TqslSyncRow => ({
  name: 'QG0TEST-HOME', place: { MY_DXCC: '291', MY_GRIDSQUARE: 'DN13' }, park: '', reason: '',
  status: 'new', differences: [], resultName: 'QG0TEST-HOME', offered: true, checked: true, ...over
});
const plan = (): TqslSyncPlan => ({
  folder: '/test-only/.tqsl',
  locations: [
    row({}),
    row({ name: 'Park', status: 'differs', resultName: 'Park (TQSL)', checked: false, park: 'NP01',
      differences: [{ field: 'MY_STATE', tqsl: 'ID', stored: 'KS' }] }),
    row({ name: 'Same', status: 'same', offered: false, checked: false }),
    row({ name: '<planted>', status: 'refused', offered: false, checked: false, place: {}, reason: 'LoTW would refuse this location.' })
  ]
});
const html = (window: any) => decodeURIComponent(window.loadURL.mock.calls[0][0].slice('data:text/html,'.length));
const from = (window: any) => ({ sender: window.webContents, senderFrame: window.webContents.mainFrame });
beforeEach(() => { electron.windows.length = 0; electron.ipc.removeAllListeners(); });

it('shows every location with its status, fields, park and differences; only offered rows can be ticked', async () => {
  const result = tqslSyncDialog('/dist', plan());
  const window = electron.windows[0];
  const page = html(window);
  for (const text of ['/test-only/.tqsl', 'QG0TEST-HOME: New', 'MY_GRIDSQUARE: DN13', 'Park: Differs from your Location',
    'Creates Location: Park (TQSL)', 'LoTW park: NP01', 'MY_STATE: TQSL ID; your Location KS', 'Same: Same as your Location',
    'Refused', 'LoTW would refuse this location.', '&lt;planted&gt;', 'nothing is written to TQSL', 'Cancel', 'Create Locations'])
    expect(page).toContain(text);
  expect(page.match(/type="checkbox"/g)).toHaveLength(2);
  expect(page).toMatch(/value="0" checked/);
  expect(page).not.toMatch(/value="1" checked/);
  electron.ipc.emit('tqsl:sync-answer', from(window), [2]);
  electron.ipc.emit('tqsl:sync-answer', { ...from(window), sender: {} }, [0]);
  expect(window.destroyed).toBe(false);
  electron.ipc.emit('tqsl:sync-answer', from(window), [0, 1]);
  expect(await result).toEqual([0, 1]);
});

it('Cancel and abort choose nothing', async () => {
  const cancelled = tqslSyncDialog('/dist', plan());
  electron.ipc.emit('tqsl:sync-answer', from(electron.windows[0]), null);
  expect(await cancelled).toBeUndefined();
  const stop = new AbortController();
  const aborted = tqslSyncDialog('/dist', plan(), stop.signal);
  stop.abort();
  expect(await aborted).toBeUndefined();
  expect(electron.ipc.listenerCount('tqsl:sync-answer')).toBe(0);
});

it('styles the window only through a stylesheet the CSP names by hash', async () => {
  const result = tqslSyncDialog('/dist', plan());
  const page = html(electron.windows[0]);
  const styles = [...page.matchAll(/<style>([^<]*)<\/style>/g)].map(m => m[1]);
  expect(styles).toHaveLength(1);
  expect(styles[0]).toContain('color-scheme:light dark');
  const csp = /Content-Security-Policy" content="([^"]*)"/.exec(page)![1];
  expect(csp).toContain(`style-src 'sha256-${createHash('sha256').update(styles[0]).digest('base64')}'`);
  expect(csp).toContain("script-src 'none'");
  expect(csp).not.toContain('unsafe');
  expect(page).not.toMatch(/ style="/);
  electron.ipc.emit('tqsl:sync-answer', from(electron.windows[0]), null);
  await result;
});
