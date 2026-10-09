// SPDX-License-Identifier: GPL-3.0-only
// P6-services-are-data, P6-one-list and P6-expiry (QGD-PSN-0002,
// QGD-PSN-0003, QGD-PSN-0005, QGD-PSN-0006).
//
// The point of the register is that adding a service is a data change. The
// tests that matter here are therefore the two directions of that: a service
// added to the register is accepted with no code change, and a service taken
// out of it stops being accepted. Everything else is the shape checks that
// stop a damaged or hand-edited register from reaching an operator as a form
// with the wrong fields in it.
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { validateCommand } from '../src/persona-contract.js';
import {
  allServiceIds, FIELD_NAMES, RegisterError, serviceIds, validateRegister, type ServiceRegister
} from '../src/services.js';

const text = await readFile('data/service-profiles.json', 'utf8');
const shipped = validateRegister(JSON.parse(text));

// A register built here, so a case can be made that the shipped one does not
// happen to have.
const made = (...services: unknown[]) => validateRegister({ services });
const service = (overrides: Record<string, unknown> = {}) => ({
  id: 'example', name: 'Example', what: 'A service', site: 'https://example.invalid/',
  howToGet: 'Ask them',
  needsCredential: true,
  fields: [{ name: 'username', label: 'User', secret: false, required: true }],
  expiry: { known: false, why: 'Nothing about this example credential expires on a date' },
  test: { none: 'This example service has no test, and this is why there is none' },
  ...overrides
});

describe('QGD-PSN-0003 what the register ships with', () => {
  it('holds the seven Release 1 services and nothing else', () => {
    expect(shipped.services.map(entry => entry.id))
      .toEqual(['qrz', 'qrz_logbook', 'eqsl', 'lotw', 'hamqth', 'clublog', 'pota']);
  });

  it('says which of them need a credential, and POTA does not', () => {
    // QGD-PSN-0003. POTA is identified by the persona's callsign, and this
    // product never signs in to it (QGD-PSN-0012), so it is in the register
    // and asks for nothing.
    expect(shipped.services.filter(entry => !entry.needsCredential).map(entry => entry.id))
      .toEqual(['pota']);
    const pota = shipped.services.find(entry => entry.id === 'pota')!;
    expect(pota.fields, 'a service needing no credential asks for no fields').toEqual([]);
    expect('none' in pota.test, 'and offers no test, because nothing is stored').toBe(true);
  });

  it('refuses a credential command for a service that holds none', () => {
    // The set a command is held to is the credential-holding services, so
    // POTA is refused exactly like a service that is not in the register.
    const ids = serviceIds(shipped);
    expect(ids.has('pota')).toBe(false);
    expect(validateCommand({ type: 'test-credential', persona: 'home', provider: 'pota' }, ids)).toBe(false);
    expect(validateCommand(
      { type: 'save-credentials', persona: 'home', provider: 'pota', credentials: { password: 'x' } },
      ids)).toBe(false);
    // And it is still a service the screens know about.
    expect(allServiceIds(shipped).has('pota')).toBe(true);
  });

  it('tells the operator what each service is and how to get a credential', () => {
    for (const entry of shipped.services) {
      expect(entry.name.length, entry.id).toBeGreaterThan(2);
      expect(entry.what.length, entry.id).toBeGreaterThan(10);
      // Shown, and possibly opened with shell.openExternal (QGD-SEC-0009).
      expect(entry.site.startsWith('https://'), entry.id).toBe(true);
      expect(entry.howToGet.length, entry.id).toBeGreaterThan(20);
    }
  });

  it('says of every service whether it can be tested, and why not (QGD-PSN-0005)', () => {
    for (const entry of shipped.services) {
      const answer = 'what' in entry.test ? entry.test.what : entry.test.none;
      expect(answer.length, entry.id).toBeGreaterThan(20);
    }
    // Two have a test today and four do not, and the four say why rather than
    // leaving a null for a reader to interpret. The credential-editing suite
    // is what holds this to the core, which is the authority on which exist.
    expect(shipped.services.filter(entry => 'what' in entry.test).map(entry => entry.id))
      .toEqual(['qrz', 'qrz_logbook']);
    expect(shipped.services.filter(entry => 'none' in entry.test).map(entry => entry.id))
      .toEqual(['eqsl', 'lotw', 'hamqth', 'clublog', 'pota']);
  });

  it('says of every service whether its credential expires (QGD-PSN-0006)', () => {
    for (const entry of shipped.services) {
      // Today every answer is "no expiry this product can read", and each
      // gives its reason. Nothing this product stores carries a date: the
      // LoTW credential it keeps is the web account, not ARRL's certificate.
      expect(entry.expiry.known, entry.id).toBe(false);
      expect(entry.expiry.why.length, entry.id).toBeGreaterThan(20);
    }
    const lotw = shipped.services.find(entry => entry.id === 'lotw')!;
    expect(lotw.expiry.why, "LoTW's reason has to name the thing it is not holding")
      .toContain('certificate');
  });

  it('asks only for things the credential core can store', () => {
    for (const entry of shipped.services) {
      for (const field of entry.fields) {
        expect(FIELD_NAMES).toContain(field.name);
        // The core shows a username and never shows the other two.
        expect(field.secret, `${entry.id}.${field.name}`).toBe(field.name !== 'username');
      }
    }
  });
});

describe('QGD-PSN-0002 a service is a data change, not a code change', () => {
  const extended: ServiceRegister = validateRegister({
    services: [
      ...JSON.parse(text).services,
      {
        id: 'newservice', name: 'A New Service', what: 'Something this product has never heard of',
        site: 'https://new.invalid/', howToGet: 'Sign up and ask for a key, which takes a day',
        needsCredential: true,
        fields: [{ name: 'api_key', label: 'Their key', secret: true, required: true }],
        expiry: { known: false, why: 'Their key is valid until it is replaced, with no date on it' },
        test: { what: 'Asks the service whether the key works' }
      }
    ]
  });

  it('accepts a command for a service the register gained, with no code change', () => {
    const ids = serviceIds(extended);
    expect(validateCommand(
      { type: 'save-credentials', persona: 'home', provider: 'newservice', credentials: { apiKey: 'x' } },
      ids)).toBe(true);
    expect(validateCommand({ type: 'test-credential', persona: 'home', provider: 'newservice' }, ids)).toBe(true);
  });

  it('refuses the same command against the register that does not hold it', () => {
    // The other direction, which is what makes the first mean something: the
    // acceptance above came from the register and not from the code.
    expect(validateCommand(
      { type: 'save-credentials', persona: 'home', provider: 'newservice', credentials: { apiKey: 'x' } },
      serviceIds(shipped))).toBe(false);
  });

  it('refuses a service the register has lost', () => {
    const without = validateRegister({
      services: JSON.parse(text).services.filter((entry: { id: string }) => entry.id !== 'clublog')
    });
    expect(validateCommand({ type: 'test-credential', persona: 'home', provider: 'clublog' }, serviceIds(shipped)))
      .toBe(true);
    expect(validateCommand({ type: 'test-credential', persona: 'home', provider: 'clublog' }, serviceIds(without)))
      .toBe(false);
  });

  it('carries the new service’s own fields and test, not the shipped ones', () => {
    const added = extended.services.find(entry => entry.id === 'newservice')!;
    expect(added.fields.map(field => field.name)).toEqual(['api_key']);
    expect('what' in added.test && added.test.what).toContain('key works');
  });
});

describe('a register that is damaged or hand-edited is refused', () => {
  it('refuses a register with no services', () => {
    expect(() => validateRegister({ services: [] })).toThrow(RegisterError);
    expect(() => validateRegister({})).toThrow(/holds no services/);
    expect(() => validateRegister(null)).toThrow(/not an object/);
  });

  it('refuses a service with no id, a bad id, or an id twice', () => {
    expect(() => made(service({ id: '' }))).toThrow(/id is missing/);
    expect(() => made(service({ id: 'Not An Id' }))).toThrow(/not a service id/);
    expect(() => made(service(), service())).toThrow(/appears twice/);
  });

  it('refuses a field the credential core cannot store', () => {
    expect(() => made(service({
      fields: [{ name: 'certificate', label: 'A file', secret: true, required: true }]
    }))).toThrow(/not something the credential core stores/);
  });

  it('refuses a field that lies about being a secret', () => {
    // The register decides what is drawn on screen. A password marked
    // "secret: false" would be shown (QGD-CRD-0006).
    expect(() => made(service({
      fields: [{ name: 'password', label: 'Password', secret: false, required: true }]
    }))).toThrow(/password is a secret/);
    expect(() => made(service({
      fields: [{ name: 'username', label: 'User', secret: true, required: true }]
    }))).toThrow(/username is not a secret/);
  });

  it('refuses a service that requires nothing, or asks for nothing', () => {
    expect(() => made(service({
      fields: [{ name: 'username', label: 'User', secret: false, required: false }]
    }))).toThrow(/requires nothing/);
    expect(() => made(service({ fields: [] }))).toThrow(/asks for no fields/);
  });

  it('refuses a register that cannot say whether a service needs a credential', () => {
    const { needsCredential, ...without } = service();
    expect(needsCredential).toBe(true);
    expect(() => made(without)).toThrow(/does not say whether it needs a credential/);
  });

  it('refuses a credential-free service that asks for something anyway', () => {
    // Either it needs a credential or it asks for nothing. A service that
    // asks for a password it never stores would put a field on screen that
    // goes nowhere.
    expect(() => made(service({ needsCredential: false })))
      .toThrow(/needs no credential and asks for 1 field/);
  });

  it('refuses a credential-free service that offers a test', () => {
    expect(() => made(service({
      needsCredential: false, fields: [], test: { what: 'Asks them whether it works' }
    }))).toThrow(/there is nothing to test/);
  });

  it('refuses a service that does not say whether it can be tested', () => {
    const { test, ...withoutTest } = service();
    expect('none' in test).toBe(true);
    expect(() => made(withoutTest)).toThrow(/does not say whether it can be tested/);
    expect(() => made(service({ test: null }))).toThrow(/does not say whether it can be tested/);
  });

  it('refuses a service that both describes a test and says it has none', () => {
    expect(() => made(service({ test: { what: 'Asks them', none: 'There is none' } })))
      .toThrow(/either describe a test or say why there is none/);
    expect(() => made(service({ test: {} })))
      .toThrow(/either describe a test or say why there is none/);
  });

  it('refuses a site that is not https', () => {
    expect(() => made(service({ site: 'http://example.invalid/' }))).toThrow(/not https/);
    expect(() => made(service({ site: 'javascript:alert(1)' }))).toThrow(/not https/);
  });

  it('refuses a service that does not answer the expiry question', () => {
    const { expiry, ...withoutExpiry } = service();
    expect(expiry.known).toBe(false);
    expect(() => made(withoutExpiry)).toThrow(/does not say whether its credential expires/);
  });

  it('refuses a register that claims an expiry nothing here can read', () => {
    // The product holds no credential with a date in it. A register saying
    // otherwise would have the status show an expiry nobody computed.
    expect(() => made(service({ expiry: { known: true, why: 'it has a certificate' } })))
      .toThrow(/claims an expiry this product cannot read/);
  });

  it('refuses the same field asked for twice', () => {
    expect(() => made(service({
      fields: [
        { name: 'password', label: 'One', secret: true, required: true },
        { name: 'password', label: 'Two', secret: true, required: false }
      ]
    }))).toThrow(/twice/);
  });
});
