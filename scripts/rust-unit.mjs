// SPDX-License-Identifier: GPL-3.0-only
// QGD-TST-0001: make verify runs every check. The credential core's own unit
// tests — including the simulated Keychain refusal and retry — were previously
// run by hand and recorded in docs/PERSONA-CORE.md, which left the one command
// that is supposed to run every check not running them.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { cargoPath } from './cargo-path.mjs';

const cargo = await cargoPath();
// Every crate, the credential core and Integrations' listener (QGD-INT-0001).
// --release reuses the profile scripts/build-native.mjs already built.
for (const crate of ['callsign-core', 'integrations-core']) {
  const run = spawnSync(cargo, ['test', '--release', '--manifest-path', `packages/${crate}/Cargo.toml`], { stdio: 'inherit' });
  if (run.status !== 0) { process.exitCode = run.status || 1; break; }
}
