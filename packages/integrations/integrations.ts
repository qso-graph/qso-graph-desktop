// SPDX-License-Identifier: GPL-3.0-only
// Integrations: the one way in (QGD-INT-0001 to QGD-INT-0010).
//
// What runs in Integrations' process, with the native listener and the way
// out passed in, so all of it runs under unit tests against the real addon.
// It opens exactly the ports the broker asks for and no other, passes on
// what the listener admitted, sends the one reply an adapter may make, and
// says what each port is doing whenever that changes.
//
// It knows no program's protocol (QGD-INT-0002): bytes and a sender's
// address go on, unread.
import type { NativeIntegrations, NativeListener } from '../integrations-core/native.js';
import {
  DROP_REASONS, openRefusal, parseToIntegrations, type DropReason, type FromIntegrations, type ListenSpec, type PortState
} from './integration-contract.js';
import type { IntegrationLimits } from './integration-limits.js';

// The most datagrams passed on in one message, and how long a read waits.
const BATCH = 512;
const WAIT_MS = 500;
// How often what each port is doing is looked at; it is said only when it
// changed, so a quiet port says nothing.
export const STATE_MS = 1_000;

interface Open {
  readonly spec: ListenSpec;
  readonly listener: NativeListener;
  closed: boolean;
}

export interface IntegrationsDeps {
  readonly native: NativeIntegrations;
  readonly limits: IntegrationLimits;
  post(message: FromIntegrations): void;
}

const same = (a: ListenSpec, b: ListenSpec) => JSON.stringify(a) === JSON.stringify(b);

export function createIntegrations(deps: IntegrationsDeps) {
  const open = new Map<string, Open>();
  const failed = new Map<string, string>();
  let said = '';
  let stopped = false;

  function close(adapter: string): void {
    const entry = open.get(adapter);
    if (!entry) return;
    entry.closed = true;
    entry.listener.close();
    open.delete(adapter);
  }

  // Read until closed. Each listener has one read waiting at a time.
  async function pump(adapter: string, entry: Open): Promise<void> {
    while (!entry.closed) {
      let batch;
      try {
        batch = await entry.listener.next(BATCH, WAIT_MS);
      } catch {
        // The listener refused to read: said as a port that stopped.
        failed.set(adapter, 'The port stopped listening.');
        close(adapter);
        state();
        return;
      }
      if (entry.closed || batch.length === 0) continue;
      deps.post({ type: 'datagrams', adapter, datagrams: batch.map(datagram => ({ from: datagram.from, bytes: datagram.bytes })) });
    }
  }

  function listen(specs: readonly ListenSpec[]): void {
    const wanted = new Map(specs.map(spec => [spec.adapter, spec]));
    // Anything not asked for is closed first, so a port moved from one
    // number to another is free before the new one opens.
    for (const [adapter, entry] of [...open]) {
      const spec = wanted.get(adapter);
      if (!spec || !same(spec, entry.spec)) close(adapter);
    }
    for (const adapter of [...failed.keys()]) if (!wanted.has(adapter)) failed.delete(adapter);
    for (const spec of specs) {
      if (open.has(spec.adapter)) continue;
      try {
        const listener = deps.native.open({
          port: spec.port, addresses: [...spec.addresses], allow: [...spec.allow],
          maxBytes: deps.limits.maxDatagramBytes, perSecond: deps.limits.perSecond, burst: deps.limits.burst,
          queue: deps.limits.queueLength, repliesPerMinute: deps.limits.repliesPerMinute
        });
        const entry: Open = { spec, listener, closed: false };
        open.set(spec.adapter, entry);
        failed.delete(spec.adapter);
        void pump(spec.adapter, entry);
      } catch (error) {
        // The listener's refusals are fixed words; anything else is said as
        // the general case, never as its text (QGD-LOG-0001).
        const word = error instanceof Error && /^[a-z-]{1,16}$/.test(error.message) ? error.message : '';
        failed.set(spec.adapter, openRefusal(word, spec.port));
      }
    }
    state();
  }

  function ports(): PortState[] {
    const out: PortState[] = [];
    for (const [adapter, entry] of open) {
      const stats = entry.listener.stats();
      const dropped = Object.fromEntries(DROP_REASONS.map(reason => [reason, 0])) as Record<DropReason, number>;
      for (const drop of stats.dropped) if ((DROP_REASONS as readonly string[]).includes(drop.reason)) dropped[drop.reason] = drop.count;
      out.push({
        adapter, listening: true, bound: [...entry.listener.bound], received: stats.received, dropped,
        heard: stats.heard.map(entry => ({ address: entry.address, at: new Date(entry.at).toISOString() }))
      });
    }
    for (const [adapter, reason] of failed) {
      out.push({ adapter, listening: false, bound: [], reason, received: 0, dropped: Object.fromEntries(DROP_REASONS.map(reason => [reason, 0])) as Record<DropReason, number>, heard: [] });
    }
    return out.sort((a, b) => a.adapter.localeCompare(b.adapter));
  }

  // Said when it changed, and only then.
  function state(): void {
    if (stopped) return;
    const now = ports();
    const text = JSON.stringify(now);
    if (text === said) return;
    said = text;
    deps.post({ type: 'ports', ports: now });
  }

  function reply(adapter: string, to: string, bytes: Uint8Array): void {
    const entry = open.get(adapter);
    let outcome = 'closed';
    if (entry) {
      try {
        entry.listener.reply(to, bytes);
        outcome = 'sent';
      } catch (error) {
        outcome = error instanceof Error && /^[a-z-]{1,16}$/.test(error.message) ? error.message : 'failed';
      }
    }
    deps.post({ type: 'replied', adapter, to, outcome });
  }

  const timer = setInterval(state, STATE_MS);
  timer.unref?.();

  return {
    // A message from the broker, checked before it is acted on.
    receive(raw: unknown): void {
      const message = parseToIntegrations(raw);
      if (!message || stopped) return;
      if (message.type === 'listen') listen(message.specs);
      else if (message.type === 'reply') reply(message.adapter, message.to, message.bytes);
      else stop();
    },
    ports,
    stop
  };

  function stop(): void {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    for (const adapter of [...open.keys()]) close(adapter);
    deps.post({ type: 'closed' });
  }
}

export type Integrations = ReturnType<typeof createIntegrations>;
