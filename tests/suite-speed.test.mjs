// SPDX-License-Identifier: GPL-3.0-only
// The development pass covers every suite it claims to, and claims none it
// should not.
//
// `make verify` runs every check and is what a sign-off reads (QGD-TST-0001).
// `make check` is the pass a person runs while working — nine suites, about
// ten seconds — modelled on Podman Desktop's pr-check and VS Code's pr.yml,
// where the expensive end-to-end set runs on main or nightly rather than on
// every change.
//
// The risk in having two sets is that they stop adding up: a suite added to
// the list and classified wrongly either never runs in development, which is
// only a cost, or runs there and makes the fast pass slow and prompt-laden,
// which is how people stop using it. So the classification is derived from
// each suite's own script, and this holds the derivation to known cases.
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { fastSuiteCommands, isSlowSuite, suiteCommands } from '../scripts/suites.mjs';

const all = suiteCommands('npm');
const fast = fastSuiteCommands('npm');

describe('the development pass', () => {
  it('splits every suite, with none in both halves and none in neither', () => {
    const fastNames = fast.map(([name]) => name);
    const slowNames = all.filter(([name, args]) => isSlowSuite(name, args)).map(([name]) => name);
    expect([...fastNames, ...slowNames].sort()).toEqual(all.map(([name]) => name).sort());
    expect(fastNames.filter(name => slowNames.includes(name))).toEqual([]);
    // And it is a real subset: all-fast or all-slow would both pass the line
    // above while making one of the two commands pointless.
    expect(fastNames.length).toBeGreaterThan(4);
    expect(slowNames.length).toBeGreaterThan(fastNames.length);
  });

  it('keeps out anything that needs a window, a package or the Keychain', async () => {
    for (const [name, args] of fast) {
      const script = args.find(arg => typeof arg === 'string' && arg.startsWith('scripts/'));
      if (!script) continue;
      const text = await readFile(script, 'utf8');
      expect(text, `${name} must not drive a window in the development pass`)
        .not.toMatch(/@playwright\/test|_electron|electron-builder|electronegativity/);
      expect(text, `${name} must not read the operator's credential store`)
        .not.toMatch(/keychain-service\.mjs|QG_DESKTOP_TEST_KEYCHAIN/);
      expect(text, `${name} must not build the gallery`).not.toMatch(/node_modules\/\.bin\/storybook/);
    }
  });

  it('classifies the cases this split was drawn around', () => {
    const byName = new Map(all.map(([name, args]) => [name, args]));
    const slow = name => isSlowSuite(name, byName.get(name) ?? []);
    // Windows, packaging, the gallery and the Keychain: all out.
    for (const name of [
      'electron-smoke', 'setup-walk', 'screenshots', 'axe', 'story-themes',
      'package', 'packaged-launch', 'electron-audit', 'package-contents',
      'keychain-roundtrip', 'credential-editing', 'persona-export', 'storybook'
    ]) {
      expect(slow(name), `${name} is not something to run on every save`).toBe(true);
    }
    // The ones worth having in ten seconds.
    for (const name of ['spec-rvm', 'build', 'unit', 'rust-unit', 'security-lint', 'package-boundaries']) {
      expect(slow(name), `${name} belongs in the development pass`).toBe(false);
    }
  });

  it('writes no report, so a partial run cannot be read as a verification', async () => {
    // report/report.md and report/summary.json are what a Part is signed off
    // against. The fast path must not produce them, and the guard is in the
    // source rather than in a comment: both writes are inside the branch that
    // only a full run reaches.
    const source = await readFile('scripts/verify.mjs', 'utf8');
    const fastBranch = source.indexOf('if (fast) {');
    const writeCall = source.indexOf('await write();');
    expect(fastBranch, 'verify.mjs must have a fast branch').toBeGreaterThan(0);
    expect(writeCall, 'the report write must come after the fast branch opens').toBeGreaterThan(fastBranch);
    // And the fast branch must not write anything itself.
    const elseAt = source.indexOf('} else {', fastBranch);
    expect(source.slice(fastBranch, elseAt)).not.toContain('write');
  });
});
