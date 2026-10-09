// SPDX-License-Identifier: GPL-3.0-only
// The grants an application may ask for (QGD-APP-0006).
//
// The set is closed and it is data: data/app-grants.json. This module reads
// and validates it and knows nothing else — no grant name is written here,
// because a second list is a list that will disagree with the first. The same
// rule the service register follows (QGD-PSN-0002), for the same reason.
//
// Nothing in this package imports another package (QGD-REP-0006): it is the
// contract an application is written against, and a surface that imported the
// frame's own contracts would hand an application the frame's internals
// through its own types.

export interface Grant {
  readonly id: string;
  readonly what: string;
  readonly notWhat?: string;
  // Whether the operator has to allow it, or whether declaring it is enough.
  // Reading reference data the frame already loaded asks nothing of anybody;
  // acting with a credential does.
  readonly needsOperator: boolean;
}

export interface GrantRegister {
  readonly register: string;
  readonly note: string;
  readonly grants: readonly Grant[];
}

// A grant id is `area:name`, both lower-case: an id is written into a manifest
// by hand and read in a refusal message, so the shape is fixed rather than
// whatever a contributor typed.
const GRANT_ID = /^[a-z]+:[a-z0-9-]+$/;

export class RegisterError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateGrantRegister(value: unknown): GrantRegister {
  if (!isRecord(value)) throw new RegisterError('The grant register is not an object.');
  if (!Array.isArray(value.grants)) throw new RegisterError('The grant register has no grants.');
  if (value.grants.length === 0) throw new RegisterError('The grant register is empty.');
  const seen = new Set<string>();
  const grants = value.grants.map((entry, at) => {
    if (!isRecord(entry)) throw new RegisterError(`Grant ${at} is not an object.`);
    const { id, what, notWhat, needsOperator } = entry;
    if (typeof id !== 'string' || !GRANT_ID.test(id)) {
      throw new RegisterError(`Grant ${at} has no well-formed id; a grant is "area:name".`);
    }
    if (seen.has(id)) throw new RegisterError(`"${id}" is in the grant register twice.`);
    seen.add(id);
    // Every grant says what it permits, in a sentence an operator is shown
    // when they are asked to allow it. A grant with no explanation cannot be
    // put to anybody (QGD-APP-0012).
    if (typeof what !== 'string' || what.trim().length < 20) {
      throw new RegisterError(`"${id}" does not say what it permits.`);
    }
    if (notWhat !== undefined && typeof notWhat !== 'string') {
      throw new RegisterError(`"${id}" has a malformed limit.`);
    }
    if (typeof needsOperator !== 'boolean') {
      throw new RegisterError(`"${id}" does not say whether the operator has to allow it.`);
    }
    return { id, what, ...(notWhat === undefined ? {} : { notWhat }), needsOperator };
  });
  if (typeof value.register !== 'string' || typeof value.note !== 'string') {
    throw new RegisterError('The grant register has no description.');
  }
  return { register: value.register, note: value.note, grants };
}

export function grantIds(register: GrantRegister): ReadonlySet<string> {
  return new Set(register.grants.map(grant => grant.id));
}

export function findGrant(register: GrantRegister, id: string): Grant | undefined {
  return register.grants.find(grant => grant.id === id);
}
