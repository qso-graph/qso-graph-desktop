// SPDX-License-Identifier: GPL-3.0-only
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { enableTestKeychain } from './keychain-service.mjs';

// Fixtures go to this product's test Keychain service, never beside a real
// credential, and are swept on exit (QGD-CRD-0003). Called before the core is
// loaded, because the service name is read when an entry is made.
enableTestKeychain();
const require = createRequire(import.meta.url);
const { PersonaCore } = require('../dist/native/persona.node');
const directory = await mkdtemp(join(tmpdir(), 'qg-credential-edit-'));
const core = new PersonaCore(directory);
const persona = `qg-test-${randomUUID()}`;
const other = `qg-test-${randomUUID()}`;
const untouched = `qg-test-${randomUUID()}`;
const password = `QG_FAKE_CREDENTIAL_${randomUUID()}`;
const apiKey = `QG_FAKE_CREDENTIAL_${randomUUID()}`;
function check(ok, name) { if (!ok) throw new Error(`${name} failed; values omitted.`); }
try {
  core.upsert(persona, 'W1AW');
  const missingTest = core.testCredential(persona, 'qrz');
  check(missingTest.outcome === 'missing' && Object.keys(missingTest).join(',') === 'outcome', 'Safe missing-credential test result');
  core.saveCredentials(persona, 'qrz_logbook', { username: 'W1AW', password });
  core.saveCredentials(persona, 'qrz_logbook', { apiKey });
  let status = core.credentialStatus(persona, 'qrz_logbook');
  check(status.hasPassword && status.hasApiKey && status.effective === 'api_key', 'Merge and service default');
  check(core.requireCredential(persona, 'qrz_logbook').password === apiKey, 'Default selection');
  core.setPreference(persona, 'qrz_logbook', 'password');
  const reopened = new PersonaCore(directory);
  check(reopened.credentialStatus(persona, 'qrz_logbook').preferred === 'password', 'Persisted preference');
  check(reopened.requireCredential(persona, 'qrz_logbook').password === password, 'Preferred password selection');
  check(reopened.requireCredential(persona, 'qrz_logbook', 'api_key').password === apiKey, 'Explicit trusted preference');
  check(core.credentialStatus(persona, 'qrz').preferred === 'service', 'Per-service preference isolation');
  core.removeSecret(persona, 'qrz_logbook', 'password');
  status = core.credentialStatus(persona, 'qrz_logbook');
  check(!status.hasPassword && status.hasApiKey && status.effective === 'api_key', 'Remove only password and fall back');
  check(core.requireCredential(persona, 'qrz_logbook').password === apiKey, 'Actual fallback selection');
  core.saveCredentials(persona, 'qrz_logbook', { password });
  core.removeSecret(persona, 'qrz_logbook', 'api_key');
  status = core.credentialStatus(persona, 'qrz_logbook');
  check(status.hasPassword && !status.hasApiKey, 'Remove only API key');
  check(core.requireCredential(persona, 'qrz_logbook').password === password, 'Remaining password preserved');
  core.removeSecret(persona, 'qrz_logbook', 'password');
  check(!core.credentialStatus(persona, 'qrz_logbook').stored, 'Last secret removes Keychain entry');
  core.saveCredentials(persona, 'qrz_logbook', { username: 'W1AW', password, apiKey });
  core.saveCredentials(persona, 'eqsl', { username: 'W1AW', password });
  check(core.testCredential(persona, 'eqsl').outcome === 'unsupported', 'Unsupported service never claims validation');
  core.saveCredentials(persona, 'legacy_provider', { username: 'W1AW', password });
  core.upsert(other, 'K1ABC');
  core.saveCredentials(other, 'qrz_logbook', { username: 'K1ABC', apiKey });
  core.setActive(persona);
  core.removePersona(persona);
  check(!core.list().some(p => p.name === persona) && core.active() === null, 'Persona and active marker removed');
  check(core.requireCredential(other, 'qrz_logbook').password === apiKey, 'Other persona credential preserved');
  core.upsert(persona, 'W1AW');
  for (const provider of ['qrz_logbook', 'eqsl', 'legacy_provider']) {
    check(!core.credentialStatus(persona, provider).stored, 'Associated Keychain entry deleted');
  }
  check(core.credentialStatus(persona, 'qrz_logbook').preferred === 'service', 'Removed persona preference cleared');
  for (const filename of ['personas.json', 'desktop-preferences.json']) {
    const text = await readFile(join(directory, filename), 'utf8');
    check(!text.includes(password) && !text.includes(apiKey), 'No secret in metadata');
  }
  // QGD-PSN-0005: the register says whether a service can be tested, and the
  // core is the authority on whether a test exists — it either has an
  // implementation or it does not. Held to each other here, because a
  // register promising a test the core cannot run is a button that proves
  // nothing, and a core with a test the register calls absent is a capability
  // nobody is offered.
  const register = JSON.parse(await readFile('data/service-profiles.json', 'utf8'));
  // A persona of its own, with nothing saved against it: what is being shown
  // is that testability is a fact about the service, not about what is stored.
  core.upsert(untouched, 'W1AW/3');
  for (const service of register.services) {
    const describes = 'what' in service.test;
    const { testable } = core.credentialStatus(untouched, service.id);
    check(describes === testable,
      `The register and the core agree about testing ${service.id}`);
    // And testability is answered without anything being saved for it, so a
    // screen can say so before the operator presses (QGD-CRD-0011).
    check(!core.credentialStatus(untouched, service.id).stored,
      `Testability for ${service.id} is answered with nothing stored`);
  }
  check(register.services.filter(s => 'what' in s.test).length >= 1,
    'At least one service has a test, or this check is vacuous');
  check(register.services.filter(s => 'none' in s.test).length >= 1,
    'At least one service has none, or this check is vacuous');

  console.log('Credential editing and persona deletion: merge, independent removal, preference, fallback, cascade and isolation: PASS');
  console.log(`The register and the core agree about which of the ${register.services.length} services can be tested: PASS`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally {
  for (const name of [persona, other, untouched]) {
    if (core.list().some(p => p.name === name)) core.removePersona(name);
  }
  await rm(directory, { recursive: true, force: true });
}
