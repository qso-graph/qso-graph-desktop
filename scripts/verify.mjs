// SPDX-License-Identifier: GPL-3.0-only
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { markdown, redact } from './report.mjs';
import { blockedBy } from './suite-gate.mjs';
import { artifactScan, sentinelsIn } from './artifact-scan.mjs';

await mkdir('report', { recursive: true });
let previous;
try { previous = JSON.parse(await readFile('report/summary.json', 'utf8')); } catch {}
// The sign-off register, so the report states what is actually signed off.
let signedOff = [];
try { signedOff = JSON.parse(await readFile('data/part-signoff.json', 'utf8')).signedOff ?? []; }
catch { signedOff = []; }
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run verification with make verify or npm run verify.');
const commands = [
  ['spec-rvm', ['scripts/gen-rvm.mjs', '--check']],
  ['icons', ['scripts/gen-icons.mjs', '--check']],
  ['engine-binaries', ['scripts/engine-binaries.mjs']],
  ['adif-reference', ['scripts/adif-reference.mjs']],
  ['build', [npmCli, 'run', 'build']],
  ['unit', ['node_modules/vitest/vitest.mjs', 'run', 'tests/policy.test.ts', 'tests/report.test.mjs', 'tests/persona-contract.test.ts', 'tests/suite-gate.test.mjs', 'tests/network-static.test.mjs', 'tests/logging.test.ts', 'tests/core-logging.test.mjs', 'tests/diagnostics.test.ts', 'tests/endpoint.test.mjs', 'tests/toolchain.test.mjs', 'tests/storybook.test.mjs', 'tests/settings.test.ts', 'tests/shell.test.ts', 'tests/logs-page.test.ts', 'tests/unzip.test.mjs', 'tests/icons.test.mjs', 'tests/png.test.mjs', 'tests/engine-binaries.test.mjs', 'tests/reference-sources.test.mjs']],
  ['rust-unit', ['scripts/rust-unit.mjs']],
  ['security-lint', ['scripts/lint.mjs']],
  ['crypto-evidence', ['scripts/crypto-evidence.mjs']],
  ['keychain-roundtrip', ['scripts/keychain-roundtrip.mjs']],
  ['credential-editing', ['scripts/credential-edit-smoke.mjs']],
  ['electron-smoke', ['scripts/smoke.mjs']],
  ['process-recovery', ['scripts/process-recovery.mjs']],
  ['engine-lifecycle', ['scripts/engine-lifecycle.mjs']],
  ['engine-migrations', ['scripts/engine-migrations.mjs']],
  ['engine-backup', ['scripts/engine-backup.mjs']],
  ['connection-capture', ['scripts/connection-capture.mjs']],
  ['axe', ['scripts/axe.mjs']],
  ['screenshots', ['scripts/screenshots.mjs']],
  ['storybook', ['scripts/storybook.mjs']],
  ['story-themes', ['scripts/story-themes.mjs']],
  ['package', [npmCli, 'run', 'package']],
  ['packaged-launch', ['scripts/packaged-smoke.mjs']],
  ['electron-audit', ['scripts/electron-audit.mjs']]
];
const suites = [];
for (const [name, args] of commands) {
  // QGD-TST-0007: stop only the suites whose result depends on what failed.
  const blocked = blockedBy(name, suites);
  if (blocked) {
    suites.push({ name, result: 'NOT RUN', blockedBy: blocked });
    continue;
  }
  const run = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 120_000, maxBuffer: 2_000_000 });
  const output = `${run.stdout || ''}\n${run.stderr || ''}`;
  // QGD-CRD-0006: a suite's own output is a place a credential could appear, and
  // successful output is discarded while failed output is redacted — so neither
  // survives to be scanned later. It is scanned here, before either happens.
  const leaked = sentinelsIn(output);
  const passed = run.status === 0 && !run.error && leaked.length === 0;
  suites.push({
    name,
    result: passed ? 'PASS' : 'FAIL',
    ...(leaked.length ? { sentinelsPrinted: leaked.length } : {}),
    ...(passed ? {} : {
      failure: leaked.length
        ? `Printed ${leaked.length} credential sentinel(s) to its output. Values omitted.`
        : redact(output).split('\n').filter(Boolean).slice(0, 20).join('\n') || 'Command did not finish.'
    })
  });
}
const head = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' });
const outcome = () => (suites.every(s => s.result === 'PASS') ? 'PASS' : 'FAIL');
const report = {
  sha: head.status === 0 ? head.stdout.trim() : 'uncommitted-local-preview',
  date: new Date().toISOString(), os: process.platform, arch: process.arch,
  result: outcome(),
  partSignOff: signedOff, retries: 0, suites,
  delta: previous ? `${previous.result} → ${outcome()}` : 'first local run'
};
const write = async () => {
  await writeFile('report/summary.json', JSON.stringify(report, null, 2) + '\n');
  await writeFile('report/report.md', markdown(report));
};
// Written once so the artifact scan has this run's report and summary to read —
// no suite can scan them, because they do not exist until every suite is done.
await write();

// Then scanned, and the result folded in. The rewrite that follows adds only
// this row and its failure text, which carries paths and counts, never a value.
const scan = await artifactScan();
suites.push({
  name: 'artifact-scan',
  result: scan.ok ? 'PASS' : 'FAIL',
  ...(scan.ok ? {} : { failure: scan.failures.slice(0, 20).join('\n') })
});
report.result = outcome();
report.delta = previous ? `${previous.result} → ${report.result}` : 'first local run';
await write();

console.log(`Local verification: ${report.result}. See report/report.md.`);
process.exitCode = report.result === 'PASS' ? 0 : 1;
