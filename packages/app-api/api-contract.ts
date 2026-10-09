// SPDX-License-Identifier: GPL-3.0-only
// The app API itself (QGD-APP-0003): what an application may send, what comes
// back, and which grant each request needs.
//
// **Messages, not functions.** Every call is a value that is validated on
// arrival and rejected rather than coerced (QGD-SEC-0006), and nothing the
// frame hands back is a live reference into the frame. That is the one
// requirement here that could not be added later: D-2 commits this project to
// sandboxing the contributed and unofficial tiers, and an API of function
// calls would have to be redesigned to be sandboxed — by which time there
// would be applications written against it. Written this way now, moving an
// application into its own process changes the transport and leaves the API
// alone.
//
// The surface is small because it is as large as the applications that exist.
// A request kind arrives with the application that needs it, not in advance:
// an unused surface is a surface nobody has exercised, and every kind here is
// gated and tested.

export type AppRequest =
  // What am I and what do I hold. No grant: an application is always allowed
  // to know what it was given, and showing it is how QGD-APP-0012's Settings
  // page and an application's own "why can I not do this" agree.
  | { readonly kind: 'app.info' }
  // The personas the operator has, so an application can ask which to act as.
  // Callsigns and names only — never a credential (QGD-CRD-0010).
  | { readonly kind: 'persona.list' }
  // Fetch from a registered source. The application names the source; the URL
  // comes from the register and the connection is the credential core's
  // (QGD-APP-0008, D-18, D-31).
  | { readonly kind: 'source.fetch'; readonly source: string }
  // Act with a credential the operator holds, and return the answer. The
  // secret does not cross this boundary (QGD-APP-0007).
  | {
      readonly kind: 'service.request';
      readonly service: string;
      readonly persona: string;
      readonly operation: string;
      readonly parameters: Readonly<Record<string, string>>;
    };

export type RequestKind = AppRequest['kind'];

export interface AppInfo {
  readonly id: string;
  readonly name: string;
  readonly tier: string;
  readonly version: string;
  // What it actually holds right now, which is not always what it asked for:
  // the operator can withdraw a grant without a restart (QGD-APP-0012).
  readonly grants: readonly string[];
}

export interface PersonaBrief {
  readonly name: string;
  readonly callsign: string;
}

export type AppReply =
  | { readonly ok: true; readonly kind: 'app.info'; readonly info: AppInfo }
  | { readonly ok: true; readonly kind: 'persona.list'; readonly personas: readonly PersonaBrief[] }
  | { readonly ok: true; readonly kind: 'source.fetch'; readonly body: string; readonly fresh: boolean }
  | { readonly ok: true; readonly kind: 'service.request'; readonly answer: Readonly<Record<string, string>> }
  // A refusal says which capability was refused, so the frame can tell the
  // operator in words and the application can say why it stopped
  // (QGD-APP-0011). `refused` is present only when a grant was the reason.
  | { readonly ok: false; readonly error: string; readonly refused?: string };

// ---------------------------------------------------------------------------
// The gate.
//
// One function, and the only place where "what does this request need" is
// decided. A request kind with no entry here cannot be served at all, which is
// what stops a kind added later from reaching the frame ungated — the
// alternative is a check beside each handler, which is a list somebody has to
// remember to extend, and four gates in this project have gone quiet that way
// (QGD-SEC-0021).
//
// Returned rather than checked here: this package enforces nothing. The frame
// is the enforcement point (QGD-CRD-0002), because an application asking
// itself whether it is allowed is not a permission system.
export function requiredGrant(request: AppRequest): string | undefined {
  switch (request.kind) {
    // Knowing what you hold needs nothing (QGD-APP-0005: an application with
    // no grants can still draw its page and read its own standing).
    case 'app.info': return undefined;
    case 'persona.list': return 'persona:list';
    case 'source.fetch': return `source:${request.source}`;
    case 'service.request': return `service:${request.service}`;
  }
}

// Every kind the contract has, so a test can prove requiredGrant covers all of
// them rather than the ones somebody thought of.
export const REQUEST_KINDS: readonly RequestKind[] =
  ['app.info', 'persona.list', 'source.fetch', 'service.request'];

// ---------------------------------------------------------------------------
// Validation. QGD-SEC-0006: rejected, never coerced.

// A source or service id, and an operation, all arrive from an application and
// are used to look something up. Bounded and plain, so a name cannot be a path
// or a grant id of its own making.
const NAME = /^[a-z][a-z0-9_-]{0,31}$/;
const OPERATION = /^[a-z][a-z0-9-]{0,31}$/;
// A persona name is the operator's own text, so it is bounded and free of
// control characters rather than restricted to a shape.
const PERSONA_MAX = 64;

export class RequestError extends Error {
  constructor(message: string, readonly field?: string) { super(message); }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPersonaName(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0 && value.length <= PERSONA_MAX
    && ![...value].some(character => character.codePointAt(0)! < 0x20);
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

export function validateRequest(value: unknown): AppRequest {
  if (!isRecord(value)) throw new RequestError('a request is not an object');
  const { kind } = value;
  if (typeof kind !== 'string') throw new RequestError('a request has no kind', 'kind');
  switch (kind) {
    case 'app.info':
      return { kind };
    case 'persona.list':
      return { kind };
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
      if (!isPersonaName(value.persona)) {
        throw new RequestError('persona is not a persona name', 'persona');
      }
      if (typeof value.operation !== 'string' || !OPERATION.test(value.operation)) {
        throw new RequestError('operation is not an operation name', 'operation');
      }
      return {
        kind,
        service: value.service,
        persona: value.persona,
        operation: value.operation,
        parameters: parameters(value.parameters)
      };
    }
    default:
      // Named, so an application written against a later release gets a
      // sentence rather than silence.
      throw new RequestError(`"${kind}" is not a request this product serves`, 'kind');
  }
}
