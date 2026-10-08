// SPDX-License-Identifier: GPL-3.0-only
// tools/electronegativity has its own dependency tree, so a root install does
// not reach it and QGD-SEC-0014's gate would fail on every fresh checkout until
// somebody discovered the second command. This runs after the root install.
//
// It never fails the install: a developer who cannot reach the registry should
// still get a working checkout, and the audit says plainly what to run.
import { spawnSync } from 'node:child_process';
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';

const tool = resolve('tools/electronegativity');
const binary = resolve(tool, 'node_modules/.bin/electronegativity');

try {
  await access(binary);
  console.log('Electron audit tooling already installed.');
} catch {
  const lock = resolve(tool, 'package-lock.json');
  let command = 'install';
  try { await access(lock); command = 'ci'; } catch { /* no lockfile yet */ }
  const run = spawnSync('npm', [command, '--prefix', tool], { stdio: 'inherit' });
  if (run.status !== 0) {
    console.error(`Electron audit tooling did not install. Run: npm ${command} --prefix tools/electronegativity`);
  }
}
