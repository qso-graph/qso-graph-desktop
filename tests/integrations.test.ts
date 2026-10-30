// SPDX-License-Identifier: GPL-3.0-only
// Integrations, against the real native listener (QGD-INT-0001 to
// QGD-INT-0010): the addon build-native.mjs puts in dist/native, driven by
// real UDP from this process.
import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { createSocket, type Socket } from 'node:dgram';
import { readFileSync } from 'node:fs';
import type { NativeIntegrations } from '../packages/integrations-core/native.js';
import { createIntegrations, type Integrations } from '../packages/integrations/integrations.js';
import { parseIntegrationLimits, IntegrationLimitsError } from '../packages/integrations/integration-limits.js';
import {
  parseFromIntegrations, parseToIntegrations, type FromIntegrations, type ListenSpec, type PortState
} from '../packages/integrations/integration-contract.js';

const native = createRequire(import.meta.url)('../dist/native/integrations.node') as NativeIntegrations;
const limits = parseIntegrationLimits(JSON.parse(readFileSync('data/integration-limits.json', 'utf8')));

let running: Integrations[] = [];
let sockets: Socket[] = [];
afterEach(() => {
  for (const integrations of running) integrations.stop();
  for (const socket of sockets) socket.close();
  running = []; sockets = [];
});

function start(extra: Partial<typeof limits> = {}) {
  const said: FromIntegrations[] = [];
  const integrations = createIntegrations({ native, limits: { ...limits, ...extra }, post: message => {
    // Everything it says passes the broker's own check of it.
    expect(parseFromIntegrations(message)).toBeDefined();
    said.push(message);
  } });
  running.push(integrations);
  return { integrations, said };
}

// A free port, found by asking the operating system and letting it go.
async function freePort(): Promise<number> {
  const probe = createSocket('udp4');
  await new Promise<void>(settle => probe.bind(0, '127.0.0.1', settle));
  const { port } = probe.address();
  await new Promise<void>(settle => probe.close(() => settle()));
  return port;
}

async function sender(): Promise<Socket> {
  const socket = createSocket('udp4');
  sockets.push(socket);
  await new Promise<void>(settle => socket.bind(0, '127.0.0.1', settle));
  return socket;
}

const send = (socket: Socket, port: number, bytes: Uint8Array) =>
  new Promise<void>((settle, fail) => socket.send(bytes, port, '127.0.0.1', error => error ? fail(error) : settle()));

async function until<T>(find: () => T | undefined, ms = 5_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const found = find();
    if (found !== undefined) return found;
    if (Date.now() > deadline) throw new Error('not in time');
    await new Promise(settle => setTimeout(settle, 20));
  }
}

const portsOf = (said: FromIntegrations[]) => {
  const last = [...said].reverse().find(message => message.type === 'ports');
  return last?.type === 'ports' ? last.ports : undefined;
};
const datagrams = (said: FromIntegrations[]) => said.flatMap(message => message.type === 'datagrams' ? message.datagrams : []);

const spec = (port: number, allow = ['127.0.0.1']): ListenSpec => ({ adapter: 'wsjtx', port, addresses: ['127.0.0.1'], allow });

describe('Integrations', () => {
  it('listens on nothing until asked, and says so', async () => {
    const { integrations, said } = start();
    expect(integrations.ports()).toEqual([]);
    integrations.receive({ type: 'listen', specs: [] });
    // Said once, so a page can say that nothing is listening; and not again
    // while that stays true.
    expect(said).toEqual([{ type: 'ports', ports: [] }]);
    integrations.receive({ type: 'listen', specs: [] });
    expect(said).toHaveLength(1);
  });

  it('opens the port asked for, passes on what an allowed sender sends, and closes it again', async () => {
    const { integrations, said } = start();
    const port = await freePort();
    integrations.receive({ type: 'listen', specs: [spec(port)] });
    const ports = portsOf(said) as PortState[];
    expect(ports).toHaveLength(1);
    expect(ports[0]).toMatchObject({ adapter: 'wsjtx', listening: true, bound: [`127.0.0.1:${port}`] });
    const out = await sender();
    await send(out, port, new Uint8Array([1, 2, 3]));
    const [got] = await until(() => { const all = datagrams(said); return all.length ? all : undefined; });
    expect([...got.bytes]).toEqual([1, 2, 3]);
    expect(got.from).toBe(`127.0.0.1:${out.address().port}`);
    // Closed: nothing is listening, and the port is free to bind again.
    integrations.receive({ type: 'listen', specs: [] });
    expect(portsOf(said)).toEqual([]);
    const again = createSocket('udp4');
    sockets.push(again);
    await new Promise<void>((settle, fail) => { again.once('error', fail); again.bind(port, '127.0.0.1', settle); });
  });

  it('drops a sender not on the list unread, and counts it', async () => {
    const { integrations, said } = start();
    const port = await freePort();
    integrations.receive({ type: 'listen', specs: [spec(port, ['192.0.2.10'])] });
    await send(await sender(), port, new Uint8Array([1]));
    const ports = await until(() => { const now = portsOf(said); return now?.[0]?.dropped['not-allowed'] === 1 ? now : undefined; });
    expect(ports[0].received).toBe(0);
    expect(datagrams(said)).toEqual([]);
  });

  it('drops a datagram over the size limit', async () => {
    const { integrations, said } = start({ maxDatagramBytes: 512 });
    const port = await freePort();
    integrations.receive({ type: 'listen', specs: [spec(port)] });
    const out = await sender();
    await send(out, port, new Uint8Array(513));
    await send(out, port, new Uint8Array(512));
    await until(() => portsOf(said)?.[0]?.dropped['too-large'] === 1 ? true : undefined);
    const all = await until(() => { const now = datagrams(said); return now.length ? now : undefined; });
    expect(all.map(entry => entry.bytes.length)).toEqual([512]);
  });

  it('says a taken port in words, and does not share it', async () => {
    const holder = await sender();
    const { integrations, said } = start();
    integrations.receive({ type: 'listen', specs: [spec(holder.address().port)] });
    const [state] = portsOf(said) as PortState[];
    expect(state.listening).toBe(false);
    expect(state.reason).toMatch(/could not be opened/);
  });

  it('replies only to a sender it heard', async () => {
    const { integrations, said } = start();
    const port = await freePort();
    integrations.receive({ type: 'listen', specs: [spec(port)] });
    const out = await sender();
    const stranger = await sender();
    integrations.receive({ type: 'reply', adapter: 'wsjtx', to: `127.0.0.1:${stranger.address().port}`, bytes: new Uint8Array([9]) });
    expect(said.at(-1)).toEqual({ type: 'replied', adapter: 'wsjtx', to: `127.0.0.1:${stranger.address().port}`, outcome: 'not-heard' });
    const heard = new Promise<Buffer>(settle => out.once('message', settle));
    await send(out, port, new Uint8Array([1]));
    await until(() => datagrams(said).length ? true : undefined);
    integrations.receive({ type: 'reply', adapter: 'wsjtx', to: `127.0.0.1:${out.address().port}`, bytes: new Uint8Array([7, 7]) });
    expect(said.at(-1)).toMatchObject({ type: 'replied', outcome: 'sent' });
    expect([...await heard]).toEqual([7, 7]);
  });

  it('moves a port by closing the old one first', async () => {
    const { integrations, said } = start();
    const [first, second] = [await freePort(), await freePort()];
    integrations.receive({ type: 'listen', specs: [spec(first)] });
    integrations.receive({ type: 'listen', specs: [spec(second)] });
    expect(portsOf(said)?.[0].bound).toEqual([`127.0.0.1:${second}`]);
  });

  it('ignores a message that is not one of the broker\'s', () => {
    const { integrations, said } = start();
    for (const message of [null, 'listen', { type: 'listen' }, { type: 'listen', specs: [{ adapter: 'wsjtx', port: 80, addresses: ['127.0.0.1'], allow: [] }] },
      { type: 'listen', specs: [{ ...spec(2237), extra: true }] }, { type: 'reply', adapter: 'wsjtx', to: 'nowhere', bytes: new Uint8Array() }, { type: 'nonsense' }]) {
      integrations.receive(message);
    }
    expect(said).toEqual([]);
  });
});

describe('the contract between the broker and Integrations', () => {
  it('refuses a port below 1024, the same adapter twice and an address that is not one', () => {
    expect(parseToIntegrations({ type: 'listen', specs: [spec(1023)] })).toBeUndefined();
    expect(parseToIntegrations({ type: 'listen', specs: [spec(2237), spec(2238)] })).toBeUndefined();
    expect(parseToIntegrations({ type: 'listen', specs: [{ ...spec(2237), addresses: ['eth0'] }] })).toBeUndefined();
    expect(parseToIntegrations({ type: 'listen', specs: [{ ...spec(2237), addresses: [] }] })).toBeUndefined();
    expect(parseToIntegrations({ type: 'listen', specs: [spec(2237)] })).toBeDefined();
  });
});

describe('the integration limits', () => {
  it('reads the shipped file, and refuses one with a limit missing, unknown or out of range', () => {
    const shipped = JSON.parse(readFileSync('data/integration-limits.json', 'utf8'));
    expect(parseIntegrationLimits(shipped).maxDatagramBytes).toBeGreaterThan(0);
    const { burst: _, ...missing } = shipped;
    expect(() => parseIntegrationLimits(missing)).toThrow(IntegrationLimitsError);
    expect(() => parseIntegrationLimits({ ...shipped, extra: 1 })).toThrow(IntegrationLimitsError);
    expect(() => parseIntegrationLimits({ ...shipped, maxDatagramBytes: 70_000 })).toThrow(IntegrationLimitsError);
  });
});
