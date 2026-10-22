// SPDX-License-Identifier: GPL-3.0-only
// The extension API itself (QGD-APP-0003): what an extension may send, what comes
// back, and which grant each request needs.
//
// **Messages, not functions.** Every call is a value that is validated on
// arrival and rejected rather than coerced (QGD-SEC-0006), and nothing the
// frame hands back is a live reference into the core. That is the one
// requirement here that could not be added later: D-2 commits this project to
// sandboxing the contributed and unofficial tiers, and an API of function
// calls would have to be redesigned to be sandboxed — by which time there
// would be extensions written against it. Written this way now, moving an
// application into its own process changes the transport and leaves the API
// alone.
//
// The surface is small because it is as large as the extensions that exist.
// A request kind arrives with the extension that needs it, not in advance:
// an unused surface is a surface nobody has exercised, and every kind here is
// gated and tested.

export type ExtensionRequest =
  // What am I and what do I hold. No grant: an extension is always allowed
  // to know what it was given, and showing it is how QGD-APP-0012's Settings
  // page and an extension's own "why can I not do this" agree.
  | { readonly kind: 'extension.info' }
  // The callsigns the operator has, so an extension can ask which to act as.
  // Each one's id, call and description only — never a credential
  // (QGD-CRD-0010).
  | { readonly kind: 'callsign.list' }
  // Which callsign is active, or none. Under the same grant as the list,
  // because it is the same information (QGD-CRD-0010).
  | { readonly kind: 'callsign.active' }
  // Where the operator is operating from: the active station's name, grid and
  // position, or none (QGD-STN-0005, QGD-HOM-0009). Never its street, city or
  // postal code, which stay on this machine and out of every extension
  // (QGD-STN-0003).
  | { readonly kind: 'station.active' }
  // Search ADIF's own definitions, its fields and every enumeration's values,
  // as the frame loaded them (KI7MT, 2026-10-22: ADIF Lookup). The frame
  // searches reference.sqlite and answers with ADIF's text; the extension
  // never opens a store (QGD-APP-0009).
  | { readonly kind: 'adif.search'; readonly query: string }
  // Fetch from a registered source. The extension names the source; the URL
  // comes from the register and the connection is the credential core's
  // (QGD-APP-0008, D-18, D-31).
  | { readonly kind: 'source.fetch'; readonly source: string }
  // Act with a credential the operator holds, and return the answer. The
  // secret does not cross this boundary (QGD-APP-0007).
  | {
      readonly kind: 'service.request';
      readonly service: string;
      // The id of the callsign whose credential is used.
      readonly callsign: string;
      readonly operation: string;
      readonly parameters: Readonly<Record<string, string>>;
    };

export type RequestKind = ExtensionRequest['kind'];

export interface ExtensionInfo {
  readonly id: string;
  readonly name: string;
  readonly tier: string;
  readonly version: string;
  // What it actually holds right now, which is not always what it asked for:
  // the operator can withdraw a grant without a restart (QGD-APP-0012).
  readonly grants: readonly string[];
}

// A callsign as an extension sees it. `id` is permanent, and is what a
// service request names; the call and the description may change.
export interface CallsignBrief {
  readonly id: string;
  readonly call: string;
  readonly description: string;
}

// One thing ADIF defines, as the frame answers a search: a field, or a value
// of one of ADIF's enumerations, with ADIF's own columns and nothing added.
export interface AdifEntry {
  readonly list: string;
  readonly key: string;
  readonly columns: readonly { readonly name: string; readonly value: string }[];
}

// The active station as an extension may see it. The position is the
// station's own MY_LAT and MY_LON where it has them, otherwise the centre of
// its grid square, in decimal degrees; absent when it has neither.
export interface StationBrief {
  readonly name: string;
  readonly grid?: string;
  readonly latitude?: number;
  readonly longitude?: number;
}

export type ExtensionReply =
  | { readonly ok: true; readonly kind: 'extension.info'; readonly info: ExtensionInfo }
  | { readonly ok: true; readonly kind: 'callsign.list'; readonly callsigns: readonly CallsignBrief[] }
  | { readonly ok: true; readonly kind: 'callsign.active'; readonly callsign: CallsignBrief | null }
  | { readonly ok: true; readonly kind: 'station.active'; readonly station: StationBrief | null }
  | { readonly ok: true; readonly kind: 'adif.search'; readonly entries: readonly AdifEntry[] }
  | { readonly ok: true; readonly kind: 'source.fetch'; readonly body: string; readonly fresh: boolean }
  | { readonly ok: true; readonly kind: 'service.request'; readonly answer: Readonly<Record<string, string>> }
  // A refusal says which capability was refused, so the core can tell the
  // operator in words and the extension can say why it stopped
  // (QGD-APP-0011). `refused` is present only when a grant was the reason.
  | { readonly ok: false; readonly error: string; readonly refused?: string };

// ---------------------------------------------------------------------------
// The gate.
//
// One function, and the only place where "what does this request need" is
// decided. A request kind with no entry here cannot be served at all, which is
// what stops a kind added later from reaching the core ungated — the
// alternative is a check beside each handler, which is a list somebody has to
// remember to extend, and four gates in this project have gone quiet that way
// (QGD-SEC-0021).
//
// Returned rather than checked here: this package enforces nothing. The core
// is the enforcement point (QGD-CRD-0002), because an extension asking
// itself whether it is allowed is not a permission system.
export function requiredGrant(request: ExtensionRequest): string | undefined {
  switch (request.kind) {
    // Knowing what you hold needs nothing (QGD-APP-0005: an extension with
    // no grants can still draw its page and read its own standing).
    case 'extension.info': return undefined;
    case 'callsign.list': return 'callsign:list';
    case 'callsign.active': return 'callsign:list';
    case 'station.active': return 'station:active';
    case 'adif.search': return 'reference:read';
    case 'source.fetch': return `source:${request.source}`;
    case 'service.request': return `service:${request.service}`;
  }
}

// Every kind the contract has, so a test can prove requiredGrant covers all of
// them rather than the ones somebody thought of.
export const REQUEST_KINDS: readonly RequestKind[] =
  ['extension.info', 'callsign.list', 'callsign.active', 'station.active', 'adif.search', 'source.fetch', 'service.request'];

// ---------------------------------------------------------------------------
// Validation. QGD-SEC-0006: rejected, never coerced.

// A source or service id, and an operation, all arrive from an extension and
// are used to look something up. Bounded and plain, so a name cannot be a path
// or a grant id of its own making.
const NAME = /^[a-z][a-z0-9_-]{0,31}$/;
const OPERATION = /^[a-z][a-z0-9-]{0,31}$/;
// A callsign's id, as the credential core writes one: a version 4 UUID.
const CALLSIGN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export class RequestError extends Error {
  constructor(message: string, readonly field?: string) { super(message); }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCallsignId(value: unknown): value is string {
  return typeof value === 'string' && CALLSIGN_ID.test(value);
}

function parameters(value: unknown): Record<string, string> {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new RequestError('parameters is not an object', 'parameters');
  const out: Record<string, string> = {};
  const keys = Object.keys(value);
  // Bounded, because this is the one part of a request whose shape the
  // application chooses.
  if (keys.length > 16) throw new RequestError('too many parameters', 'parameters');
  for (const key of keys) {
    if (!NAME.test(key)) throw new RequestError(`parameter "${key}" is not a name`, 'parameters');
    const entry = value[key];
    if (typeof entry !== 'string' || entry.length > 512) {
      throw new RequestError(`parameter "${key}" is not a bounded string`, 'parameters');
    }
    out[key] = entry;
  }
  return out;
}

// Each kind's fields, and nothing else.
const FIELDS: Readonly<Record<string, readonly string[]>> = {
  'extension.info': ['kind'],
  'callsign.list': ['kind'],
  'callsign.active': ['kind'],
  'station.active': ['kind'],
  'adif.search': ['kind', 'query'],
  'source.fetch': ['kind', 'source'],
  'service.request': ['kind', 'service', 'callsign', 'operation', 'parameters']
};

export function validateRequest(value: unknown): ExtensionRequest {
  if (!isRecord(value)) throw new RequestError('a request is not an object');
  const { kind } = value;
  if (typeof kind !== 'string') throw new RequestError('a request has no kind', 'kind');
  // A request is exactly its kind's fields: anything more is refused, not
  // dropped (QGD-SEC-0006, found by Turing in review). An own "__proto__" from
  // a parsed message is a field like any other here, and is refused.
  const fields = FIELDS[kind];
  if (fields) {
    const extra = Object.keys(value).find(key => !fields.includes(key));
    if (extra !== undefined) throw new RequestError(`${kind} takes no "${extra}"`, extra);
  }
  const bare = () => ({ kind }) as ExtensionRequest;
  switch (kind) {
    case 'extension.info':
    case 'callsign.list':
    case 'callsign.active':
    case 'station.active':
      return bare();
    case 'adif.search': {
      // Bounded and plain, as a page's text field is (inputs.ts).
      if (typeof value.query !== 'string' || value.query.trim() === '' || value.query.length > 64
        || [...value.query].some(character => character.codePointAt(0)! < 0x20) || /[<>]/.test(value.query)) {
        throw new RequestError('query is not a short plain search', 'query');
      }
      return { kind, query: value.query };
    }
    case 'source.fetch': {
      if (typeof value.source !== 'string' || !NAME.test(value.source)) {
        throw new RequestError('source is not a registered source name', 'source');
      }
      return { kind, source: value.source };
    }
    case 'service.request': {
      if (typeof value.service !== 'string' || !NAME.test(value.service)) {
        throw new RequestError('service is not a service name', 'service');
      }
      if (!isCallsignId(value.callsign)) {
        throw new RequestError('callsign is not a callsign id', 'callsign');
      }
      if (typeof value.operation !== 'string' || !OPERATION.test(value.operation)) {
        throw new RequestError('operation is not an operation name', 'operation');
      }
      return {
        kind,
        service: value.service,
        callsign: value.callsign,
        operation: value.operation,
        parameters: parameters(value.parameters)
      };
    }
    default:
      // Named, so an extension written against a later release gets a
      // sentence rather than silence.
      throw new RequestError(`"${kind}" is not a request this product serves`, 'kind');
  }
}
