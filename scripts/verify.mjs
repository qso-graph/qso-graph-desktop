// SPDX-License-Identifier: GPL-3.0-only
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { markdown, redact } from './report.mjs';
import { blockedBy } from './suite-gate.mjs';
import { artifactScan, sentinelsIn } from './artifact-scan.mjs';
import { fastSuiteCommands, suiteCommands, suiteTimeout } from './suites.mjs';

await mkdir('report', { recursive: true });
let previous;
try { previous = JSON.parse(await readFile('report/summary.json', 'utf8')); } catch {}
// The sign-off register, so the report states what is actually signed off.
let signedOff = [];
try { signedOff = JSON.parse(await readFile('data/part-signoff.json', 'utf8')).signedOff ?? []; }
catch { signedOff = []; }
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run verification with make verify or npm run verify.');
// --fast: the development pass. Everything that needs no window, no package
// and no credential store — nine of the suites, which is roughly the shape of
// Podman Desktop's pr-check and VS Code's pr.yml.
//
// It writes NO report, deliberately. report/report.md and report/summary.json
// are the evidence a Part is signed off against (`QGD-TST-0001` has one
// command run every check), and a fast run that produced them would be a
// partial run wearing a full run's clothes. So a development pass prints and
// exits, and `make verify` remains the only thing that reports.
// --suites a,b,c: the named suites only, as CI runs the window suites on each
// platform. Like --fast it writes no report: it is not a full run.
const named = process.argv.includes('--suites')
  ? (process.argv[process.argv.indexOf('--suites') + 1] ?? '').split(',').filter(Boolean)
  : undefined;
if (named) {
  const unknown = named.filter(name => !suiteCommands(npmCli).some(([known]) => known === name));
  if (named.length === 0 || unknown.length) throw new Error(`Unknown suite(s): ${unknown.join(', ') || '(none named)'}`);
}
const fast = process.argv.includes('--fast') || named !== undefined;
const commands = named
  ? suiteCommands(npmCli).filter(([name]) => named.includes(name))
  : fast ? fastSuiteCommands(npmCli) : suiteCommands(npmCli);
const suites = [];
for (const [name, args] of commands) {
  // QGD-TST-0007: stop only the suites whose result depends on what failed.
  const blocked = blockedBy(name, suites);
  if (blocked) {
    suites.push({ name, result: 'NOT RUN', blockedBy: blocked });
    continue;
  }
  // Per suite: a flat bound killed any suite that legitimately waits longer
  // than it, which is not the same as failing it (see suites.mjs).
  const run = spawnSync(process.execPath, args,
    { encoding: 'utf8', timeout: suiteTimeout(name), maxBuffer: 2_000_000 });
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
    // Killed at its time limit is said as such: otherwise it reads as a
    // failure, with whatever the suite happened to print last.
    ...(passed ? {} : { failure: summarize(output, leaked.length,
      run.error && /ETIMEDOUT/.test(String(run.error)) ? `Stopped at its time limit of ${suiteTimeout(name) / 1000} s, before it finished.` : undefined) })
  });
}
// What a failed suite said, in the lines that say what failed: the failing
// tests, their errors, and which test printed what. The first lines of the
// output were mostly the tests that passed, so the failure was cut off. A line
// holding a sentinel is never shown, whatever else it says (QGD-CRD-0006).
function summarize(output, leaked, stopped) {
  const lines = redact(output).split('\n').filter(line => line.trim() && sentinelsIn(line).length === 0);
  const telling = lines.filter(line => /×|❯|FAIL|Error|expected|Expected|Received|Timed out|timed out|stdout \||stderr \|/.test(line));
  const shown = (telling.length ? telling : lines).slice(0, 40).join('\n');
  const head = (stopped ? `${stopped}\n` : '') + (leaked ? `Printed ${leaked} credential sentinel(s) to its output. Values omitted.\n` : '');
  return (head + shown).trim() || 'Command did not finish.';
}

// Which commit this report is evidence for. Two failures look alike and are
// not: git unable to read the checkout (a tooling problem: the commit is
// fine, the report just cannot name it) and a tree with uncommitted changes
// (an evidence problem: the report covers code no commit holds). The first
// is named and explained; the second is stamped "-dirty", as git describe does.
// The verification account hits the first whenever the checkout belongs to
// another user; git's safe.directory setting is the fix.
function commitStamp() {
  const head = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' });
  if (head.status !== 0) {
    const ownership = /dubious ownership|safe\.directory/.test(head.stderr ?? '');
    console.error(ownership
      ? 'git cannot read this checkout: it belongs to another user. Add it to git\'s safe.directory.'
      : 'git cannot read this checkout; the report will not name a commit.');
    return ownership ? 'unknown-commit (checkout owned by another user)' : 'unknown-commit (not a readable git checkout)';
  }
  const sha = head.stdout.trim();
  const status = spawnSync('git', ['status', '--porcelain'], { encoding: 'utf8' });
  if (status.status !== 0) {
    console.error('git could not say whether this checkout has uncommitted changes.');
    return `${sha}-unverified (git status failed)`;
  }
  return status.stdout.trim() !== '' ? `${sha}-dirty` : sha;
}
const outcome = () => (suites.every(s => s.result === 'PASS') ? 'PASS' : 'FAIL');
const report = {
  sha: commitStamp(),
  date: new Date().toISOString(), os: process.platform, arch: process.arch,
  result: outcome(),
  partSignOff: signedOff, retries: 0, suites,
  delta: previous ? `${previous.result} → ${outcome()}` : 'first local run'
};
const write = async () => {
  await writeFile('report/summary.json', JSON.stringify(report, null, 2) + '\n');
  await writeFile('report/report.md', markdown(report));
};
if (fast) {
  const failed = suites.filter(suite => suite.result !== 'PASS');
  for (const suite of failed) {
    console.error(`${suite.name}: ${suite.result}`);
    if (suite.failure) console.error(suite.failure.split('\n').slice(0, 40).map(line => `  ${line}`).join('\n'));
  }
  console.log(failed.length === 0
    ? `Development pass: ${suites.length} of ${suiteCommands(npmCli).length} suites PASS. `
      + 'No report written; run make verify before a sign-off.'
    : `Development pass: ${failed.length} of ${suites.length} FAILED.`);
  process.exitCode = failed.length === 0 ? 0 : 1;
} else {

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
}
