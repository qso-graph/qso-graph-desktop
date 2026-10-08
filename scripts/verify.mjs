// SPDX-License-Identifier: GPL-3.0-only
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { markdown, redact } from './report.mjs';
import { blockedBy } from './suite-gate.mjs';

await mkdir('report', { recursive: true });
let previous;
try { previous = JSON.parse(await readFile('report/summary.json', 'utf8')); } catch {}
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run verification with make verify or npm run verify.');
const commands = [
  ['spec-rvm', ['scripts/gen-rvm.mjs', '--check']],
  ['build', [npmCli, 'run', 'build']],
  ['unit', ['node_modules/vitest/vitest.mjs', 'run', 'tests/policy.test.ts', 'tests/report.test.mjs', 'tests/persona-contract.test.ts', 'tests/suite-gate.test.mjs']],
  ['keychain-interop', ['scripts/interop.mjs']],
  ['credential-editing', ['scripts/credential-edit-smoke.mjs']],
  ['electron-smoke', ['scripts/smoke.mjs']],
  ['package', [npmCli, 'run', 'package']],
  ['packaged-launch', ['scripts/packaged-smoke.mjs']]
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
  const passed = run.status === 0 && !run.error;
  suites.push({ name, result: passed ? 'PASS' : 'FAIL', ...(passed ? {} : {
    failure: redact(`${run.stdout || ''}\n${run.stderr || ''}`).split('\n').filter(Boolean).slice(0, 20).join('\n') || 'Command did not finish.'
  }) });
}
const head = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' });
const report = {
  sha: head.status === 0 ? head.stdout.trim() : 'uncommitted-local-preview',
  date: new Date().toISOString(), os: process.platform, arch: process.arch,
  result: suites.every(s => s.result === 'PASS') ? 'PASS' : 'FAIL',
  partSignOff: 'PENDING', retries: 0, suites,
  delta: previous ? `${previous.result} → ${suites.every(s => s.result === 'PASS') ? 'PASS' : 'FAIL'}` : 'first local run'
};
await writeFile('report/summary.json', JSON.stringify(report, null, 2) + '\n');
await writeFile('report/report.md', markdown(report));
console.log(`Local verification: ${report.result}. See report/report.md.`);
process.exitCode = report.result === 'PASS' ? 0 : 1;
