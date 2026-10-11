// SPDX-License-Identifier: GPL-3.0-only
// A request rebuilt as a plain value before it is sent. Used by the extension
// host's context.request (QGD-APP-0003): what crosses a message channel is
// structured-cloned, and a value an extension built from Svelte state is a
// Proxy that cannot be. This was the window bridge's job until extensions
// left the renderer (QGD-APP-0015, 2026-10-11); the job is the same.
import type { ExtensionRequest } from './api-contract.js';

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
    case 'persona.active':
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
