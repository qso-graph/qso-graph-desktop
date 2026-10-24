// SPDX-License-Identifier: GPL-3.0-only
// The Keychain service names this product owns, for the suites to assert
// against and to sweep.
//
// Read from the Rust source rather than written here. QGD-CRD-0003 makes the
// core the owner of its entry names, and a second copy in JavaScript is a
// second thing to forget: the names were wrong for nine Parts precisely
// because a constant and a requirement disagreed and nothing compared them.
import { readFile } from 'node:fs/promises';

const source = await readFile('packages/callsign-core/src/lib.rs', 'utf8');

function constantOf(name) {
  // `const NAME: &str = "value";` — matched on the declaration, so a mention
  // in a comment cannot be picked up instead.
  const found = new RegExp(`^const ${name}: &str = "([^"]+)";`, 'm').exec(source);
  if (!found) throw new Error(`packages/callsign-core/src/lib.rs declares no ${name}`);
  return found[1];
}

export const KEYCHAIN_SERVICE = constantOf('SERVICE');
export const KEYCHAIN_TEST_SERVICE = constantOf('TEST_SERVICE');

// What the suites set so the core writes fixtures to the test service.
export const TEST_KEYCHAIN_ENV = 'QG_DESKTOP_TEST_KEYCHAIN';

// The namespace this product must never touch: the MCP servers'. Named here so
// the check for it is one string in one place.
export const FOREIGN_SERVICE = 'adif-mcp';

// Which service the core is writing to right now. Mirrors the core's own
// `service()`: the env var selects, it never supplies a name. A suite that
// asserts on the entry has to ask this rather than assume the production
// service, which is what made the roundtrip suite fail the moment fixtures
// moved — it was looking where the core no longer writes.
export function activeKeychainService() {
  return process.env[TEST_KEYCHAIN_ENV] ? KEYCHAIN_TEST_SERVICE : KEYCHAIN_SERVICE;
}

// ---------------------------------------------------------------------------
// Test-mode plumbing.

import { spawnSync } from 'node:child_process';

// Called at the top of any suite that reaches the credential core, before the
// core is loaded or the application is launched, so fixtures land in the test
// service and never beside a real credential.
export function enableTestKeychain() {
  process.env[TEST_KEYCHAIN_ENV] = '1';
  if (enabled) return;
  enabled = true;
  // The sweep is registered here rather than left to each suite's `finally`,
  // because the runs that littered were the ones that did not reach their
  // finally: a thrown assertion, a Ctrl-C, a killed Electron. One call gives a
  // suite both the test namespace and the cleanup.
  //
  // SIGKILL cannot be caught, so the sweep at the start of the next run is the
  // backstop — it removes whatever the last one left.
  process.on('exit', () => { sweepTestKeychain(); });
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => { sweepTestKeychain(); process.exit(1); });
  }
  // Anything a previous run left behind, before this one starts.
  sweepTestKeychain();
}

let enabled = false;

// Every account the test service currently holds. Attributes only — no secret
// is read, so this never raises a keychain prompt (QGD-CRD-0009).
export function testKeychainAccounts() {
  const run = spawnSync('security', ['dump-keychain'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (run.status !== 0 || typeof run.stdout !== 'string') return [];
  const accounts = [];
  for (const record of run.stdout.split(/^keychain: /m)) {
    const service = /"svce"<blob>="([^"]*)"/.exec(record);
    if (!service || service[1] !== KEYCHAIN_TEST_SERVICE) continue;
    const account = /"acct"<blob>="([^"]*)"/.exec(record);
    if (account) accounts.push(account[1]);
  }
  return accounts;
}

// Remove everything under the test service. Called from a suite's `finally`,
// so a run that throws or is killed does not leave fixtures behind — which is
// how seventeen of them accumulated under the MCP servers' namespace before
// 2026-10-09.
//
// Scoped to the test service by name. It cannot match a real credential,
// because a real one is never written there.
export function sweepTestKeychain() {
  let removed = 0;
  for (const account of testKeychainAccounts()) {
    const run = spawnSync('security',
      ['delete-generic-password', '-s', KEYCHAIN_TEST_SERVICE, '-a', account],
      { encoding: 'utf8' });
    if (run.status === 0) removed += 1;
  }
  return removed;
}

// What the login keychain holds under a given service, for a suite to assert
// it gained nothing. Named rather than inferred: the only two services this
// product may ever write are the two constants above.
export function accountsUnder(service) {
  const run = spawnSync('security', ['dump-keychain'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (run.status !== 0 || typeof run.stdout !== 'string') return [];
  const accounts = [];
  for (const record of run.stdout.split(/^keychain: /m)) {
    const found = /"svce"<blob>="([^"]*)"/.exec(record);
    if (!found || found[1] !== service) continue;
    const account = /"acct"<blob>="([^"]*)"/.exec(record);
    if (account) accounts.push(account[1]);
  }
  return accounts;
}
