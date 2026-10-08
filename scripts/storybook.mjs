// SPDX-License-Identifier: GPL-3.0-only
// QGD-FRM-0006 and QGD-FRM-0008: every component has a story, and the gallery
// builds. A story that no longer builds fails the run rather than waiting for
// somebody to open it.
import { spawnSync } from 'node:child_process';
import { access, readdir, readFile, rm } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { isComponent, isStory, missingStories, orphanStories } from './stories.mjs';

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

// QGD-FRM-0010. A story claims a pattern by saying so, rather than by being
// named in a way the gate can guess at: the marker is read out of the file, so
// a component keeps the name it should have and the link to the register is
// visible to whoever opens it.
//
// Now that all five exist this is a failure, not a report. A pattern that
// loses its story is the register drifting from what is actually there, which
// is the thing it was written to prevent.
const register = JSON.parse(await readFile('data/story-patterns.json', 'utf8'));
const claimed = new Map();
for (const story of files.filter(isStory)) {
  const text = await readFile(story, 'utf8');
  for (const match of text.matchAll(/QGD-FRM-0010 pattern:\s*([a-z-]+)/g)) {
    claimed.set(match[1], story);
  }
}
const known = new Set(register.patterns.map(entry => entry.id));
for (const [id, story] of claimed) {
  if (!known.has(id)) failures.push(`${story} claims pattern "${id}", which is not in data/story-patterns.json.`);
}
const missing = register.patterns.filter(entry => !claimed.has(entry.id));
for (const entry of missing) {
  failures.push(`no story claims the "${entry.id}" pattern (${entry.what}). QGD-FRM-0010.`);
}

const components = files.filter(isComponent).length;
if (failures.length) {
  console.error('Storybook check failed.');
  for (const failure of failures) console.error(`  ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Storybook: ${components} component(s), each with a story; gallery builds: PASS`);
  console.log(`QGD-FRM-0010 patterns with a story: ${claimed.size} of ${register.patterns.length} — ${[...claimed.keys()].sort().join(', ')}`);
}
