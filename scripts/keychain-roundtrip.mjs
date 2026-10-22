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
import { activeKeychainService } from './keychain-service.mjs';
import { enableTestKeychain } from './keychain-service.mjs';

// Fixtures go to this product's test Keychain service, never beside a real
// credential, and are swept on exit (QGD-CRD-0003). Called before the core is
// loaded, because the service name is read when an entry is made.
enableTestKeychain();

const require = createRequire(import.meta.url);
const { CallsignCore } = require('../dist/native/persona.node');
const directory = await mkdtemp(join(tmpdir(), 'qg-callsign-roundtrip-'));
const core = new CallsignCore(directory);
// The callsigns' ids, which the core chooses.
let id;
let other;
const provider = 'qrz_logbook';
const password = `QG_FAKE_CREDENTIAL_${randomUUID()}`;
const apiKey = `QG_FAKE_CREDENTIAL_${randomUUID()}`;
const replacement = `QG_FAKE_CREDENTIAL_${randomUUID()}`;
const secrets = [password, apiKey, replacement];
function check(result, name) { if (!result) throw new Error(`${name} failed; credential values omitted.`); }

try {
  id = core.create('w1aw', 'qg-test home', '2026-01-01', undefined).id;
  other = core.create('k1abc', '', undefined, undefined).id;
  core.saveCredentials(id, provider, { username: 'W1AW', password, apiKey });

  // The credential written through the core comes back through the core.
  const stored = core.requireCredential(id, provider);
  check(stored.username === 'W1AW' && stored.password === apiKey, 'Credential round-trip');

  // A replacement supersedes the stored value; the other field is retained.
  core.saveCredentials(id, provider, { apiKey: replacement });
  check(core.requireCredential(id, provider).password === replacement, 'Credential replacement');
  check(core.requireCredential(id, provider, 'password').password === password, 'Retained password');

  // QGD-CRD-0003: the entry is named by the convention, not a library default:
  // the callsign's id and the service, and nothing the operator typed. Each
  // platform's own tool finds it by that name: security on macOS, secret-tool
  // for the Secret Service on Linux, cmdkey on Windows (whose target the
  // keyring crate writes as account.service).
  const account = `${id}:${provider}`;
  const service = activeKeychainService();
  const name = process.platform === 'darwin'
    ? spawnSync('/usr/bin/security', ['find-generic-password', '-s', service, '-a', account], { encoding: 'utf8', timeout: 30_000 })
    : process.platform === 'win32'
      ? spawnSync('cmdkey', [`/list:${account}.${service}`], { encoding: 'utf8', timeout: 30_000 })
      : spawnSync('secret-tool', ['search', 'service', service, 'username', account], { encoding: 'utf8', timeout: 30_000 });
  const found = process.platform === 'win32'
    ? name.status === 0 && `${name.stdout || ''}`.includes(`${account}.${service}`)
    : name.status === 0;
  check(found, 'Keyring naming convention');
  // secret-tool prints the stored secret on a line of its own after the
  // attributes; that line is the secret, not the entry's metadata.
  const metadata = `${name.stdout || ''}`.split('\n').filter(line => !line.startsWith('secret = ')).join('\n');
  check(!secrets.some(secret => metadata.includes(secret)), 'No secret in entry metadata');

  check(!core.credentialStatus(other, provider).stored, 'Callsign credential isolation');
  const status = core.credentialStatus(id, provider);
  check(status.stored && status.hasApiKey && status.hasPassword, 'Credential status');
  check(Object.keys(status).sort().join(',') === 'effective,hasApiKey,hasPassword,hasUsername,kindsKnown,preferred,stored,testable', 'No secret in status API');
  check(status.kindsKnown, 'Status knows what it holds when it wrote it');

  core.setActive(id);
  check(core.active() === id, 'Active callsign by id');
  // A callsign's call and description change; its credentials stay with it.
  core.update(id, 'k7abc', 'qg-test portable', '2026-01-01', undefined);
  check(core.credentialStatus(id, provider).stored, 'Credentials kept through a change of call and description');

  const index = await readFile(join(directory, 'callsigns.json'), 'utf8');
  check(!secrets.some(secret => index.includes(secret)), 'No secret in the callsign index');

  // QGD-CRD-0010: an index written before the kinds were recorded. The entry
  // is in the Keychain; the index says only who the username is, which is what
  // every credential saved before this change looks like. Status must not
  // report that as holding neither secret — that is a claim, not an absence of
  // information — and must not decrypt the entry to find out.
  {
    const before = JSON.parse(await readFile(join(directory, 'callsigns.json'), 'utf8'));
    const reference = before.callsigns[id].providers[provider];
    before.callsigns[id].providers[provider] = { username: reference.username };
    await writeFile(join(directory, 'callsigns.json'), JSON.stringify(before, null, 2));

    const legacy = core.credentialStatus(id, provider);
    check(legacy.stored, 'A legacy entry is still reported as stored');
    check(!legacy.kindsKnown, 'A legacy entry reports that its kinds are unknown');
    check(!legacy.hasPassword && !legacy.hasApiKey, 'A legacy entry claims neither kind');

    // And it repairs itself the first time something with a reason to decrypt
    // it does. Nothing decrypts anything in order to repair it.
    core.requireCredential(id, provider, null);
    const repaired = core.credentialStatus(id, provider);
    check(repaired.kindsKnown, 'Reading the credential records what it holds');
    check(repaired.hasPassword && repaired.hasApiKey, 'The repaired status is the true one');
  }

  check(core.deleteCredentials(id, provider) && !core.credentialStatus(id, provider).stored, 'Credential deletion');
  console.log('Keychain round-trip, replacement, naming convention and deletion: PASS');
  console.log('Credential isolation, safe status and active callsign: PASS');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  // The writing process owns every entry, so cleanup cannot be stranded behind
  // an authorization prompt the way the retired Python proof could.
  for (const name of [id, other].filter(Boolean)) {
    try { core.deleteCredentials(name, provider); } catch { console.error('Synthetic Keychain cleanup failed.'); process.exitCode = 1; }
  }
  await rm(directory, { recursive: true, force: true });
}
