// SPDX-License-Identifier: GPL-3.0-only
import { describe, expect, it } from 'vitest';
import { blockedBy, CREDENTIAL_SUITES } from '../scripts/suite-gate.mjs';

const ORDER = ['spec-rvm', 'build', 'unit', 'rust-unit', 'crypto-evidence', 'keychain-roundtrip', 'credential-editing', 'electron-smoke', 'process-recovery', 'connection-capture', 'package', 'packaged-launch'];
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
    for (const name of ['spec-rvm', 'build', 'unit', 'rust-unit', 'crypto-evidence', 'process-recovery', 'package']) {
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
    for (const name of ['keychain-roundtrip', 'crypto-evidence', 'credential-editing', 'electron-smoke', 'process-recovery', 'connection-capture', 'package', 'packaged-launch']) {
      expect(resultOf(suites, name)).toEqual({ name, result: 'NOT RUN', blockedBy: 'build' });
    }
  });

  it('stops the packaged launch when packaging fails, and nothing else', () => {
    const suites = run(['package']);
    expect(resultOf(suites, 'packaged-launch')).toEqual({ name: 'packaged-launch', result: 'NOT RUN', blockedBy: 'package' });
    for (const name of ['keychain-roundtrip', 'credential-editing', 'electron-smoke', 'connection-capture']) {
      expect(resultOf(suites, name).result).toBe('PASS');
    }
  });

  it('runs every suite when nothing has failed', () => {
    expect(run([]).every(suite => suite.result === 'PASS')).toBe(true);
  });
});
