// SPDX-License-Identifier: GPL-3.0-only
import { describe, expect, it } from 'vitest';
import { blockedBy, CREDENTIAL_SUITES } from '../scripts/suite-gate.mjs';
import { suiteNames } from '../scripts/suites.mjs';

// The real order, taken from the runner rather than copied beside it. This
// was a copy, and it had drifted by four suites — so the test walked an order
// that was not the one make verify runs (QGD-SEC-0021: a scope is derived).
const ORDER = suiteNames();
// Walk the real suite order, failing the named suite, and record what ran.
function run(failing) {
  const suites = [];
  for (const name of ORDER) {
    const blocked = blockedBy(name, suites);
    suites.push(blocked ? { name, result: 'NOT RUN', blockedBy: blocked } : { name, result: failing.includes(name) ? 'FAIL' : 'PASS' });
  }
  return suites;
}
const resultOf = (suites, name) => suites.find(suite => suite.name === name);

describe('QGD-TST-0007', () => {
  it('stops only the credential suites when the credential proof fails', () => {
    const suites = run(['keychain-roundtrip']);
    for (const name of CREDENTIAL_SUITES) {
      expect(resultOf(suites, name)).toEqual({ name, result: 'NOT RUN', blockedBy: 'keychain-roundtrip' });
    }
  });

  it('still runs and reports the build and the packaging step', () => {
    const suites = run(['keychain-roundtrip']);
    for (const name of ['spec-rvm', 'icons', 'adif-reference', 'build', 'unit', 'rust-unit', 'security-lint', 'crypto-evidence', 'process-recovery', 'axe', 'screenshots', 'package']) {
      expect(resultOf(suites, name).result).toBe('PASS');
    }
  });

  it('reports a stopped suite as not run, naming what blocked it', () => {
    const stopped = run(['keychain-roundtrip']).filter(suite => suite.result === 'NOT RUN');
    expect(stopped).toHaveLength(CREDENTIAL_SUITES.length);
    for (const suite of stopped) expect(suite.blockedBy).toBe('keychain-roundtrip');
  });

  it('stops everything downstream of a failed build, except the unit tests', () => {
    const suites = run(['build']);
    expect(resultOf(suites, 'unit').result).toBe('PASS');
    expect(resultOf(suites, 'rust-unit').result).toBe('PASS');
    for (const name of ['keychain-roundtrip', 'crypto-evidence', 'credential-editing', 'electron-smoke', 'process-recovery', 'storage', 'storage-migrations', 'reference-build', 'connection-capture', 'axe', 'screenshots', 'storybook', 'story-themes', 'package', 'packaged-launch', 'electron-audit']) {
      expect(resultOf(suites, name)).toEqual({ name, result: 'NOT RUN', blockedBy: 'build' });
    }
  });

  it('stops the packaged launch when packaging fails, and nothing else', () => {
    const suites = run(['package']);
    expect(resultOf(suites, 'packaged-launch')).toEqual({ name: 'packaged-launch', result: 'NOT RUN', blockedBy: 'package' });
    expect(resultOf(suites, 'electron-audit')).toEqual({ name: 'electron-audit', result: 'NOT RUN', blockedBy: 'package' });
    for (const name of ['keychain-roundtrip', 'credential-editing', 'electron-smoke', 'connection-capture']) {
      expect(resultOf(suites, name).result).toBe('PASS');
    }
  });

  it('runs every suite when nothing has failed', () => {
    expect(run([]).every(suite => suite.result === 'PASS')).toBe(true);
  });
});

describe('QGD-FRM-0007 story-themes reads what storybook builds', () => {
  it('is stopped when the gallery did not build', () => {
    // It walks storybook-static. Running it after a failed build would report
    // on whatever the last successful build left behind.
    expect(blockedBy('story-themes', [{ name: 'storybook', result: 'FAIL' }])).toBe('storybook');
    expect(blockedBy('story-themes', [{ name: 'storybook', result: 'PASS' }])).toBeUndefined();
  });
});

describe('the reference suites need the archive (QGD-ENG-0015)', () => {
  it('blocks them on a missing archive', () => {
    for (const name of ['reference-load', 'adif-validation', 'pota-load']) {
      expect(blockedBy(name, [{ name: 'adif-reference', result: 'FAIL' }])).toBe('adif-reference');
      expect(blockedBy(name, [{ name: 'adif-reference', result: 'PASS' }])).toBeUndefined();
    }
    expect(blockedBy('adif-validation', [{ name: 'reference-load', result: 'FAIL' }])).toBe('reference-load');
  });
});

describe('QGD-SEC-0021 the order this walks is the order that runs', () => {
  it('is the runner\u2019s own list, not a copy of it', () => {
    // The control for the fix above. If this file ever goes back to holding
    // its own list, these three stop being true of it: every suite make
    // verify runs is here, in that order, including ones added since.
    expect(ORDER.length).toBeGreaterThan(24);
    expect(ORDER[0], 'the first suite is the spec check').toBe('spec-rvm');
    // The last suites are the ones that read the packaged artifact, so they
    // run after it exists. package-contents reads the archive and the file
    // list that bounds it (QGD-APP-0014.1).
    expect(ORDER.slice(-2), 'the last suites audit what was packaged')
      .toEqual(['electron-audit', 'package-contents']);
    for (const name of CREDENTIAL_SUITES) {
      expect(ORDER, `${name} must be a suite that actually runs`).toContain(name);
    }
  });
});

// A test file no suite runs proves nothing, however green it is when run by
// hand. On the Air's own tests were in no suite while P8's record called
// P8-conditions and P8-your-station proven by them (found 2026-10-19). Every
// test file is named by a suite, directly or by a directory a suite runs.
describe('every test file is run by a suite', () => {
  it('leaves none out', async () => {
    const { readdir } = await import('node:fs/promises');
    const { suiteCommands } = await import('../scripts/suites.mjs');
    const named = suiteCommands('npm').flatMap(([, args]) => args).filter(arg => typeof arg === 'string');
    const files = [
      ...(await readdir('tests', { recursive: true })).map(file => `tests/${file}`),
      ...(await readdir('extensions', { recursive: true })).map(file => `extensions/${file}`)
    ].map(file => file.replaceAll('\\', '/')).filter(file => /\.test\.(ts|mjs|mts)$/.test(file));
    const covered = file => named.some(arg => arg === file || (arg.endsWith('/') && file.startsWith(arg)));
    expect(files.length).toBeGreaterThan(40);
    expect(files.filter(file => !covered(file))).toEqual([]);
  });
});
