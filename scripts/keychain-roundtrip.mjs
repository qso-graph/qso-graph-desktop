// SPDX-License-Identifier: GPL-3.0-only
// QGD-PRT-0100: the core loads in Node and round-trips a credential through the
// macOS Keychain. Rust only — Python is out of P0 (KI7MT, 2026-10-07).
//
// Every operation here is performed by the process that wrote the entry, so no
// cross-application authorization is involved and the suite runs unattended.
// The keyring naming convention (QGD-CRD-0003) is checked by a metadata-only
// lookup, which needs no authorization and reveals no secret.
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const { PersonaCore } = require('../dist/native/persona.node');
const directory = await mkdtemp(join(tmpdir(), 'qg-persona-roundtrip-'));
const core = new PersonaCore(directory);
const persona = `qg-test-${randomUUID()}`;
const other = `qg-test-${randomUUID()}`;
const provider = 'qrz_logbook';
const password = `QG_FAKE_CREDENTIAL_${randomUUID()}`;
const apiKey = `QG_FAKE_CREDENTIAL_${randomUUID()}`;
const replacement = `QG_FAKE_CREDENTIAL_${randomUUID()}`;
const secrets = [password, apiKey, replacement];
function check(result, name) { if (!result) throw new Error(`${name} failed; credential values omitted.`); }

try {
  core.upsert(persona, 'w1aw', '2026-01-01', undefined);
  core.upsert(other, 'k1abc', undefined, undefined);
  core.saveCredentials(persona, provider, { username: 'W1AW', password, apiKey });

  // The credential written through the core comes back through the core.
  const stored = core.requireCredential(persona, provider);
  check(stored.username === 'W1AW' && stored.password === apiKey, 'Credential round-trip');

  // A replacement supersedes the stored value; the other field is retained.
  core.saveCredentials(persona, provider, { apiKey: replacement });
  check(core.requireCredential(persona, provider).password === replacement, 'Credential replacement');
  check(core.requireCredential(persona, provider, 'password').password === password, 'Retained password');

  // QGD-CRD-0003: the entry is named by the convention, not a library default.
  const name = spawnSync('/usr/bin/security',
    ['find-generic-password', '-s', 'adif-mcp', '-a', `${persona}:${provider}`],
    { encoding: 'utf8', timeout: 30_000 });
  check(name.status === 0, 'Keyring naming convention');
  check(!secrets.some(secret => `${name.stdout || ''}`.includes(secret)), 'No secret in entry metadata');

  check(!core.credentialStatus(other, provider).stored, 'Persona credential isolation');
  const status = core.credentialStatus(persona, provider);
  check(status.stored && status.hasApiKey && status.hasPassword, 'Credential status');
  check(Object.keys(status).sort().join(',') === 'effective,hasApiKey,hasPassword,hasUsername,kindsKnown,preferred,stored', 'No secret in status API');
  check(status.kindsKnown, 'Status knows what it holds when it wrote it');

  core.setActive(persona.toUpperCase());
  check(core.active() === persona, 'Case-insensitive active persona');

  const index = await readFile(join(directory, 'personas.json'), 'utf8');
  check(!secrets.some(secret => index.includes(secret)), 'No secret in persona index');

  // QGD-CRD-0010: an index written before the kinds were recorded. The entry
  // is in the Keychain; the index says only who the username is, which is what
  // every credential saved before this change looks like. Status must not
  // report that as holding neither secret — that is a claim, not an absence of
  // information — and must not decrypt the entry to find out.
  {
    const before = JSON.parse(await readFile(join(directory, 'personas.json'), 'utf8'));
    const reference = before.personas[persona].providers[provider];
    before.personas[persona].providers[provider] = { username: reference.username };
    await writeFile(join(directory, 'personas.json'), JSON.stringify(before, null, 2));

    const legacy = core.credentialStatus(persona, provider);
    check(legacy.stored, 'A legacy entry is still reported as stored');
    check(!legacy.kindsKnown, 'A legacy entry reports that its kinds are unknown');
    check(!legacy.hasPassword && !legacy.hasApiKey, 'A legacy entry claims neither kind');

    // And it repairs itself the first time something with a reason to decrypt
    // it does. Nothing decrypts anything in order to repair it.
    core.requireCredential(persona, provider, null);
    const repaired = core.credentialStatus(persona, provider);
    check(repaired.kindsKnown, 'Reading the credential records what it holds');
    check(repaired.hasPassword && repaired.hasApiKey, 'The repaired status is the true one');
  }

  check(core.deleteCredentials(persona, provider) && !core.credentialStatus(persona, provider).stored, 'Credential deletion');
  console.log('Keychain round-trip, replacement, naming convention and deletion: PASS');
  console.log('Credential isolation, safe status and active persona: PASS');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  // The writing process owns every entry, so cleanup cannot be stranded behind
  // an authorization prompt the way the retired Python proof could.
  for (const name of [persona, other]) {
    try { core.deleteCredentials(name, provider); } catch { console.error('Synthetic Keychain cleanup failed.'); process.exitCode = 1; }
  }
  await rm(directory, { recursive: true, force: true });
}
