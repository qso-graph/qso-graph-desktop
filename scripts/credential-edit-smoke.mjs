// SPDX-License-Identifier: GPL-3.0-only
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { enableTestKeychain } from './keychain-service.mjs';

// Fixtures go to this product's test Keychain service, never beside a real
// credential, and are swept on exit (QGD-CRD-0003). Called before the core is
// loaded, because the service name is read when an entry is made.
enableTestKeychain();
const require = createRequire(import.meta.url);
const { CallsignCore } = require('../dist/native/persona.node');
const directory = await mkdtemp(join(tmpdir(), 'qg-credential-edit-'));
const core = new CallsignCore(directory);
// The callsigns' ids, which the core chooses.
let id;
let other;
let untouched;
const password = `QG_FAKE_CREDENTIAL_${randomUUID()}`;
const apiKey = `QG_FAKE_CREDENTIAL_${randomUUID()}`;
function check(ok, name) { if (!ok) throw new Error(`${name} failed; values omitted.`); }
try {
  id = core.create('W1AW', 'qg-test', undefined, undefined).id;
  const missingTest = core.testCredential(id, 'qrz');
  check(missingTest.outcome === 'missing' && Object.keys(missingTest).join(',') === 'outcome', 'Safe missing-credential test result');
  core.saveCredentials(id, 'qrz_logbook', { username: 'W1AW', password });
  core.saveCredentials(id, 'qrz_logbook', { apiKey });
  let status = core.credentialStatus(id, 'qrz_logbook');
  check(status.hasPassword && status.hasApiKey && status.effective === 'api_key', 'Merge and service default');
  check(core.requireCredential(id, 'qrz_logbook').password === apiKey, 'Default selection');
  core.setPreference(id, 'qrz_logbook', 'password');
  const reopened = new CallsignCore(directory);
  check(reopened.credentialStatus(id, 'qrz_logbook').preferred === 'password', 'Persisted preference');
  check(reopened.requireCredential(id, 'qrz_logbook').password === password, 'Preferred password selection');
  check(reopened.requireCredential(id, 'qrz_logbook', 'api_key').password === apiKey, 'Explicit trusted preference');
  check(core.credentialStatus(id, 'qrz').preferred === 'service', 'Per-service preference isolation');
  core.removeSecret(id, 'qrz_logbook', 'password');
  status = core.credentialStatus(id, 'qrz_logbook');
  check(!status.hasPassword && status.hasApiKey && status.effective === 'api_key', 'Remove only password and fall back');
  check(core.requireCredential(id, 'qrz_logbook').password === apiKey, 'Actual fallback selection');
  core.saveCredentials(id, 'qrz_logbook', { password });
  core.removeSecret(id, 'qrz_logbook', 'api_key');
  status = core.credentialStatus(id, 'qrz_logbook');
  check(status.hasPassword && !status.hasApiKey, 'Remove only API key');
  check(core.requireCredential(id, 'qrz_logbook').password === password, 'Remaining password preserved');
  core.removeSecret(id, 'qrz_logbook', 'password');
  check(!core.credentialStatus(id, 'qrz_logbook').stored, 'Last secret removes Keychain entry');
  core.saveCredentials(id, 'qrz_logbook', { username: 'W1AW', password, apiKey });
  core.saveCredentials(id, 'eqsl', { username: 'W1AW', password });
  check(core.testCredential(id, 'eqsl').outcome === 'unsupported', 'Unsupported service never claims validation');
  core.saveCredentials(id, 'legacy_provider', { username: 'W1AW', password });
  other = core.create('K1ABC', 'qg-test', undefined, undefined).id;
  core.saveCredentials(other, 'qrz_logbook', { username: 'K1ABC', apiKey });
  core.setActive(id);
  // Kept to put back below, so the Keychain can be asked about this id again.
  const record = JSON.parse(await readFile(join(directory, 'callsigns.json'), 'utf8')).callsigns[id];
  core.removeCallsign(id);
  check(!core.list().some(entry => entry.id === id) && core.active() === null, 'Callsign and active marker removed');
  check(core.requireCredential(other, 'qrz_logbook').password === apiKey, 'Other callsign credential preserved');
  // The removed callsign's record, put back with nothing recorded against it:
  // its id is the only thing an entry is named by, so the Keychain is asked
  // about exactly the entries the removal had to delete. A new callsign would
  // have a new id and prove nothing.
  {
    const index = JSON.parse(await readFile(join(directory, 'callsigns.json'), 'utf8'));
    index.callsigns[id] = { ...record, providers: {} };
    await writeFile(join(directory, 'callsigns.json'), JSON.stringify(index, null, 2));
  }
  for (const provider of ['qrz_logbook', 'eqsl', 'legacy_provider']) {
    check(!core.credentialStatus(id, provider).stored, 'Associated Keychain entry deleted');
  }
  check(core.credentialStatus(id, 'qrz_logbook').preferred === 'service', 'Removed callsign preference cleared');
  for (const filename of ['callsigns.json', 'desktop-preferences.json']) {
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
  // A callsign of its own, with nothing saved against it: what is being shown
  // is that testability is a fact about the service, not about what is stored.
  untouched = core.create('W1AW/3', 'qg-test', undefined, undefined).id;
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

  console.log('Credential editing and callsign deletion: merge, independent removal, preference, fallback, cascade and isolation: PASS');
  console.log(`The register and the core agree about which of the ${register.services.length} services can be tested: PASS`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally {
  for (const name of [id, other, untouched].filter(Boolean)) {
    if (core.list().some(entry => entry.id === name)) core.removeCallsign(name);
  }
  await rm(directory, { recursive: true, force: true });
}
