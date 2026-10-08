// SPDX-License-Identifier: GPL-3.0-only
// QGD-FRM-0005 brings Svelte; svelte-check is what type-checks inside a
// component, where tsc cannot look.
//
// Run only once a component exists. svelte-check warns when it finds no input
// files, and --fail-on-warnings is what makes a real warning in a real
// component stop the build — so the choice is between a gate that is strict
// from the first component and a build that fails until one is written.
import { spawnSync } from 'node:child_process';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
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

// The configuration has to include the component glob or svelte-check reaches
// only the components TypeScript imports — which silently excludes every
// .stories.svelte, since nothing imports a story. That is not something a clean
// run can be distinguished from, so it is measured: a standalone component with
// a deliberate type error has to be reported before a clean run is believed.
const TSCONFIG = './tsconfig.svelte.json';

async function coversAStandaloneComponent() {
  // Inside the repository, so `svelte` resolves, and in its own directory so
  // there is one thing to remove. Gitignored, and outside src/ so a leftover
  // cannot be mistaken for a component or fail the story-pairing check.
  const directory = resolve('.svelte-check-control');
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'tsconfig.json'), JSON.stringify({
      extends: '../tsconfig.renderer.json',
      include: ['Control.svelte']
    }) + '\n');
    await writeFile(join(directory, 'Control.svelte'),
      '<script lang="ts">\n  const wrong: number = "not a number";\n</script>\n\n<p>{wrong}</p>\n');
    const run = spawnSync(
      resolve('node_modules/.bin/svelte-check'),
      ['--tsconfig', './.svelte-check-control/tsconfig.json', '--threshold', 'error', '--output', 'human'],
      { encoding: 'utf8', timeout: 180_000 }
    );
    return run.status !== 0;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const found = await components(resolve('src'));
if (found.length === 0) {
  console.log('svelte-check: no components yet; nothing to check.');
} else if (!await coversAStandaloneComponent()) {
  console.error('svelte-check reported nothing on a component with a deliberate type error.');
  console.error(`It is reviewing less than it appears to; check the include patterns in ${TSCONFIG}.`);
  process.exitCode = 1;
} else {
  const run = spawnSync(
    resolve('node_modules/.bin/svelte-check'),
    ['--tsconfig', TSCONFIG, '--threshold', 'warning', '--fail-on-warnings', '--output', 'human'],
    { stdio: 'inherit' }
  );
  process.exitCode = run.status === 0 ? 0 : run.status || 1;
}
