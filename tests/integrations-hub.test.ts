// SPDX-License-Identifier: GPL-3.0-only
// The broker's decisions about Integrations (integrations-hub.ts):
// QGD-INT-0004 to QGD-INT-0006, QGD-INT-0010, QGD-INT-0011, QGD-INT-0021.
import { describe, expect, it } from 'vitest';
import { createIntegrationsHub, LOOPBACK, type HubExtension, type NetworkInterface } from '../packages/main/integrations-hub.js';
import type { ToIntegrations } from '../packages/integrations/integration-contract.js';
import type { AdapterSettings } from '../packages/main/settings-contract.js';
import { isIntegrationsView } from '../packages/main/integrations-page-contract.js';
import type { IntegrationEvent } from '../packages/extension-api/integration-events.js';

const ADAPTER: HubExtension = { id: 'wsjtx', name: 'WSJT-X', grants: ['integration:receive'], integration: { program: 'WSJT-X', transport: 'udp', port: 2237 } };
const MONITOR: HubExtension = { id: 'monitor', name: 'Monitor', grants: ['integration:events'] };
const OTHER: HubExtension = { id: 'astro', name: 'Astro', grants: ['station:active'] };

function hub(options: { on?: string[]; withdrawn?: string[]; settings?: Record<string, AdapterSettings>; interfaces?: NetworkInterface[] } = {}) {
  const sent: ToIntegrations[] = [];
  const delivered: { id: string; message: unknown }[] = [];
  const state = { on: new Set(options.on ?? ['wsjtx', 'monitor']), withdrawn: new Set(options.withdrawn ?? []), settings: options.settings ?? {}, changes: 0,
    interfaces: options.interfaces ?? [{ name: 'eth0', addresses: ['192.168.1.20'] }] as NetworkInterface[] };
  const created = createIntegrationsHub({
    extensions: () => [ADAPTER, MONITOR, OTHER],
    isOn: id => state.on.has(id),
    holds: (id, grant) => [ADAPTER, MONITOR, OTHER].find(entry => entry.id === id)!.grants.includes(grant) && !state.withdrawn.has(`${id} ${grant}`),
    settings: () => state.settings,
    interfaces: () => state.interfaces,
    send: message => sent.push(message),
    deliver: async (id, message, allowed) => { if (!allowed()) return false; delivered.push({ id, message }); return true; },
    changed: () => { state.changes += 1; },
    now: () => Date.parse('2026-10-29T18:42:45Z'),
    log: { warn: () => undefined }
  });
  const listens = () => sent.filter((message): message is Extract<ToIntegrations, { type: 'listen' }> => message.type === 'listen');
  return { hub: created, sent, delivered, state, listens };
}

const decode = (source = 'WSJT-X'): IntegrationEvent => ({
  type: 'decode', source, isNew: true, time: 67_365_000, snr: -12, dt: 0.2, df: 1234, mode: '~', message: 'CQ K7ABC DN13', lowConfidence: false, offAir: false
});

describe('which ports are open', () => {
  it('opens an adapter that is on on its program\'s usual port, on this computer alone', () => {
    const { hub: h, listens } = hub();
    h.reconcile();
    expect(listens().at(-1)!.specs).toEqual([{ adapter: 'wsjtx', port: 2237, addresses: [...LOOPBACK], allow: [...LOOPBACK] }]);
  });

  it('opens nothing for an adapter that is off, or whose grant was withdrawn', () => {
    const off = hub({ on: ['monitor'] });
    off.hub.reconcile();
    expect(off.listens().at(-1)!.specs).toEqual([]);
    const withdrawn = hub({ withdrawn: ['wsjtx integration:receive'] });
    withdrawn.hub.reconcile();
    expect(withdrawn.listens().at(-1)!.specs).toEqual([]);
    expect(withdrawn.hub.view().adapters[0].on).toBe(false);
  });

  it('listens on a network on its own addresses, allowing only the senders named', () => {
    const { hub: h, listens } = hub({ settings: { wsjtx: { port: 2238, network: 'eth0', allow: ['192.168.1.50'] } } });
    h.reconcile();
    expect(listens().at(-1)!.specs).toEqual([{ adapter: 'wsjtx', port: 2238, addresses: ['192.168.1.20'], allow: ['192.168.1.50'] }]);
  });

  it('says a network that is not connected, and listens on nothing else in its place', () => {
    const { hub: h, listens } = hub({ settings: { wsjtx: { port: 2237, network: 'eth1', allow: ['192.168.1.50'] } } });
    h.reconcile();
    expect(listens().at(-1)!.specs).toEqual([]);
    expect(h.view().adapters[0].reason).toMatch(/eth1.*not connected/);
  });
});

describe('a network that comes, or changes address', () => {
  it('is listened on once it is there, and on its new address after a change', () => {
    const { hub: h, listens, state } = hub({ interfaces: [], settings: { wsjtx: { port: 2237, network: 'eth0', allow: ['192.168.1.50'] } } });
    h.reconcile();
    h.interfacesChanged();
    expect(listens().at(-1)!.specs).toEqual([]);
    state.interfaces = [{ name: 'eth0', addresses: ['192.168.1.20'] }];
    expect(h.interfacesChanged()).toBe(true);
    expect(listens().at(-1)!.specs[0].addresses).toEqual(['192.168.1.20']);
    expect(h.interfacesChanged()).toBe(false);
    state.interfaces = [{ name: 'eth0', addresses: ['192.168.1.21'] }];
    expect(h.interfacesChanged()).toBe(true);
    expect(listens().at(-1)!.specs[0].addresses).toEqual(['192.168.1.21']);
  });

  it('is not watched for an adapter on this computer alone', () => {
    const { hub: h, state } = hub();
    expect(h.watching()).toBe(false);
    state.interfaces = [{ name: 'eth1', addresses: ['10.0.0.2'] }];
    expect(h.interfacesChanged()).toBe(false);
  });
});

describe('where what arrives goes', () => {
  it('gives an adapter its datagrams, and an adapter that is off none', async () => {
    const { hub: h, delivered, state } = hub();
    h.received({ type: 'datagrams', adapter: 'wsjtx', datagrams: [{ from: '127.0.0.1:50000', bytes: new Uint8Array([1]) }] });
    expect(delivered).toHaveLength(1);
    expect(delivered[0].id).toBe('wsjtx');
    state.on.delete('wsjtx');
    h.received({ type: 'datagrams', adapter: 'wsjtx', datagrams: [{ from: '127.0.0.1:50000', bytes: new Uint8Array([1]) }] });
    expect(delivered).toHaveLength(1);
  });

  it('gives events, stamped with the adapter, to every consumer that is on and holds the grant, and to nobody else', () => {
    const { hub: h, delivered, state } = hub();
    expect(h.events('wsjtx', [decode()], 0)).toBe(1);
    expect(delivered).toEqual([{ id: 'monitor', message: { type: 'events', events: [{ ...decode(), adapter: 'wsjtx' }] } }]);
    state.withdrawn.add('monitor integration:events');
    expect(h.events('wsjtx', [decode()], 0)).toBe(0);
    state.withdrawn.clear(); state.on.delete('monitor');
    expect(h.events('wsjtx', [decode()], 0)).toBe(0);
    expect(delivered).toHaveLength(1);
  });

  it('takes events only from an adapter that is on', () => {
    const { hub: h, delivered, state } = hub();
    state.on.delete('wsjtx');
    expect(h.events('wsjtx', [decode()], 0)).toBe(0);
    expect(h.events('astro', [decode()], 0)).toBe(0);
    expect(delivered).toEqual([]);
  });
});

describe('what Integrations\' page shows', () => {
  it('lists every adapter, its sources by their own name, and what was dropped and why', () => {
    const { hub: h } = hub();
    h.processState('running');
    h.received({ type: 'ports', ports: [{ adapter: 'wsjtx', listening: true, bound: ['127.0.0.1:2237', '[::1]:2237'], received: 7,
      dropped: { 'not-allowed': 2, 'too-large': 0, 'over-rate': 0, 'queue-full': 0 }, heard: [{ address: '127.0.0.1', at: '2026-10-29T18:42:45.000Z' }] }] });
    h.events('wsjtx', [decode('WSJT-X - IC-7300'), decode('WSJT-X - FTDX10')], 3);
    const view = h.view();
    expect(isIntegrationsView(view)).toBe(true);
    expect(view.adapters).toHaveLength(1);
    expect(view.adapters[0]).toMatchObject({ id: 'wsjtx', on: true, listening: true, received: 7, port: 2237, network: null,
      dropped: { 'not-allowed': 2, malformed: 3 } });
    expect(view.adapters[0].sources.map(source => source.name).sort()).toEqual(['WSJT-X - FTDX10', 'WSJT-X - IC-7300']);
  });

  it('forgets what an adapter heard when it is turned off', () => {
    const { hub: h, state } = hub();
    h.events('wsjtx', [decode()], 1);
    state.on.delete('wsjtx');
    h.reconcile();
    state.on.add('wsjtx');
    expect(h.view().adapters[0].sources).toEqual([]);
    expect(h.view().adapters[0].dropped.malformed).toBe(0);
  });
});

describe('the one reply', () => {
  it('is sent through Integrations and answered with what it said', async () => {
    const { hub: h, sent } = hub();
    h.processState('running');
    const answer = h.reply('wsjtx', '127.0.0.1:50000', new Uint8Array([1]));
    expect(sent.at(-1)).toMatchObject({ type: 'reply', adapter: 'wsjtx', to: '127.0.0.1:50000' });
    h.received({ type: 'replied', adapter: 'wsjtx', to: '127.0.0.1:50000', outcome: 'not-heard' });
    expect(await answer).toMatch(/not been heard/);
  });

  it('is refused for an adapter that is off', async () => {
    const { hub: h, state, sent } = hub();
    h.processState('running');
    state.on.delete('wsjtx');
    expect(await h.reply('wsjtx', '127.0.0.1:50000', new Uint8Array([1]))).toMatch(/not listening/);
    expect(sent.some(message => message.type === 'reply')).toBe(false);
  });
});
