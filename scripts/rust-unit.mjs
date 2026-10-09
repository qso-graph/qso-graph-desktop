// SPDX-License-Identifier: GPL-3.0-only
// QGD-TST-0001: make verify runs every check. The credential core's own unit
// tests — including the simulated Keychain refusal and retry — were previously
// run by hand and recorded in docs/PERSONA-CORE.md, which left the one command
// that is supposed to run every check not running them.
import { spawnSync } from 'node:child_process';
import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const cargo = join(homedir(), '.cargo', 'bin', 'cargo');
await access(cargo);
// --release reuses the profile scripts/build-native.mjs already built.
const run = spawnSync(cargo, ['test', '--release', '--manifest-path', 'packages/persona-core/Cargo.toml'], { stdio: 'inherit' });
process.exitCode = run.status === 0 ? 0 : run.status || 1;
