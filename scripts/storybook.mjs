// SPDX-License-Identifier: GPL-3.0-only
// QGD-FRM-0006 and QGD-FRM-0008: every component has a story, and the gallery
// builds. A story that no longer builds fails the run rather than waiting for
// somebody to open it.
import { spawnSync } from 'node:child_process';
import { access, readdir, readFile, rm } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { isComponent, missingStories, orphanStories } from './stories.mjs';

const SKIP = new Set(['node_modules', 'dist', 'out', 'report', 'target', '.git', 'storybook-static']);
const root = resolve('.');

async function walk(directory, found = []) {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); } catch { return found; }
  for (const entry of entries) {
    if (SKIP.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await walk(path, found);
    else found.push(relative(root, path));
  }
  return found;
}

const failures = [];
const files = await walk(resolve('src'));

for (const component of missingStories(files)) {
  failures.push(`${component} has no story. QGD-FRM-0006: every component in the shell and in ui has one.`);
}
for (const story of orphanStories(files)) {
  failures.push(`${story} has no component beside it; the component was renamed or removed.`);
}

const output = resolve('storybook-static');
await rm(output, { recursive: true, force: true });
const build = spawnSync(resolve('node_modules/.bin/storybook'), ['build', '--output-dir', output, '--quiet'], {
  encoding: 'utf8', timeout: 600_000
});

if (build.status !== 0 || build.error) {
  failures.push('the gallery did not build.');
  for (const line of `${build.stdout || ''}${build.stderr || ''}`.split('\n').filter(Boolean).slice(-12)) {
    failures.push(`  ${line}`);
  }
} else {
  try { await access(join(output, 'index.html')); }
  catch { failures.push('the build reported success but produced no index.html.'); }
}

// QGD-FRM-0010: reported every run, so which patterns still lack a story is
// visible while P3 is being built rather than discovered at its exit gate.
// Not a failure yet — the gate is the Part's, and the patterns arrive with the
// shell they describe.
const register = JSON.parse(await readFile('data/story-patterns.json', 'utf8'));
const storyNames = files.filter(path => /\.stories\./.test(path)).map(path => path.toLowerCase());
const pattern = Object.fromEntries(register.patterns.map(entry =>
  [entry.id, storyNames.some(name => name.includes(entry.id.replace(/-/g, '')) || name.includes(entry.id))]));
const have = Object.values(pattern).filter(Boolean).length;

const components = files.filter(isComponent).length;
if (failures.length) {
  console.error('Storybook check failed.');
  for (const failure of failures) console.error(`  ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Storybook: ${components} component(s), each with a story; gallery builds: PASS`);
  console.log(`QGD-FRM-0010 patterns with a story: ${have} of ${register.patterns.length}` +
    (have === register.patterns.length ? '' : ` — still to write: ${Object.entries(pattern).filter(([, present]) => !present).map(([id]) => id).join(', ')}`));
}
