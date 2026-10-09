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
export function suiteCommands(npmCli) {
  return [
  ['spec-rvm', ['scripts/gen-rvm.mjs', '--check']],
  ['icons', ['scripts/gen-icons.mjs', '--check']],
  ['engine-binaries', ['scripts/engine-binaries.mjs']],
  ['adif-reference', ['scripts/adif-reference.mjs']],
  ['package-boundaries', ['scripts/package-boundaries.mjs']],
  ['build', [npmCli, 'run', 'build']],
  ['unit', ['node_modules/vitest/vitest.mjs', 'run', 'tests/policy.test.ts', 'tests/report.test.mjs', 'tests/persona-contract.test.ts', 'tests/suite-gate.test.mjs', 'tests/network-static.test.mjs', 'tests/logging.test.ts', 'tests/core-logging.test.mjs', 'tests/diagnostics.test.ts', 'tests/endpoint.test.mjs', 'tests/toolchain.test.mjs', 'tests/storybook.test.mjs', 'tests/settings.test.ts', 'tests/shell.test.ts', 'tests/logs-page.test.ts', 'tests/unzip.test.mjs', 'tests/icons.test.mjs', 'tests/png.test.mjs', 'tests/engine-binaries.test.mjs', 'tests/reference-sources.test.mjs', 'tests/reference-reader.test.ts', 'tests/pota-reader.test.ts', 'tests/services.test.ts', 'tests/baseline-approval.test.mjs', 'tests/no-borrowed-identity.test.mjs', 'tests/package-boundaries.test.mjs']],
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
  ['electron-audit', ['scripts/electron-audit.mjs']]
];
}

export function suiteNames() {
  return suiteCommands('npm').map(([name]) => name);
}
