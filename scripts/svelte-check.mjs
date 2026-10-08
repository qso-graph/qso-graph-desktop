// SPDX-License-Identifier: GPL-3.0-only
// QGD-FRM-0005 brings Svelte; svelte-check is what type-checks inside a
// component, where tsc cannot look.
//
// Run only once a component exists. svelte-check warns when it finds no input
// files, and --fail-on-warnings is what makes a real warning in a real
// component stop the build — so the choice is between a gate that is strict
// from the first component and a build that fails until one is written.
import { spawnSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const SKIP = new Set(['node_modules', 'dist', 'out', 'report', 'target', '.git']);

async function components(directory, found = []) {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); } catch { return found; }
  for (const entry of entries) {
    if (SKIP.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await components(path, found);
    else if (entry.name.endsWith('.svelte')) found.push(path);
  }
  return found;
}

const found = await components(resolve('src'));
if (found.length === 0) {
  console.log('svelte-check: no components yet; nothing to check.');
} else {
  const run = spawnSync(
    resolve('node_modules/.bin/svelte-check'),
    ['--tsconfig', './tsconfig.renderer.json', '--threshold', 'warning', '--fail-on-warnings', '--output', 'human'],
    { stdio: 'inherit' }
  );
  process.exitCode = run.status === 0 ? 0 : run.status || 1;
}
