// SPDX-License-Identifier: GPL-3.0-only
// The suites `make verify` runs, in order.
//
// Here rather than in verify.mjs because two things need to agree about it:
// the runner, and tests/suite-gate.test.mjs, which walks the real order to
// prove QGD-TST-0007 stops the right suites and no others. That test kept its
// own copy of the list and it had drifted by four suites — the same way the
// network gate's scope drifted, and the reason QGD-SEC-0021 says a scope is
// derived and never a list somebody has to remember to extend.
//
// `npmCli` is the npm the run was started with: the build and packaging steps
// are npm scripts, and which npm is not this file's business.
// The outer bound on one suite, where 120s is not enough.
//
// Every suite had a flat 120s, and a suite that legitimately waits longer than
// that is killed rather than failed — electron-smoke waits 705s in total and
// electron-audit 300s, both of them under a flat 120s bound. A number inside a
// suite and the number the runner kills it with have to agree, and nothing
// made them.
// tests/suite-timeouts.test.mjs is what makes them agree now: it reads each
// suite's own `timeout:` waits out of its source and fails if the outer bound
// does not clear them. Found in review.
export const DEFAULT_SUITE_TIMEOUT_MS = 120_000;

export const SUITE_TIMEOUT_MS = {
  // Each of these clears the sum of the waits written inside that suite, which
  // is the worst case if they all fall due one after another. They are
  // ceilings, not durations: an ordinary run never approaches them, and the
  // only thing a generous ceiling costs is how long a genuinely wedged suite
  // takes to be reported. Being killed under the ceiling costs the report its
  // ability to say what failed, which is worse.
  //
  // tests/suite-timeouts.test.mjs sums each suite's own waits out of its
  // source and fails if the bound here does not clear them, so a wait added
  // inside a suite cannot quietly outgrow it.
  'electron-smoke': 900_000,      // 705s of waits across 19 of them
  'process-recovery': 240_000,    // 150s
  screenshots: 420_000,           // 270s
  storybook: 900_000,             // a 600s build wait
  'packaged-launch': 720_000,     // 495s
  'electron-audit': 480_000,      // a single 300s wait
  // An npm script, so its waits are not in a scripts/ file to read. Packaging
  // was inside the flat 120s bound on this machine with no headroom at all on
  // a slower one.
  package: 600_000
};

export function suiteTimeout(name) {
  return SUITE_TIMEOUT_MS[name] ?? DEFAULT_SUITE_TIMEOUT_MS;
}

export function suiteCommands(npmCli) {
  return [
  ['spec-rvm', ['scripts/gen-rvm.mjs', '--check']],
  ['icons', ['scripts/gen-icons.mjs', '--check']],
  ['engine-binaries', ['scripts/engine-binaries.mjs']],
  ['adif-reference', ['scripts/adif-reference.mjs']],
  ['package-boundaries', ['scripts/package-boundaries.mjs']],
  ['build', [npmCli, 'run', 'build']],
  ['unit', ['node_modules/vitest/vitest.mjs', 'run', 'tests/policy.test.ts', 'tests/report.test.mjs', 'tests/persona-contract.test.ts', 'tests/suite-gate.test.mjs', 'tests/network-static.test.mjs', 'tests/logging.test.ts', 'tests/core-logging.test.mjs', 'tests/diagnostics.test.ts', 'tests/endpoint.test.mjs', 'tests/toolchain.test.mjs', 'tests/storybook.test.mjs', 'tests/settings.test.ts', 'tests/shell.test.ts', 'tests/logs-page.test.ts', 'tests/unzip.test.mjs', 'tests/icons.test.mjs', 'tests/png.test.mjs', 'tests/engine-binaries.test.mjs', 'tests/reference-sources.test.mjs', 'tests/reference-reader.test.ts', 'tests/pota-reader.test.ts', 'tests/services.test.ts', 'tests/baseline-approval.test.mjs', 'tests/no-borrowed-identity.test.mjs', 'tests/package-boundaries.test.mjs', 'tests/app-runtime.test.ts', 'tests/keychain-namespace.test.mjs', 'tests/setup-order.test.mjs', 'tests/app-broker.test.mjs', 'tests/app-serve.test.ts', 'tests/deadlines.test.mjs', 'tests/suite-timeouts.test.mjs']],
  ['rust-unit', ['scripts/rust-unit.mjs']],
  ['security-lint', ['scripts/lint.mjs']],
  ['crypto-evidence', ['scripts/crypto-evidence.mjs']],
  ['keychain-roundtrip', ['scripts/keychain-roundtrip.mjs']],
  ['credential-editing', ['scripts/credential-edit-smoke.mjs']],
  ['persona-export', ['scripts/persona-export.mjs']],
  ['electron-smoke', ['scripts/smoke.mjs']],
  ['setup-walk', ['scripts/setup-walk.mjs']],
  ['process-recovery', ['scripts/process-recovery.mjs']],
  ['engine-lifecycle', ['scripts/engine-lifecycle.mjs']],
  ['engine-migrations', ['scripts/engine-migrations.mjs']],
  ['engine-backup', ['scripts/engine-backup.mjs']],
  ['reference-load', ['scripts/reference-load.mjs']],
  ['adif-validation', ['scripts/adif-validation.mjs']],
  ['pota-load', ['scripts/pota-load.mjs']],
  ['connection-capture', ['scripts/connection-capture.mjs']],
  ['axe', ['scripts/axe.mjs']],
  ['screenshots', ['scripts/screenshots.mjs']],
  ['storybook', ['scripts/storybook.mjs']],
  ['story-themes', ['scripts/story-themes.mjs']],
  ['package', [npmCli, 'run', 'package']],
  ['packaged-launch', ['scripts/packaged-smoke.mjs']],
  ['electron-audit', ['scripts/electron-audit.mjs']],
  ['package-contents', ['scripts/package-contents.mjs']]
];
}

export function suiteNames() {
  return suiteCommands('npm').map(([name]) => name);
}
