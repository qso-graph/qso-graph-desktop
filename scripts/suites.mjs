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
// that is killed rather than failed — electron-smoke waits 895s in total and
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
  'electron-smoke': 1_200_000,    // 895s of waits across 29 of them
  'home-cards': 900_000,          // 620s of waits, plus three launches
  stations: 1_200_000,            // 1020s of waits: the ADIF load's 180s, two launches, the editor
  'process-recovery': 360_000,    // 270s, with QG Storage's kill-and-recover (QGD-ENG-0006)
  screenshots: 720_000,           // 510s, with the Stations captures (P9)
  storybook: 900_000,             // a 600s build wait
  'packaged-launch': 720_000,     // 495s
  'connection-capture': 360_000,  // 210s, with the reference data loaded as an operator does
  'electron-audit': 480_000,      // a single 300s wait
  // An npm script, so its waits are not in a scripts/ file to read. Packaging
  // was inside the flat 120s bound on this machine with no headroom at all on
  // a slower one.
  package: 600_000,
  // cargo test, compiling the credential core and AWS-LC's FIPS module from
  // nothing when the build used a prebuilt core (CI's Linux jobs, which build
  // it against glibc 2.28 in a container). Minutes on a two-core runner; it
  // was killed at the flat 120 s and reported as a failure.
  'rust-unit': 900_000
};

export function suiteTimeout(name) {
  return SUITE_TIMEOUT_MS[name] ?? DEFAULT_SUITE_TIMEOUT_MS;
}

export function suiteCommands(npmCli) {
  return [
  ['spec-rvm', ['scripts/gen-rvm.mjs', '--check']],
  ['icons', ['scripts/gen-icons.mjs', '--check']],
  ['adif-reference', ['scripts/adif-reference.mjs']],
  ['package-boundaries', ['scripts/package-boundaries.mjs']],
  ['build', [npmCli, 'run', 'build']],
  ['unit', ['node_modules/vitest/vitest.mjs', 'run', 'tests/policy.test.ts', 'tests/report.test.mjs', 'tests/persona-contract.test.ts', 'tests/suite-gate.test.mjs', 'tests/network-static.test.mjs', 'tests/logging.test.ts', 'tests/core-logging.test.mjs', 'tests/diagnostics.test.ts', 'tests/endpoint.test.mjs', 'tests/toolchain.test.mjs', 'tests/storybook.test.mjs', 'tests/settings.test.ts', 'tests/shell.test.ts', 'tests/logs-page.test.ts', 'tests/unzip.test.mjs', 'tests/icons.test.mjs', 'tests/png.test.mjs', 'tests/reference-sources.test.mjs', 'tests/reference-reader.test.ts', 'tests/pota-reader.test.ts', 'tests/services.test.ts', 'tests/baseline-approval.test.mjs', 'tests/no-borrowed-identity.test.mjs', 'tests/package-boundaries.test.mjs', 'tests/extension-runtime.test.ts', 'tests/keychain-namespace.test.mjs', 'tests/setup-order.test.mjs', 'tests/extension-broker.test.mjs', 'tests/extension-serve.test.ts', 'tests/deadlines.test.mjs', 'tests/credential-store.test.ts', 'tests/manifest.test.ts', 'tests/cards.test.ts', 'tests/extension-limits.test.ts', 'tests/extension-host.test.ts', 'tests/home-cards.test.ts', 'tests/home-contract.test.ts', 'tests/home-store.test.ts', 'tests/extension-enablement.test.ts', 'tests/home-notice.test.ts', 'tests/station-brief.test.ts', 'tests/until-ready.test.ts', 'tests/window-visibility.test.ts', 'tests/suite-timeouts.test.mjs', 'tests/suite-speed.test.mjs']],
  // The SQLite stores (QGD-ENG-0001). Unit-shaped and fast:
  // node:sqlite loads under plain Node, so they need no window.
  ['storage', ['node_modules/vitest/vitest.mjs', 'run', 'tests/storage.test.ts', 'tests/reference-resources.test.ts']],
  ['storage-migrations', ['node_modules/vitest/vitest.mjs', 'run', 'tests/storage-migrations.test.ts']],
  // Stations (QGD-STN-*), checked against ADIF's own definitions (P9).
  ['stations-storage', ['node_modules/vitest/vitest.mjs', 'run', 'tests/stations.test.ts']],
  // The built-in extensions' own tests: On the Air's Conditions against the
  // NOAA responses shared with solar-mcp, Your station, and the sun. P8's
  // record called these proven while no suite ran them (found 2026-10-19).
  ['extension-tests', ['node_modules/vitest/vitest.mjs', 'run', 'extensions/']],
  ['reference-build', ['node_modules/vitest/vitest.mjs', 'run', 'tests/reference-build.test.ts']],
  ['rust-unit', ['scripts/rust-unit.mjs']],
  ['security-lint', ['scripts/lint.mjs']],
  ['crypto-evidence', ['scripts/crypto-evidence.mjs']],
  ['keychain-roundtrip', ['scripts/keychain-roundtrip.mjs']],
  ['credential-editing', ['scripts/credential-edit-smoke.mjs']],
  ['persona-export', ['scripts/persona-export.mjs']],
  ['electron-smoke', ['scripts/smoke.mjs']],
  ['home-cards', ['scripts/home-cards.mjs']],
  ['stations', ['scripts/stations.mjs']],
  ['setup-walk', ['scripts/setup-walk.mjs']],
  ['process-recovery', ['scripts/process-recovery.mjs']],
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

// Which suites a development run skips, and why they are derived rather than
// listed.
//
// Podman Desktop and VS Code both run lint, typecheck and unit tests on every
// change and push the expensive end-to-end set to main or a nightly schedule
// (podman-desktop/.github/workflows/pr-check.yaml against e2e-main.yaml;
// microsoft/vscode/.github/workflows/pr.yml against the per-platform
// pr-*-test.yml). The content is all still there — it is simply not in the way
// of every edit.
//
// `make verify` is unchanged and still runs every check (`QGD-TST-0001`). This
// is a second, narrower command for development, and it changes no gate.
//
// A suite is slow if its own script launches Electron or Playwright, or if it
// reads the packaged artifact — both read off the script rather than written
// down here, because a list of names is a thing somebody has to remember to
// extend and this project has four gates that went quiet exactly that way
// (`QGD-SEC-0021` is the same rule for the network scan's scope).
import { readFileSync } from 'node:fs';

// Three signals, all read off the suite's own script.
//
//   - it drives a window, or builds or audits a package
//   - it reads the operator's real credential store, so it can raise a
//     Keychain prompt and is not something to run on every save
//   - it builds the component gallery, which is a Storybook build
const LAUNCHES = /@playwright\/test|_electron|electron-builder|electronegativity/;
const TOUCHES_KEYCHAIN = /keychain-service\.mjs|QG_DESKTOP_TEST_KEYCHAIN/;
const BUILDS_GALLERY = /node_modules\/storybook\/dist\/bin\/dispatcher\.js/;

// The packaging chain: these need an artifact that only `package` produces, so
// they cannot run in a development pass whatever their script imports.
const NEEDS_PACKAGE = ['package', 'packaged-launch', 'electron-audit', 'package-contents'];

export function isSlowSuite(name, args) {
  if (NEEDS_PACKAGE.includes(name)) return true;
  const script = args.find(arg => typeof arg === 'string' && arg.startsWith('scripts/'));
  if (!script) return false;
  try {
    const text = readFileSync(script, 'utf8');
    return LAUNCHES.test(text) || TOUCHES_KEYCHAIN.test(text) || BUILDS_GALLERY.test(text);
  } catch {
    // A suite whose script cannot be read is treated as slow: running it in a
    // development pass and having it fail for a missing file would be a
    // development gate reporting a problem it cannot explain.
    return true;
  }
}

// The development pass: everything that needs no window and no package.
export function fastSuiteCommands(npmCli) {
  return suiteCommands(npmCli).filter(([name, args]) => !isSlowSuite(name, args));
}

export function suiteNames() {
  return suiteCommands('npm').map(([name]) => name);
}
