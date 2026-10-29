// SPDX-License-Identifier: GPL-3.0-only
// The broker's side of Integrations (QGD-INT-0004 to QGD-INT-0011,
// QGD-INT-0020, QGD-INT-0021).
//
// No Electron here: the process, the extension host and the settings are
// passed in, so every decision below runs under unit tests. What it decides:
//
// - which ports are open: one per adapter that is on and holds its grant,
//   on the address and port the operator chose, and none otherwise
//   (QGD-INT-0004, QGD-INT-0005);
// - who may send: this computer alone on loopback, the operator's list on a
//   network, and never anyone (QGD-INT-0006);
// - where what arrives goes: an adapter's datagrams to that adapter alone,
//   its events, checked and stamped with its id, to every consumer that is
//   on (QGD-INT-0008, QGD-INT-0021);
// - what Integrations' page shows (QGD-INT-0010).
import type { IntegrationEvent, DeliveredEvent } from '../extension-api/integration-events.js';
import type { IntegrationContribution } from '../extension-api/manifest.js';
import { deliveryGrant } from '../extension-api/api-contract.js';

const RECEIVE_GRANT = deliveryGrant('datagrams');
const EVENTS_GRANT = deliveryGrant('events');
import type { ToExtension } from '../extension-host/protocol.js';
import {
  DROP_REASONS, type DropReason, type FromIntegrations, type ListenSpec, type PortState, type ToIntegrations
} from '../integrations/integration-contract.js';
import type { AdapterSettings } from './settings-contract.js';

// This computer, as an address to listen on and as the senders allowed
// there (QGD-INT-0005, QGD-INT-0006).
export const LOOPBACK: readonly string[] = ['127.0.0.1', '::1'];

// The most sources kept per adapter for the page, newest kept.
const MAX_SOURCES = 16;
// How long a reply waits for Integrations to say it was sent.
export const REPLY_WAIT_MS = 2_000;

export interface NetworkInterface {
  readonly name: string;
  readonly addresses: readonly string[];
}

export interface HubExtension {
  readonly id: string;
  readonly name: string;
  readonly grants: readonly string[];
  readonly integration?: IntegrationContribution;
}

export interface HubDeps {
  extensions(): readonly HubExtension[];
  isOn(id: string): boolean;
  holds(id: string, grant: string): boolean;
  settings(): Readonly<Record<string, AdapterSettings>>;
  // The computer's own network interfaces, as the operating system says,
  // without loopback: the choices for listening on a network.
  interfaces(): readonly NetworkInterface[];
  // To Integrations' process.
  send(message: ToIntegrations): void;
  // To an extension, through the extension host (supervisor.deliver).
  // `allowed` is asked again just before it is posted (supervisor.deliver).
  deliver(id: string, message: Extract<ToExtension, { type: 'datagrams' | 'events' }>, allowed: () => boolean): Promise<boolean>;
  // The page's view changed.
  changed(): void;
  now(): number;
  log: { warn(fields: Record<string, unknown>, message: string): void };
}

export type ProcessState = 'not started' | 'running' | 'restarting' | 'stopped';

export interface AdapterView {
  readonly id: string;
  readonly name: string;
  readonly program: string;
  // On: the extension is on and holds its grant. Only then is its port open.
  readonly on: boolean;
  readonly transport: string;
  readonly usualPort: number;
  readonly port: number;
  // The interface it listens on by name, or null for this computer alone.
  readonly network: string | null;
  readonly allow: readonly string[];
  readonly listening: boolean;
  readonly bound: readonly string[];
  readonly reason?: string;
  readonly received: number;
  readonly dropped: Readonly<Record<DropReason | 'malformed', number>>;
  // Each allowed sender heard, and when (ISO 8601 UTC).
  readonly heard: readonly { readonly address: string; readonly at: string }[];
  // The program's instances heard, by their own name (QGD-INT-0011).
  readonly sources: readonly { readonly name: string; readonly at: string }[];
}

export interface IntegrationsView {
  readonly process: ProcessState;
  readonly adapters: readonly AdapterView[];
  readonly interfaces: readonly NetworkInterface[];
}

const zero = (): Record<DropReason, number> => Object.fromEntries(DROP_REASONS.map(reason => [reason, 0])) as Record<DropReason, number>;

// A refusal from the listener, in words for the operator.
export function replyRefusal(word: string): string | undefined {
  switch (word) {
    case 'sent': return undefined;
    case 'not-heard': return 'That sender has not been heard from recently.';
    case 'over-rate': return 'Too many replies to that sender; wait a minute.';
    case 'too-large': return 'That reply is larger than a datagram may be.';
    case 'closed': return 'This adapter is not listening.';
    default: return 'The reply could not be sent.';
  }
}

export function createIntegrationsHub(deps: HubDeps) {
  let host: ProcessState = 'not started';
  let ports: readonly PortState[] = [];
  let said = '';
  const malformed = new Map<string, number>();
  const sources = new Map<string, Map<string, number>>();
  const replies = new Map<string, ((outcome: string) => void)[]>();

  const adapters = () => deps.extensions().filter(extension => extension.integration !== undefined);
  const consumers = () => deps.extensions().filter(extension =>
    extension.grants.includes(EVENTS_GRANT) && deps.isOn(extension.id) && deps.holds(extension.id, EVENTS_GRANT));
  const isOn = (extension: HubExtension) => deps.isOn(extension.id) && deps.holds(extension.id, RECEIVE_GRANT);

  // What the operator set, or the program's usual port on this computer.
  function chosen(extension: HubExtension): AdapterSettings {
    return deps.settings()[extension.id] ?? { port: extension.integration!.port, network: null, allow: [] };
  }

  // The port an adapter asks for, or why it has none.
  function specOf(extension: HubExtension): ListenSpec | string {
    const setting = chosen(extension);
    if (setting.network === null) return { adapter: extension.id, port: setting.port, addresses: [...LOOPBACK], allow: [...LOOPBACK] };
    const found = deps.interfaces().find(entry => entry.name === setting.network);
    if (!found || found.addresses.length === 0) return `The network "${setting.network}" is not connected.`;
    return { adapter: extension.id, port: setting.port, addresses: found.addresses.slice(0, 8), allow: [...setting.allow] };
  }

  // Every port that should be open, said whole (integration-contract.ts).
  function reconcile(): void {
    const specs = adapters().filter(isOn).map(specOf).filter((spec): spec is ListenSpec => typeof spec !== 'string');
    deps.send({ type: 'listen', specs });
    // An adapter turned off loses what it had heard; turned on, it starts afresh.
    for (const extension of adapters()) {
      if (isOn(extension)) continue;
      malformed.delete(extension.id);
      sources.delete(extension.id);
    }
    publish();
  }

  function view(): IntegrationsView {
    return {
      process: host,
      interfaces: deps.interfaces(),
      adapters: adapters().map((extension): AdapterView => {
        const setting = chosen(extension);
        const on = isOn(extension);
        const port = on ? ports.find(entry => entry.adapter === extension.id) : undefined;
        const spec = on ? specOf(extension) : undefined;
        const reason = typeof spec === 'string' ? spec : port?.reason ?? (on && !port ? 'Starting.' : undefined);
        const heardSources = [...(sources.get(extension.id) ?? new Map<string, number>())]
          .sort((a, b) => b[1] - a[1]).map(([name, at]) => ({ name, at: new Date(at).toISOString() }));
        return {
          id: extension.id, name: extension.name, program: extension.integration!.program, on,
          transport: extension.integration!.transport, usualPort: extension.integration!.port,
          port: setting.port, network: setting.network, allow: [...setting.allow],
          listening: port?.listening ?? false, bound: port?.bound ?? [],
          ...(reason !== undefined ? { reason } : {}),
          received: port?.received ?? 0,
          dropped: { ...(port?.dropped ?? zero()), malformed: malformed.get(extension.id) ?? 0 },
          heard: port?.heard ?? [], sources: heardSources
        };
      })
    };
  }

  // Said when it changed, and only then.
  function publish(): void {
    const text = JSON.stringify(view());
    if (text === said) return;
    said = text;
    deps.changed();
  }

  // The interfaces an adapter on a network listens by, as they were last
  // looked at: a network that connects after the start, or a new address
  // from DHCP, is listened on again (Codex review, 2026-10-29).
  let seen = '';
  const watching = () => adapters().some(extension => isOn(extension) && chosen(extension).network !== null);

  return {
    reconcile,
    view,
    // Whether any adapter listens on a network, so the interfaces are worth
    // looking at.
    watching,
    // Looked at now: when they changed, the ports are made to match them.
    interfacesChanged(): boolean {
      const now = JSON.stringify(deps.interfaces());
      if (now === seen) return false;
      seen = now;
      if (!watching()) return false;
      reconcile();
      return true;
    },
    // Integrations' process started, or stopped and is coming back: told
    // the ports again, whole, when it starts.
    processState(state: ProcessState): void {
      host = state;
      if (state !== 'running') {
        ports = [];
        for (const [, waiting] of replies) for (const settle of waiting) settle('closed');
        replies.clear();
      }
      if (state === 'running') reconcile();
      else publish();
    },
    // A message from Integrations' process, already checked by the broker.
    received(message: FromIntegrations): void {
      if (message.type === 'ports') { ports = message.ports; publish(); return; }
      if (message.type === 'datagrams') {
        // Its own datagrams, to the adapter they were opened for, while it
        // is on: one turned off between the read and here is given none.
        const extension = adapters().find(entry => entry.id === message.adapter);
        if (!extension || !isOn(extension)) return;
        void deps.deliver(extension.id, { type: 'datagrams', datagrams: message.datagrams }, () => isOn(extension));
        return;
      }
      if (message.type === 'replied') {
        const key = `${message.adapter} ${message.to}`;
        const waiting = replies.get(key);
        const settle = waiting?.shift();
        if (waiting?.length === 0) replies.delete(key);
        settle?.(message.outcome);
      }
    },
    // An adapter's events (extension-serve.ts): `adapter` is the channel's
    // identity. Each is stamped with it and goes to every consumer that is
    // on; the count is of consumers.
    events(adapter: string, events: readonly IntegrationEvent[], dropped: number): number {
      const extension = adapters().find(entry => entry.id === adapter);
      if (!extension || !isOn(extension)) return 0;
      if (dropped > 0) malformed.set(adapter, (malformed.get(adapter) ?? 0) + dropped);
      const now = deps.now();
      const heard = sources.get(adapter) ?? new Map<string, number>();
      for (const event of events) heard.set(event.source, now);
      // The newest kept: a source unheard the longest goes first.
      while (heard.size > MAX_SOURCES) {
        const oldest = [...heard].sort((a, b) => a[1] - b[1])[0][0];
        heard.delete(oldest);
      }
      sources.set(adapter, heard);
      publish();
      if (events.length === 0) return 0;
      const stamped: DeliveredEvent[] = events.map(event => ({ ...event, adapter }));
      const to = consumers();
      const consuming = (id: string) => consumers().some(consumer => consumer.id === id);
      for (const consumer of to) void deps.deliver(consumer.id, { type: 'events', events: stamped }, () => consuming(consumer.id));
      return to.length;
    },
    // An adapter's one reply; a sentence when refused.
    reply(adapter: string, to: string, bytes: Uint8Array): Promise<string | undefined> {
      const extension = adapters().find(entry => entry.id === adapter);
      if (!extension || !isOn(extension) || host !== 'running') return Promise.resolve(replyRefusal('closed'));
      const key = `${adapter} ${to}`;
      return new Promise(settle => {
        const timer = setTimeout(() => {
          const waiting = replies.get(key);
          const at = waiting?.indexOf(done) ?? -1;
          if (waiting && at >= 0) waiting.splice(at, 1);
          settle('Integrations did not answer in time.');
        }, REPLY_WAIT_MS);
        function done(outcome: string) { clearTimeout(timer); settle(replyRefusal(outcome)); }
        replies.set(key, [...(replies.get(key) ?? []), done]);
        deps.send({ type: 'reply', adapter, to, bytes });
      });
    }
  };
}

export type IntegrationsHub = ReturnType<typeof createIntegrationsHub>;
