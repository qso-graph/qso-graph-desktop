// SPDX-License-Identifier: GPL-3.0-or-later
// QGD-TST-0001: check both native crates with the pinned toolchain.
import { spawnSync } from 'node:child_process';
import { cargoPath } from './cargo-path.mjs';

const cargo = await cargoPath();
for (const crate of ['callsign-core', 'integrations-core']) {
  const manifest = `packages/${crate}/Cargo.toml`;
  for (const args of [
    ['fmt', '--manifest-path', manifest, '--check'],
    ['clippy', '--manifest-path', manifest, '--all-targets', '--locked', '--', '-D', 'warnings'],
  ]) {
    console.log(`Checking ${crate}: cargo ${args.join(' ')}`);
    const run = spawnSync(cargo, args, { stdio: 'inherit' });
    if (run.status !== 0) process.exit(run.status || 1);
  }
}
