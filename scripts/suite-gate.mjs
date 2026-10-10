// SPDX-License-Identifier: GPL-3.0-only
// QGD-TST-0007: which suites a failure stops, and which still run.
//
// The line is drawn at the dependency, not at the point of failure: a suite is
// stopped when its result would depend on the thing that just failed. Rationale
// in QGD-HDBK-001 section 4.

// Suites whose result depends on the OS credential store.
export const CREDENTIAL_SUITES = ['credential-editing', 'persona-export', 'electron-smoke', 'setup-walk', 'connection-capture', 'packaged-launch'];

// Suites that report their own result regardless of the credential proof.
// rust-unit depends on neither the TypeScript build nor the credential store,
// and icons, engine-binaries and adif-reference compare what is on disk
// against a register. package-boundaries reads the imports as written, so it
// does not need the build either — and is most useful when the build is what
// broke, since a wrong-direction import is one reason it would.
const ALWAYS_RUN = ['spec-rvm', 'icons', 'engine-binaries', 'adif-reference', 'package-boundaries', 'build', 'unit', 'rust-unit'];

// Returns the name of the failed suite that stops `name`, or undefined to run it.
export function blockedBy(name, suites) {
  const failed = suite => suites.some(entry => entry.name === suite && entry.result === 'FAIL');
  if (ALWAYS_RUN.includes(name)) return undefined;
  // Nothing downstream can be built, packaged or launched without a build.
  if (failed('build')) return 'build';
  if (CREDENTIAL_SUITES.includes(name) && failed('keychain-roundtrip')) return 'keychain-roundtrip';
  // The engine suites run a real PostgreSQL from the pinned build, so there is
  // nothing for them to run if the build is not there.
  if (name.startsWith('engine-') && name !== 'engine-binaries' && failed('engine-binaries')) return 'engine-binaries';
  // The reference load runs a real engine too, and reads the archive the
  // adif-reference suite is the one that reports as missing.
  if (['reference-load', 'adif-validation', 'pota-load'].includes(name)) {
    if (failed('engine-binaries')) return 'engine-binaries';
    if (failed('adif-reference')) return 'adif-reference';
  }
  // The exit gate validates what the load put in the engine.
  if (name === 'adif-validation' && failed('reference-load')) return 'reference-load';
  // story-themes walks the gallery that storybook built.
  if (name === 'story-themes' && failed('storybook')) return 'storybook';
  // Both of these read what packaging produced.
  if (['packaged-launch', 'electron-audit', 'package-contents'].includes(name) && failed('package')) return 'package';
  return undefined;
}
