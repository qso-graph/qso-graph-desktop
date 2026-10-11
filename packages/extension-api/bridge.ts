// SPDX-License-Identifier: GPL-3.0-only
// How an extension calls the core.
//
// This is the whole of what `extension-api` offers a page: one function, taking a
// typed request and returning a typed reply. QGD-APP-0002 — an extension
// reaches the core through here and nowhere else, and a built-in application
// uses it exactly as a contributed one would (D-33).
//
// The bridge is a named function the preload exposed (QGD-SEC-0007); there is
// no `ipcRenderer` here and no channel the caller chooses. What crosses is a
// value, not a reference (QGD-APP-0003), which is what lets a later Part move
// an extension into its own process by changing the transport alone.
import type { ExtensionReply, ExtensionRequest } from './api-contract.js';

// Re-exported so an extension has one import. QGD-REP-0006 holds it to
// `extension-api` and `ui`; making it reach for two files of this package to make
// one call would be friction with no purpose.
export type {
  ExtensionInfo, ExtensionReply, ExtensionRequest, PersonaBrief, RequestKind
} from './api-contract.js';

// Read off the window through a local shape rather than by augmenting the
// global one.
//
// There is exactly one declaration of `window.extensions` and it belongs to the
// renderer, which also has `inventory` on it — the channel Settings uses to
// list the extensions (QGD-APP-0012). Declaring the global here as well
// collided with that, and widening this one to match would advertise
// `inventory` to every application. An extension has no business
// enumerating the others, so what it is given a type for is `request`.
interface ExtensionBridge {
  request(extension: unknown, command: unknown): Promise<unknown>;
}

function bridgeOf(): ExtensionBridge | undefined {
  return (globalThis as { extensions?: ExtensionBridge }).extensions;
}

// Shaped so a refusal is an ordinary answer rather than an exception: a grant
// that has been withdrawn is a normal thing for an extension to be told
// (QGD-APP-0011), and code that has to wrap every call in a try block ends up
// not handling it.
// Rebuilt as a plain value before it crosses, field by field.
//
// QGD-APP-0003 says what crosses is a value and not a reference, and this is
// the line where that stops being a principle and starts being code. An
// application built with Svelte holds its state in a Proxy, and a Proxy cannot
// be structure-cloned over IPC: the first version of this passed the object
// through and every call made from a component's own state failed with "An
// object could not be cloned" — while the same request written as a literal
// worked, which is a difference no application author should have to know
// about.
//
// Constructed per kind rather than copied, so what crosses is exactly the
// contract's fields and nothing an extension happened to attach. The core
// validates it again on arrival (QGD-SEC-0006); this is not a substitute for
// that, it is what makes the call possible at all.
//
// Values are copied, never converted. An earlier version ran each through
// String(), which turned an off-contract value into one the core's validator
// accepts: `persona: 123` became the valid persona name "123", and could have
// selected that persona's credential instead of being refused. Rejected rather
// than coerced is the rule (QGD-SEC-0006), and coercing here would have been
// this file quietly breaking it on the core's behalf. Found in review.
//
// Building a new object is all that was ever needed for the Proxy: reading a
// primitive off a proxy yields a primitive.
// Returns `unknown`, not `ExtensionRequest`: what crosses is for the core to
// validate, and typing it as valid here would be this file asserting something
// it has not checked. The core is the validator (QGD-SEC-0006).
export function plainRequest(request: ExtensionRequest): unknown {
  switch (request.kind) {
    case 'extension.info':
    case 'persona.list':
      return { kind: request.kind };
    case 'source.fetch':
      return { kind: request.kind, source: request.source };
    case 'service.request': {
      // An invalid container crosses as it is.
      //
      // `request.parameters ?? {}` turned `null`, a number or an array into an
      // empty object — so a malformed request became one the core accepts,
      // which is coercion in the one place that must not do it. Only a plain
      // object is rebuilt; anything else is handed over untouched and refused
      // on arrival. Found in review.
      const container: unknown = request.parameters;
      const rebuilt =
        typeof container === 'object' && container !== null && !Array.isArray(container)
          ? Object.fromEntries(Object.entries(container))
          : container;
      return {
        kind: request.kind,
        service: request.service,
        persona: request.persona,
        operation: request.operation,
        parameters: rebuilt
      };
    }
  }
}

export async function callApp(extension: string, request: ExtensionRequest): Promise<ExtensionReply> {
  const bridge = bridgeOf();
  if (!bridge) {
    return { ok: false, error: 'The extension API is not available in this window.' };
  }
  const reply = await bridge.request(extension, plainRequest(request));
  if (typeof reply !== 'object' || reply === null || typeof (reply as { ok?: unknown }).ok !== 'boolean') {
    // The core always answers in the contract's shape. Anything else is not
    // coerced into one (QGD-SEC-0006).
    return { ok: false, error: 'The core answered something this application cannot read.' };
  }
  return reply as ExtensionReply;
}
