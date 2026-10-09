// SPDX-License-Identifier: GPL-3.0-only
// The services a persona can hold a credential for.
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
import { readFile } from 'node:fs/promises';

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
  // QGD-PSN-0006: a credential that expires says how its expiry is read.
  expires?: { kind: 'pkcs12'; what: string };
  // QGD-PSN-0005: a service either has a test or says it has none. `null`
  // is the saying-so; a missing key is a register that forgot to answer.
  test: { what: string } | null;
}

export interface ServiceRegister {
  services: ServiceProfile[];
}

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

    if (!('test' in service)) fail(`"${id}" does not say whether it can be tested`);
    const test = service.test === null
      ? null
      : { what: string((service.test as Record<string, unknown>)?.what, `"${id}"'s test description`) };

    let expires: ServiceProfile['expires'];
    if (service.expires !== undefined) {
      const kind = string((service.expires as Record<string, unknown>)?.kind, `"${id}"'s expiry kind`, 32);
      if (kind !== 'pkcs12') fail(`"${id}" expires by "${kind}", which this product cannot read`);
      expires = { kind, what: string((service.expires as Record<string, unknown>)?.what, `"${id}"'s expiry note`) };
    }

    return {
      id,
      name: string(service.name, `"${id}"'s name`, 80),
      what: string(service.what, `"${id}"'s description`),
      site: siteOf(service.site, id),
      howToGet: string(service.howToGet, `"${id}"'s instructions`, 800),
      fields,
      ...(expires ? { expires } : {}),
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

// What the renderer is told about a service. Everything in the register except
// nothing — there is no secret in it, and the fields' labels and instructions
// are the whole point of sending it (QGD-CRD-0006 is not at stake here, and
// saying so is why this function exists rather than the register being passed
// around by three different shapes).
export type ServiceSummary = ServiceProfile;

export function summarise(register: ServiceRegister): ServiceSummary[] {
  return register.services;
}
