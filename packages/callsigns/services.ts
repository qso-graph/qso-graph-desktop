// SPDX-License-Identifier: GPL-3.0-only
// Reading the register of services a callsign can hold a credential for.
//
// QGD-PSN-0002: what a service needs is data, not branches. This reads
// data/service-profiles.json and checks it; everything else — the command
// validation, the setup screens, the per-service test — asks this rather than
// holding a list of its own. A service added to the register appears with its
// own fields and its own test and no code change.
//
// The register is read and validated rather than imported and trusted. It
// ships inside the application, so a file that has been edited is a file
// somebody edited on purpose or a file that was damaged, and either way the
// product has to know which fields it is about to ask an operator to fill in
// (QGD-SEC-0006: validated, never coerced).
//
// The shapes are packages/callsigns/service-contract.ts, which the renderer imports and this
// does not re-declare.
import { readFile } from 'node:fs/promises';
import {
  FIELD_NAMES,
  type FieldName, type ServiceField, type ServiceProfile, type ServiceRegister, type ServiceSummary
} from './service-contract.js';

export { FIELD_NAMES };
export type { FieldName, ServiceField, ServiceProfile, ServiceRegister, ServiceSummary };

export class RegisterError extends Error {}

function fail(what: string): never {
  throw new RegisterError(`data/service-profiles.json: ${what}`);
}

function string(value: unknown, where: string, maximum = 400): string {
  if (typeof value !== 'string' || value.trim() === '') fail(`${where} is missing`);
  if ((value as string).length > maximum) fail(`${where} is longer than ${maximum} characters`);
  return value as string;
}

export function validateRegister(parsed: unknown): ServiceRegister {
  if (typeof parsed !== 'object' || parsed === null) fail('is not an object');
  const services = (parsed as { services?: unknown }).services;
  if (!Array.isArray(services) || services.length === 0) fail('holds no services');

  const seen = new Set<string>();
  const checked = services.map((entry, at) => {
    if (typeof entry !== 'object' || entry === null) fail(`service ${at + 1} is not an object`);
    const service = entry as Record<string, unknown>;
    const id = string(service.id, `service ${at + 1}'s id`, 64);
    // The id becomes part of a Keychain account name and is spliced into
    // nothing else, but it is still an identifier this product builds, so it
    // is held to the shape identifiers have here.
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(id)) fail(`"${id}" is not a service id this accepts`);
    if (seen.has(id)) fail(`"${id}" appears twice`);
    seen.add(id);

    if (!Array.isArray(service.fields) || service.fields.length === 0) {
      fail(`"${id}" asks for no fields`);
    }
    const fieldNames = new Set<string>();
    const fields = service.fields.map(raw => {
      if (typeof raw !== 'object' || raw === null) fail(`"${id}" has a field that is not an object`);
      const field = raw as Record<string, unknown>;
      const name = string(field.name, `a field name in "${id}"`, 32);
      if (!(FIELD_NAMES as readonly string[]).includes(name)) {
        fail(`"${id}" asks for "${name}", which is not something the credential core stores`);
      }
      if (fieldNames.has(name)) fail(`"${id}" asks for "${name}" twice`);
      fieldNames.add(name);
      if (typeof field.secret !== 'boolean') fail(`"${id}".${name} does not say whether it is a secret`);
      if (typeof field.required !== 'boolean') fail(`"${id}".${name} does not say whether it is required`);
      // The core shows a username and never shows the other two. A register
      // that disagrees would have a secret drawn on screen or a username
      // treated as one.
      const isSecret = name !== 'username';
      if (field.secret !== isSecret) {
        fail(`"${id}".${name} says secret: ${field.secret}; ${name} is ${isSecret ? '' : 'not '}a secret`);
      }
      return {
        name: name as FieldName,
        label: string(field.label, `"${id}".${name}'s label`, 80),
        secret: field.secret,
        required: field.required
      };
    });
    if (!fields.some(field => field.required)) fail(`"${id}" requires nothing, so there is nothing to save`);

    if (typeof service.test !== 'object' || service.test === null) {
      fail(`"${id}" does not say whether it can be tested`);
    }
    const testOf = service.test as Record<string, unknown>;
    const describes = 'what' in testOf;
    const explains = 'none' in testOf;
    if (describes === explains) {
      fail(`"${id}"'s test must either describe a test or say why there is none, and not both`);
    }
    const test = describes
      ? { what: string(testOf.what, `"${id}"'s test description`) }
      : { none: string(testOf.none, `"${id}"'s reason for having no test`) };

    if (typeof service.expiry !== 'object' || service.expiry === null) {
      fail(`"${id}" does not say whether its credential expires`);
    }
    const expiryOf = service.expiry as Record<string, unknown>;
    if (typeof expiryOf.known !== 'boolean') fail(`"${id}"'s expiry does not say whether it is known`);
    if (expiryOf.known) {
      // Refused rather than believed: there is nothing in this product that
      // can read an expiry out of a credential, so a register claiming one
      // would have the status show a date nobody computed.
      fail(`"${id}" claims an expiry this product cannot read; no stored credential carries a date`);
    }
    const expiry = { known: false as const, why: string(expiryOf.why, `"${id}"'s reason for having no expiry`) };

    return {
      id,
      name: string(service.name, `"${id}"'s name`, 80),
      what: string(service.what, `"${id}"'s description`),
      site: siteOf(service.site, id),
      howToGet: string(service.howToGet, `"${id}"'s instructions`, 800),
      fields,
      expiry,
      test
    };
  });

  return { services: checked };
}

// A service's own site, which is shown to the operator and may be opened with
// shell.openExternal — so it is HTTPS and nothing else (QGD-SEC-0009).
function siteOf(value: unknown, id: string): string {
  const site = string(value, `"${id}"'s site`, 200);
  if (!site.startsWith('https://')) fail(`"${id}"'s site is not https://`);
  return site;
}

export async function readServices(path: string): Promise<ServiceRegister> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error instanceof RegisterError) throw error;
    throw new RegisterError(`${path} could not be read: ${(error as Error).message.slice(0, 120)}`);
  }
  return validateRegister(parsed);
}

export function serviceIds(register: ServiceRegister): Set<string> {
  return new Set(register.services.map(service => service.id));
}

export function summarise(register: ServiceRegister): ServiceSummary[] {
  return register.services;
}
