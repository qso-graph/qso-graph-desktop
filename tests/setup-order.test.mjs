// SPDX-License-Identifier: GPL-3.0-only
// `make setup` must build before anything it runs needs the build.
//
// scripts/fetch-pota.mjs imports the POTA reader from dist/, and setup ran it
// before any build. That was wrong for months and invisible, because every
// machine that had ever built had a dist/ lying around. The first clean
// account to run `make setup` failed on a missing dist/reference/fetch.js —
// which is the whole value of running verification somewhere that has never
// built before (QGD-CRD-0013.1).
//
// Derived from the Makefile and the scripts themselves, so a new setup step
// that reaches into dist/ is caught by being added, not by being remembered.
import { readFile, readdir } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const makefile = await readFile('Makefile', 'utf8');

// The recipe lines of the setup target, in order.
function recipe(target) {
  const lines = makefile.split('\n');
  const start = lines.findIndex(line => line.startsWith(`${target}:`));
  expect(start, `Makefile has no ${target} target`).toBeGreaterThanOrEqual(0);
  const steps = [];
  for (const line of lines.slice(start + 1)) {
    // A comment or a blank line at column 0 is ordinary make style and does
    // not end a recipe — reading it as the end is how this test first failed
    // against a correct Makefile, which would have been a worse outcome than
    // not having it.
    if (line.trim() === '' || line.startsWith('#')) continue;
    if (!line.startsWith('\t')) break;
    const step = line.slice(1).trim();
    if (step && !step.startsWith('#')) steps.push(step);
  }
  return steps;
}

describe('make setup', () => {
  const steps = recipe('setup');

  it('has a recipe this test can actually read', () => {
    // Not vacuous: if the parse returns nothing the checks below pass for the
    // wrong reason.
    expect(steps.length).toBeGreaterThan(2);
    expect(steps.some(step => step.includes('npm ci'))).toBe(true);
  });

  it('builds before any step that needs the build', async () => {
    const build = steps.findIndex(step => step.includes('npm run build') || step.includes('make build'));
    const scripts = (await readdir('scripts')).filter(name => name.endsWith('.mjs'));

    const needsBuild = [];
    for (const name of scripts) {
      const text = await readFile(`scripts/${name}`, 'utf8');
      // An import of compiled output, in code rather than in a comment.
      const live = text.split('\n').filter(line => !line.trimStart().startsWith('//')).join('\n');
      if (/from '\.\.\/dist\/|import\('\.\.\/dist\//.test(live)) needsBuild.push(name);
    }
    // Not vacuous: fetch-pota is the one that found this.
    expect(needsBuild).toContain('fetch-pota.mjs');

    for (const name of needsBuild) {
      const at = steps.findIndex(step => step.includes(`scripts/${name}`));
      if (at === -1) continue;
      expect(build, `setup runs scripts/${name}, which imports from dist/, with no build step before it`)
        .toBeGreaterThanOrEqual(0);
      expect(at, `setup runs scripts/${name} before it builds, and that script imports from dist/`)
        .toBeGreaterThan(build);
    }
  });

  it('leaves a script that needs the build able to say so', async () => {
    // The ordering is the fix; the message is what makes a standalone run
    // comprehensible instead of an ERR_MODULE_NOT_FOUND naming a file nobody
    // put there.
    const text = await readFile('scripts/fetch-pota.mjs', 'utf8');
    expect(text).toMatch(/dist\/ is not built/);
    expect(text).toMatch(/make setup/);
  });
});
