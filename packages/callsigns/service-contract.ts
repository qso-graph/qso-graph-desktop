// SPDX-License-Identifier: GPL-3.0-only
// What a service profile is, with nothing that reads a file.
//
// Separate from packages/callsigns/services.ts because the renderer is told about services
// and must not import a module that touches the file system: the renderer's
// tsconfig has no Node types, and pulling `node:fs/promises` into it through
// a type import is how a screen ends up depending on something it can never
// call. The reading and the checking are services.ts's; the shapes are here,
// and both sides import these.
// The three kinds of thing a service asks for. They are the credential core's
// own three — a username that is shown, and two secrets that are not — so a
// register naming a fourth is a register this product cannot store for.
export const FIELD_NAMES = ['username', 'password', 'api_key'] as const;
export type FieldName = (typeof FIELD_NAMES)[number];

export interface ServiceField {
  name: FieldName;
  label: string;
  secret: boolean;
  required: boolean;
}

export interface ServiceProfile {
  id: string;
  name: string;
  what: string;
  site: string;
  howToGet: string;
  fields: ServiceField[];
  // QGD-PSN-0006, answered outright by every service. `known: false` with a
  // reason is an answer; a missing key is a register that forgot to answer.
  //
  // Nothing this product stores today has an expiry it can read — the LoTW
  // credential it keeps is the web account, not ARRL's PKCS#12 certificate —
  // so `known: true` is refused until there is a credential to read a date
  // out of and a way to read it.
  expiry: { known: false; why: string };
  // QGD-PSN-0005: a service either has a test or says it has none, and both
  // answers carry a sentence. A service with no test says why there is none,
  // because "no test" with no reason reads as an oversight rather than as the
  // fact it is — and an operator deciding whether to trust a saved credential
  // is owed the difference.
  //
  // The credential core is the authority on which exists: it either has an
  // implementation or it does not. This says what it does, or why it does
  // not, and the credential-editing suite holds the two to each other.
  test: { what: string } | { none: string };
}

export interface ServiceRegister {
  services: ServiceProfile[];
}

// What the renderer is told about a service: all of it. There is no secret in
// a profile — the fields' labels and the instructions are the whole point of
// sending it — and saying so here is why this is a name rather than a second
// shape.
export type ServiceSummary = ServiceProfile;
