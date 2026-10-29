// SPDX-License-Identifier: GPL-3.0-only
// What the window may ask Integrations, and what it is told (QGD-INT-0010).
// Checked on both sides, refused rather than coerced (QGD-SEC-0006).
//
// The window reads what is listening, and sets an adapter's port, the
// network it listens on, and who may send there. Whether an adapter is on
// is its extension's switch, on the extensions channel, and not here.
import { DROP_REASONS, MAX_ALLOWED, isAddress, isPort, isSender } from '../integrations/integration-contract.js';
import { isInterfaceName } from './settings-contract.js';
import type { AdapterView, IntegrationsView } from './integrations-hub.js';

export type { AdapterView, IntegrationsView } from './integrations-hub.js';

export const INTEGRATIONS_CHANNEL = 'integrations:request';
// The view, pushed whenever it changes, so the page never polls.
export const INTEGRATIONS_STATUS_CHANNEL = 'integrations:status';

export type IntegrationsCommand =
  | { readonly type: 'read' }
  | { readonly type: 'set'; readonly adapter: string; readonly port: number; readonly network: string | null; readonly allow: readonly string[] };

export type IntegrationsReply = { readonly ok: true; readonly view: IntegrationsView } | { readonly ok: false; readonly error: string };

const ID = /^[a-z][a-z0-9-]{1,30}$/;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
const exactly = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const plain = (value: unknown, limit: number) => typeof value === 'string' && value.length > 0 && value.length <= limit && !/[<>]/.test(value);
const count = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;
const time = (value: unknown) => typeof value === 'string' && !Number.isNaN(Date.parse(value));

export function validateIntegrationsCommand(value: unknown): value is IntegrationsCommand {
  if (!record(value)) return false;
  if (value.type === 'read') return exactly(value, ['type']);
  if (value.type !== 'set' || !exactly(value, ['type', 'adapter', 'port', 'network', 'allow'])) return false;
  return typeof value.adapter === 'string' && ID.test(value.adapter) && isPort(value.port)
    && (value.network === null || isInterfaceName(value.network))
    && Array.isArray(value.allow) && value.allow.length <= MAX_ALLOWED && value.allow.every(isAddress)
    && new Set(value.allow).size === value.allow.length;
}

function isAdapterView(value: unknown): value is AdapterView {
  if (!record(value)) return false;
  const keys = ['id', 'name', 'program', 'on', 'transport', 'usualPort', 'port', 'network', 'allow', 'listening', 'bound', 'received', 'dropped', 'heard', 'sources'];
  if (!(exactly(value, keys) || exactly(value, [...keys, 'reason']))) return false;
  return typeof value.id === 'string' && ID.test(value.id) && plain(value.name, 64) && plain(value.program, 40)
    && typeof value.on === 'boolean' && value.transport === 'udp' && isPort(value.usualPort) && isPort(value.port)
    && (value.network === null || isInterfaceName(value.network))
    && Array.isArray(value.allow) && value.allow.length <= MAX_ALLOWED && value.allow.every(isAddress)
    && typeof value.listening === 'boolean' && Array.isArray(value.bound) && value.bound.length <= 8 && value.bound.every(isSender)
    && (value.reason === undefined || plain(value.reason, 200)) && count(value.received)
    && record(value.dropped) && exactly(value.dropped, [...DROP_REASONS, 'malformed'])
    && [...DROP_REASONS, 'malformed'].every(reason => count((value.dropped as Record<string, unknown>)[reason]))
    && Array.isArray(value.heard) && value.heard.length <= MAX_ALLOWED
    && value.heard.every(entry => record(entry) && exactly(entry, ['address', 'at']) && isAddress(entry.address) && time(entry.at))
    && Array.isArray(value.sources) && value.sources.length <= 16
    && value.sources.every(entry => record(entry) && exactly(entry, ['name', 'at']) && plain(entry.name, 64) && time(entry.at));
}

export function isIntegrationsView(value: unknown): value is IntegrationsView {
  if (!record(value) || !exactly(value, ['process', 'adapters', 'interfaces'])) return false;
  return ['not started', 'running', 'restarting', 'stopped'].includes(value.process as string)
    && Array.isArray(value.adapters) && value.adapters.length <= 16 && value.adapters.every(isAdapterView)
    && Array.isArray(value.interfaces) && value.interfaces.length <= 32
    && value.interfaces.every(entry => record(entry) && exactly(entry, ['name', 'addresses']) && isInterfaceName(entry.name)
      && Array.isArray(entry.addresses) && entry.addresses.length <= 16 && entry.addresses.every(isAddress));
}

export function isIntegrationsReply(value: unknown): value is IntegrationsReply {
  if (!record(value)) return false;
  if (value.ok === true) return exactly(value, ['ok', 'view']) && isIntegrationsView(value.view);
  return value.ok === false && exactly(value, ['ok', 'error']) && plain(value.error, 200);
}
