// SPDX-License-Identifier: GPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RENDERER_URL } from '../packages/callsigns/callsign-contract.js';
import type { HomeReply } from '../packages/main/home-contract.js';
import type { SupervisorStatus } from '../packages/main/extension-host-supervisor.js';
const wiring = vi.hoisted(() => ({ handlers: new Map<string, (event: unknown, command: unknown) => Promise<HomeReply>>(), sent: [] as { channel: string; value: unknown }[] }));
vi.mock('electron', () => ({
  ipcMain: { handle: (name: string, handler: typeof wiring.handlers extends Map<string, infer H> ? H : never) => wiring.handlers.set(name, handler), removeHandler: (name: string) => wiring.handlers.delete(name) },
  BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: (channel: string, value: unknown) => wiring.sent.push({ channel, value }) } }] }
}));
vi.mock('../packages/main/settings.js', () => ({ load: () => ({ pins: [], pageSettings: {} }), save: () => true }));
vi.mock('../packages/logging/logger.js', () => ({ createLogger: () => ({ warn: () => {} }) }));
import { startHomeBroker, type HomeBrokerOptions } from '../packages/main/home-broker.js';
import { loadExtensions } from '../packages/main/extension-runtime.js';
const manifest = JSON.parse(readFileSync(join('extensions', 'lotw', 'manifest.json'), 'utf8'));
const register = JSON.parse(readFileSync(join('data', 'extension-grants.json'), 'utf8'));
const loaded = loadExtensions([{ source: join('extensions', 'lotw', 'manifest.json'), value: manifest, shipped: true }], register, {}).loaded;
const key = 'lotw/certificates';
const data = { ok: true, data: { version: 8, observedAt: '2026-11-09T12:00:00Z', sections: [{ shape: 'table', columns: ['Call'], rows: [{ key: 'issued-key', cells: ['QG0TEST'] }] }] } };
const frame = { url: RENDERER_URL };
const event = { senderFrame: frame, sender: { mainFrame: frame, once: () => {} } };
const stop: (() => void)[] = [];
afterEach(() => { for (const close of stop.splice(0)) close(); wiring.sent.length = 0; });
function harness() {
  let enabled = true;
  let enablementChanged: () => void = () => {};
  let hostChanged: () => void = () => {};
  const status: SupervisorStatus = { host: 'running', failed: {}, affected: [], stops: 0 };
  const page = vi.fn(async () => ({ outcome: 'completed', answer: data }));
  const action = vi.fn(async () => ({ ok: true, status: 'Deleted.' }));
  const showPage = vi.fn(); const closePage = vi.fn();
  const broker = startHomeBroker({
    loaded: () => loaded, onCallsignsChanged: () => {},
    enablement: { isOn: () => enabled, onChange: listener => { enablementChanged = listener; return () => {}; } },
    supervisor: { page, action, showPage, closePage, status: () => status, onChange: listener => { hostChanged = () => listener(status); return () => {}; } } as unknown as HomeBrokerOptions['supervisor']
  });
  stop.push(broker.stop);
  const request = (command: unknown, sender: unknown = event) => wiring.handlers.get('home:request')!(sender, command);
  return { request, page, action, closePage, off: () => { enabled = false; enablementChanged(); }, on: () => { enabled = true; enablementChanged(); }, restarted: () => { (status as { stops: number }).stops++; hostChanged(); } };
}
describe('main-window action admission and cache lifecycle', () => {
  it('refuses subframes, unknown fields, closed pages and unissued keys before reaching the supervisor', async () => {
    const h = harness();
    const command = { type: 'page.action', key, event: { page: 'certificates', action: 'delete', row: 'issued-key' } };
    expect((await h.request(command)).ok).toBe(false);
    await h.request({ type: 'open', key });
    await vi.waitFor(() => expect(h.page).toHaveBeenCalledTimes(1));
    for (const bad of [{ ...command, extra: true }, { ...command, event: { ...command.event, extra: true } }, { ...command, event: { ...command.event, row: 'unissued' } }]) expect((await h.request(bad)).ok).toBe(false);
    expect((await h.request(command, { ...event, senderFrame: { ...frame } })).ok).toBe(false);
    expect(h.action).not.toHaveBeenCalled();
    const accepted = await h.request(command);
    expect(accepted).toMatchObject({ ok: true, action: { key, running: false, status: 'Deleted.' } });
    expect(h.action).toHaveBeenCalledExactlyOnceWith('lotw', command.event);
    expect(wiring.sent.filter(message => message.channel === 'home:action').map(message => message.value)).toEqual([{ key, running: true }, { key, running: false, status: 'Deleted.' }]);
  });
  it('asks an actionable page again after disable/enable and after a host restart', async () => {
    const h = harness();
    await h.request({ type: 'open', key });
    await vi.waitFor(() => expect(h.page).toHaveBeenCalledTimes(1));
    await h.request({ type: 'open', key: null });
    expect(h.closePage).toHaveBeenCalledExactlyOnceWith('lotw', 'certificates');
    h.off(); h.on();
    await h.request({ type: 'open', key });
    await vi.waitFor(() => expect(h.page).toHaveBeenCalledTimes(2));
    h.restarted();
    await vi.waitFor(() => expect(h.page).toHaveBeenCalledTimes(3));
  });
});
