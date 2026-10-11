// SPDX-License-Identifier: GPL-3.0-only
import type { ServiceSummary } from './service-contract.js';
export interface Persona {
  name: string;
  callsign: string;
  start?: string | null;
  end?: string | null;
  providers: Record<string, { username: string }>;
}
export interface Snapshot { personas: Persona[]; active: string | null }
// Imported and re-exported so the renderer has one import for everything it
// is told about a service. The shape itself is packages/personas/services.ts's, which is
// where the register is read and checked.
export type { ServiceSummary };
export interface CredentialStatus { testable: boolean; stored: boolean; kindsKnown: boolean; hasUsername: boolean; hasPassword: boolean; hasApiKey: boolean; preferred: 'service' | 'password' | 'api_key'; effective?: 'password' | 'api_key' | null }
export interface CredentialTest { outcome: 'success' | 'rejected' | 'network-error' | 'rate-limited' | 'invalid-response' | 'missing' | 'unsupported' }
// The sealed file on its way from the core to the broker. It never reaches a
// renderer: the broker writes it where the operator chose and replies with
// ExportResult instead.
export interface SealedExport { bytes: Uint8Array }
// A reference source's answer, on its way back from the credential core.
export interface FetchedReference {
  fresh: boolean;
  body: Uint8Array;
  etag: string | null;
  lastModified: string | null;
}
// What an export did, for the operator to read. The path is shown because the
// operator chose it; nothing else about the file is.
export interface ExportResult { written: string; bytes: number }
// What an import would do, or did. Counts and names, never a value.
export interface ImportPreview { created: string; personas: number; credentials: number; arriving: string[]; overwritten: string[] }
export interface ImportResult { personas: number; credentials: number }
export type PersonaCommand =
  | { type: 'list' }
  // The services this product can hold a credential for, with the fields and
  // the instructions for each (QGD-PSN-0002). The screens draw themselves
  // from this rather than from anything written into the renderer.
  | { type: 'services' }
  | { type: 'upsert'; name: string; callsign: string; start?: string; end?: string }
  | { type: 'set-active'; name: string }
  | { type: 'remove-persona'; name: string }
  | { type: 'status'; persona: string; provider: string }
  | { type: 'test-credential'; persona: string; provider: string }
  | { type: 'delete-credentials'; persona: string; provider: string }
  | { type: 'remove-secret'; persona: string; provider: string; field: 'password' | 'api_key' }
  | { type: 'set-preference'; persona: string; provider: string; preferred: 'service' | 'password' | 'api_key' }
  | { type: 'save-credentials'; persona: string; provider: string; credentials: { username?: string; password?: string; apiKey?: string } }
  // Moving personas between machines (QGD-PSN-0007 to QGD-PSN-0011). The
  // passphrase travels the same path a credential already does — collected by
  // the renderer, held by nothing, forwarded to the core. The file itself does
  // not: the main process shows the dialog and reads or writes the bytes, so
  // the renderer never touches an export.
  | { type: 'export-personas'; passphrase: string }
  | { type: 'import-personas'; passphrase: string; apply: boolean };
// What a service lookup answers (QGD-APP-0007). Its own outcome set, not the
// credential test's: a lookup can come back "not-found", which is an answer
// about a callsign rather than anything about the credential, and
// "invalid-request", which is the core refusing a callsign it will not send.
export const LOOKUP_OUTCOMES = [
  'success', 'not-found', 'rejected', 'missing',
  'network-error', 'rate-limited', 'invalid-response', 'invalid-request', 'unsupported'
] as const;
export type LookupOutcome = (typeof LOOKUP_OUTCOMES)[number];

export interface LookupAnswer {
  outcome: LookupOutcome;
  // As the service sent them. Displayable in full (QGD-PII-0007); what may be
  // persisted is a named allowlist, which is the caller's rule to keep.
  fields: { name: string; value: string }[];
}

export type PersonaReply =
  | {
      ok: true;
      data: Snapshot | CredentialStatus | CredentialTest | ServiceSummary[]
        | SealedExport | FetchedReference | ExportResult | ImportPreview | ImportResult
          | LookupAnswer | null;
    }
  | { ok: false; error: string };

// The only page allowed to reach the broker, and the only frame of it.
export const RENDERER_URL = 'qg://desktop/index.html';
export function allowsSender(senderFrame: unknown, mainFrame: unknown, url: string | undefined): boolean {
  return senderFrame !== undefined && senderFrame !== null && senderFrame === mainFrame && url === RENDERER_URL;
}

// The services are no longer named here. QGD-PSN-0002 and QGD-PSN-0003 put
// them in data/service-profiles.json, which is the only place a service is
// named — so this takes the allowed set from its caller, who read the
// register. A list kept here as well would be the second list that drifts.
export type Services = ReadonlySet<string>;
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, allowed: string[]): boolean { return Object.keys(value).every(key => allowed.includes(key)); }
// Rejecting control characters means naming them; that is the check.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f]/;
function text(value: unknown, maximum = 128): value is string { return typeof value === 'string' && value.length > 0 && value.length <= maximum && !CONTROL.test(value); }
// A passphrase is a secret the operator types. Bounded like the other
// secrets, and never defaulted: an empty one is refused here as well as in the
// core, because an export with no passphrase is not written (QGD-PSN-0007).
function passphrase(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 4096;
}
function date(value: unknown): boolean { return value === undefined || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)); }

export function validateCommand(value: unknown, providers: Services): value is PersonaCommand {
  if (!record(value)) return false;
  switch (value.type) {
    case 'list':
    case 'services': return keys(value, ['type']);
    case 'upsert': return keys(value, ['type', 'name', 'callsign', 'start', 'end']) && text(value.name) && text(value.callsign, 64) && date(value.start) && date(value.end);
    case 'set-active':
    case 'remove-persona': return keys(value, ['type', 'name']) && text(value.name);
    case 'status':
    case 'test-credential':
    case 'delete-credentials': return keys(value, ['type', 'persona', 'provider']) && text(value.persona) && typeof value.provider === 'string' && providers.has(value.provider);
    case 'remove-secret': return keys(value, ['type', 'persona', 'provider', 'field']) && text(value.persona) && typeof value.provider === 'string' && providers.has(value.provider) && ['password', 'api_key'].includes(value.field as string);
    case 'set-preference': return keys(value, ['type', 'persona', 'provider', 'preferred']) && text(value.persona) && typeof value.provider === 'string' && providers.has(value.provider) && ['service', 'password', 'api_key'].includes(value.preferred as string);
    // A passphrase is a secret the operator types, so it is bounded the way
    // the other secrets are and nothing else travels with it.
    case 'export-personas':
      return keys(value, ['type', 'passphrase']) && passphrase(value.passphrase);
    case 'import-personas':
      return keys(value, ['type', 'passphrase', 'apply'])
        && passphrase(value.passphrase) && typeof value.apply === 'boolean';
    case 'save-credentials': {
      if (!keys(value, ['type', 'persona', 'provider', 'credentials']) || !text(value.persona) || typeof value.provider !== 'string' || !providers.has(value.provider) || !record(value.credentials) || !keys(value.credentials, ['username', 'password', 'apiKey'])) return false;
      return Object.values(value.credentials).every(item => item === undefined || (typeof item === 'string' && item.length <= 4096));
    }
    default: return false;
  }
}

// QGD-SEC-0006, in the other direction: a reply arriving from the utility
// process is checked before it is handed to whoever is waiting, rather than
// asserted to be what it should be.
export function isReply(value: unknown): value is PersonaReply {
  if (!record(value)) return false;
  if (value.ok === true) return 'data' in value;
  return value.ok === false && typeof value.error === 'string';
}

// What the broker sends the service, which is what the renderer sent plus the
// one thing the renderer must not have: the bytes of a file.
//
// An import's file is chosen and read by the main process, because a renderer
// that could hand over a file could hand over any file, and because an export
// is a thing on disk rather than a thing on a screen (QGD-PSN-0011). So the
// two commands differ by exactly that field, and both ends validate the shape
// they actually receive rather than trusting the one before them
// (QGD-SEC-0006).
export type ServiceCommand =
  | Exclude<PersonaCommand, { type: 'import-personas' }>
  | { type: 'import-personas'; passphrase: string; apply: boolean; file: Uint8Array }
  // Fetching reference data, which the credential core does because KI7MT
  // decided all outbound HTTPS goes through it (D-18, D-31). It is not a
  // PersonaCommand: a renderer may not ask this product to fetch a URL, and
  // validateCommand — which is what the renderer's requests are held to —
  // does not accept it.
  | { type: 'fetch-reference'; url: string; etag?: string; lastModified?: string }
  // Acting with a stored credential on an application's behalf, and returning
  // the answer (QGD-APP-0007). Not a PersonaCommand either, and for the same
  // reason: a renderer may not ask this product to use a credential directly.
  // An application reaches it only through the extension API, with a service grant
  // the operator allowed, and the secret never comes back — only the result.
  | {
      type: 'service-lookup';
      service: string;
      persona: string;
      operation: string;
      parameters: Record<string, string>;
    };

export function validateServiceCommand(value: unknown, providers: Services): value is ServiceCommand {
  if (!record(value)) return false;
  if (value.type === 'service-lookup') {
    if (!keys(value, ['type', 'service', 'persona', 'operation', 'parameters'])) return false;
    // The service must be one the register holds, the same set every other
    // command is held to (QGD-PSN-0003). A grant named a service; this checks
    // the service exists.
    if (typeof value.service !== 'string' || !providers.has(value.service)) return false;
    if (typeof value.persona !== 'string' || value.persona === '' || value.persona.length > 64) return false;
    if (typeof value.operation !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(value.operation)) return false;
    if (!record(value.parameters)) return false;
    const entries = Object.entries(value.parameters);
    if (entries.length > 16) return false;
    return entries.every(([key, parameter]) =>
      /^[a-z][a-z0-9_-]{0,31}$/.test(key) && typeof parameter === 'string' && parameter.length <= 512);
  }
  if (value.type === 'fetch-reference') {
    return keys(value, ['type', 'url', 'etag', 'lastModified'])
      // HTTPS is checked here, in the core, and in the caller. It is the one
      // property of a destination this product will not take on trust.
      && typeof value.url === 'string' && value.url.startsWith('https://') && value.url.length <= 2048
      && (value.etag === undefined || (typeof value.etag === 'string' && value.etag.length <= 256))
      && (value.lastModified === undefined
        || (typeof value.lastModified === 'string' && value.lastModified.length <= 256));
  }
  if (value.type === 'import-personas') {
    return keys(value, ['type', 'passphrase', 'apply', 'file'])
      && passphrase(value.passphrase)
      && typeof value.apply === 'boolean'
      // Bounded before it reaches the core, which bounds it again.
      && value.file instanceof Uint8Array && value.file.length > 0 && value.file.length <= 4_194_304;
  }
  return validateCommand(value, providers);
}
