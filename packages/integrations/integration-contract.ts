// SPDX-License-Identifier: GPL-3.0-only
// The messages between the broker and Integrations' process (QGD-INT-0001).
//
// The broker says, whole, which ports should be open: one entry per adapter
// that is on (QGD-INT-0004). Integrations makes it so, and says what it has.
// Sent whole rather than as open and close, so a restarted process is told
// the same thing and ends up the same way, with nothing to replay.
//
// Both directions are checked on arrival: these are our own processes, and
// a message between them is a boundary all the same (QGD-SEC-0006).
import { isAddress, isSender } from '../extension-api/address.js';
export { isAddress, isSender };

// One adapter's port: the port, the addresses it listens on, and who may
// send (QGD-INT-0005, QGD-INT-0006).
export interface ListenSpec {
  readonly adapter: string;
  readonly port: number;
  readonly addresses: readonly string[];
  readonly allow: readonly string[];
}

export type ToIntegrations =
  | { readonly type: 'listen'; readonly specs: readonly ListenSpec[] }
  // The one reply permitted, to a sender the adapter heard (QGD-INT-0009).
  | { readonly type: 'reply'; readonly adapter: string; readonly to: string; readonly bytes: Uint8Array }
  | { readonly type: 'close' };

export const DROP_REASONS = ['not-allowed', 'too-large', 'over-rate', 'queue-full'] as const;
export type DropReason = (typeof DROP_REASONS)[number];

// What one adapter's port is doing (QGD-INT-0010).
export interface PortState {
  readonly adapter: string;
  readonly listening: boolean;
  // The addresses and port bound, as address:port.
  readonly bound: readonly string[];
  // Why it is not listening, in words for the operator.
  readonly reason?: string;
  readonly received: number;
  readonly dropped: Readonly<Record<DropReason, number>>;
  // Each allowed sender, and when it was last heard (ISO 8601 UTC).
  readonly heard: readonly { readonly address: string; readonly at: string }[];
}

export interface WireDatagram {
  readonly from: string;
  readonly bytes: Uint8Array;
}

export type FromIntegrations =
  | { readonly type: 'datagrams'; readonly adapter: string; readonly datagrams: readonly WireDatagram[] }
  | { readonly type: 'ports'; readonly ports: readonly PortState[] }
  // The reply was sent, or why not, in a fixed word.
  | { readonly type: 'replied'; readonly adapter: string; readonly to: string; readonly outcome: 'sent' | string }
  | { readonly type: 'log'; readonly line: string }
  | { readonly type: 'closed' };

// An adapter's id is an extension's (manifest.ts APP_ID).
export const ADAPTER_ID = /^[a-z][a-z0-9-]{1,30}$/;
export const MAX_ADDRESSES = 8;
export const MAX_ALLOWED = 16;
export const MAX_BATCH = 4096;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactly(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const present = Object.keys(value);
  return present.length === keys.length && present.every(key => keys.includes(key));
}


function isAddresses(value: unknown, most: number, least: number): value is readonly string[] {
  return Array.isArray(value) && value.length >= least && value.length <= most && value.every(isAddress)
    && new Set(value).size === value.length;
}

export function isPort(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 1024 && (value as number) <= 65_535;
}

export function isListenSpec(value: unknown): value is ListenSpec {
  return isRecord(value) && exactly(value, ['adapter', 'port', 'addresses', 'allow'])
    && typeof value.adapter === 'string' && ADAPTER_ID.test(value.adapter) && isPort(value.port)
    && isAddresses(value.addresses, MAX_ADDRESSES, 1) && isAddresses(value.allow, MAX_ALLOWED, 0);
}

export function parseToIntegrations(value: unknown): ToIntegrations | undefined {
  if (!isRecord(value)) return undefined;
  switch (value.type) {
    case 'listen': {
      if (!exactly(value, ['type', 'specs']) || !Array.isArray(value.specs) || value.specs.length > 64) return undefined;
      if (!value.specs.every(isListenSpec)) return undefined;
      const adapters = value.specs.map(spec => (spec as ListenSpec).adapter);
      if (new Set(adapters).size !== adapters.length) return undefined;
      return value as ToIntegrations;
    }
    case 'reply':
      return exactly(value, ['type', 'adapter', 'to', 'bytes']) && typeof value.adapter === 'string' && ADAPTER_ID.test(value.adapter)
        && isSender(value.to) && value.bytes instanceof Uint8Array ? value as ToIntegrations : undefined;
    case 'close':
      return exactly(value, ['type']) ? value as ToIntegrations : undefined;
    default:
      return undefined;
  }
}

const isCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

function isPortState(value: unknown): value is PortState {
  if (!isRecord(value) || typeof value.adapter !== 'string' || !ADAPTER_ID.test(value.adapter)) return false;
  if (typeof value.listening !== 'boolean' || !isCount(value.received)) return false;
  if (!Array.isArray(value.bound) || value.bound.length > MAX_ADDRESSES || !value.bound.every(isSender)) return false;
  if (value.reason !== undefined && (typeof value.reason !== 'string' || value.reason.length > 200)) return false;
  if (!isRecord(value.dropped) || !exactly(value.dropped, DROP_REASONS) || !DROP_REASONS.every(reason => isCount((value.dropped as Record<string, unknown>)[reason]))) return false;
  if (!Array.isArray(value.heard) || value.heard.length > MAX_ALLOWED) return false;
  return value.heard.every(entry => isRecord(entry) && exactly(entry, ['address', 'at']) && isAddress(entry.address)
    && typeof entry.at === 'string' && !Number.isNaN(Date.parse(entry.at)));
}

export function parseFromIntegrations(value: unknown): FromIntegrations | undefined {
  if (!isRecord(value)) return undefined;
  switch (value.type) {
    case 'datagrams':
      return exactly(value, ['type', 'adapter', 'datagrams']) && typeof value.adapter === 'string' && ADAPTER_ID.test(value.adapter)
        && Array.isArray(value.datagrams) && value.datagrams.length <= MAX_BATCH
        && value.datagrams.every(entry => isRecord(entry) && exactly(entry, ['from', 'bytes']) && isSender(entry.from) && entry.bytes instanceof Uint8Array)
        ? value as FromIntegrations : undefined;
    case 'ports':
      return exactly(value, ['type', 'ports']) && Array.isArray(value.ports) && value.ports.length <= 64 && value.ports.every(isPortState)
        ? value as FromIntegrations : undefined;
    case 'replied':
      return exactly(value, ['type', 'adapter', 'to', 'outcome']) && typeof value.adapter === 'string' && ADAPTER_ID.test(value.adapter)
        && isSender(value.to) && typeof value.outcome === 'string' && /^[a-z-]{1,16}$/.test(value.outcome) ? value as FromIntegrations : undefined;
    case 'log':
      return exactly(value, ['type', 'line']) && typeof value.line === 'string' ? value as FromIntegrations : undefined;
    case 'closed':
      return exactly(value, ['type']) ? value as FromIntegrations : undefined;
    default:
      return undefined;
  }
}

// What a refusal from the listener means, for the operator (QGD-INT-0010).
// The listener says a fixed word and never the operating system's text.
export function openRefusal(word: string, port: number): string {
  switch (word) {
    case 'not-bound': return `Port ${port} could not be opened. Another program on this computer may be using it.`;
    case 'no-address': return 'No address to listen on was chosen.';
    case 'address': return 'An address to listen on, or a sender, is not an address.';
    default: return 'This port could not be opened.';
  }
}
