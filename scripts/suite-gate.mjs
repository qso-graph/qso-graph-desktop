// SPDX-License-Identifier: GPL-3.0-only
// QGD-TST-0007: which suites a failure stops, and which still run.
//
// The line is drawn at the dependency, not at the point of failure: a suite is
// stopped when its result would depend on the thing that just failed. Rationale
// in QGD-HDBK-001 section 4.

// Suites whose result depends on the OS credential store.
export const CREDENTIAL_SUITES = ['credential-editing', 'electron-smoke', 'connection-capture', 'packaged-launch'];

// Suites that report their own result regardless of the credential proof.
// rust-unit depends on neither the TypeScript build nor the credential store,
// and icons compares a committed file against an installed package.
const ALWAYS_RUN = ['spec-rvm', 'icons', 'build', 'unit', 'rust-unit'];

// Returns the name of the failed suite that stops `name`, or undefined to run it.
export function blockedBy(name, suites) {
  const failed = suite => suites.some(entry => entry.name === suite && entry.result === 'FAIL');
  if (ALWAYS_RUN.includes(name)) return undefined;
  // Nothing downstream can be built, packaged or launched without a build.
  if (failed('build')) return 'build';
  if (CREDENTIAL_SUITES.includes(name) && failed('keychain-roundtrip')) return 'keychain-roundtrip';
  // story-themes walks the gallery that storybook built.
  if (name === 'story-themes' && failed('storybook')) return 'storybook';
  // Both of these read what packaging produced.
  if (['packaged-launch', 'electron-audit'].includes(name) && failed('package')) return 'package';
  return undefined;
}
