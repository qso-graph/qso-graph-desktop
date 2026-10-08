// SPDX-License-Identifier: GPL-3.0-only
// QGD-CRD-0006: a credential never appears in a log, an error message, an IPC
// payload rendered to a screen, or a report. QGD-PII-0003 applies the same rule
// to roster field values.
//
// Issue #3, item 3: complete sentinel scans of reports, errors, logs and
// applicable crash artifacts.
//
// Every suite that handles a synthetic secret names it QG_FAKE_CREDENTIAL_<uuid>
// or QG_FAKE_ROSTER_<uuid>, which is also what scripts/report.mjs redacts. This
// scans the artifacts those suites leave behind for that shape. It runs last, so
// what it reads is what the whole verification actually produced.
//
// It does no credential work of its own, so a failed credential round-trip does
// not stop it: scanning the artifacts of a failed run is more useful than
// skipping the scan.
//
// A planted sentinel is scanned for first. A scanner that silently matches
// nothing would otherwise report every artifact clean, which is the failure mode
// to design against, not the result to hope for.
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect } from '@playwright/test';

// The shape scripts/report.mjs redacts, so the two cannot drift apart.
const SENTINEL = /QG_FAKE_(?:CREDENTIAL|ROSTER)_[A-Za-z0-9_-]+/g;
const RECENT_MS = 60 * 60 * 1000;
const CRASH_REPORTS = join(homedir(), 'Library/Logs/DiagnosticReports');
const control = resolve('report/sentinel-control.tmp');
let planted = false;

async function filesUnder(directory, { recent = false, match } = {}) {
  const found = [];
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); } catch { return found; }
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) { found.push(...await filesUnder(path, { recent, match })); continue; }
    if (!entry.isFile()) continue;
    if (match && !match.test(entry.name)) continue;
    if (recent) {
      const info = await stat(path).catch(() => undefined);
      if (!info || Date.now() - info.mtimeMs > RECENT_MS) continue;
    }
    found.push(path);
  }
  return found;
}

// Read as bytes and decode loosely: a screenshot or a crash report is not UTF-8,
// and a sentinel embedded in one must still be found.
async function hits(path) {
  const bytes = await readFile(path).catch(() => undefined);
  if (!bytes) return [];
  const text = bytes.toString('latin1');
  return [...text.matchAll(SENTINEL)].map(match => match[0]);
}

async function scan(label, paths) {
  const findings = [];
  for (const path of paths) {
    const found = await hits(path);
    // The value itself is never reported: only where and how many.
    if (found.length) findings.push({ path, occurrences: found.length });
  }
  return { label, filesScanned: paths.length, findings };
}

try {
  await mkdir('report', { recursive: true });

  // The positive control: a planted sentinel the scan must find.
  await writeFile(control, `planted QG_FAKE_CREDENTIAL_${'control'.padEnd(8, '0')} for the control\n`);
  planted = true;
  const controlScan = await scan('control', [control]);
  expect(controlScan.findings.length, 'the scanner did not find a planted sentinel, so a clean result would mean nothing').toBe(1);
  await rm(control, { force: true });
  planted = false;

  const targets = [
    ['reports and evidence', await filesUnder(resolve('report'))],
    ['crash artifacts', await filesUnder(CRASH_REPORTS, { recent: true, match: /Electron|QG.?Desktop|qg-desktop|persona/i })],
    ['profile and preference files left in the repository', await filesUnder(resolve('.'), { match: /^(personas\.json|desktop-preferences\.json|current\.txt)$/ })],
    ['packaged application resources', await filesUnder(resolve('out/mac-arm64/QG Desktop.app/Contents/Resources'), { match: /\.(json|js|cjs|mjs|html|css|txt|md)$/ })],
    ['compiled output', await filesUnder(resolve('dist'), { match: /\.(js|cjs|mjs|html|css|json|map)$/ })]
  ];

  const scans = [];
  for (const [label, paths] of targets) scans.push(await scan(label, paths));

  const leaked = scans.flatMap(result => result.findings.map(finding => `${result.label}: ${finding.path} (${finding.occurrences})`));
  expect(leaked, leaked.join('; ')).toEqual([]);

  const scanned = scans.reduce((total, result) => total + result.filesScanned, 0);
  // A scan of nothing is not a clean scan. The report directory alone always
  // holds this run's summary, report and connection evidence.
  expect(scanned, 'the scan covered no files at all').toBeGreaterThan(0);
  const reportFiles = scans.find(result => result.label === 'reports and evidence');
  expect(reportFiles.filesScanned, 'no report artifacts were scanned').toBeGreaterThanOrEqual(2);

  await writeFile('report/sentinel-scan.json', JSON.stringify({
    date: new Date().toISOString(),
    pattern: 'QG_FAKE_(CREDENTIAL|ROSTER)_<id>, the shape scripts/report.mjs redacts',
    positiveControl: { planted: true, found: controlScan.findings.length === 1 },
    note: 'Files are read as bytes and decoded as latin1, so a sentinel inside a screenshot or a crash report is still found. Only locations and counts are recorded, never a matched value.',
    crashArtifactsWindowMinutes: RECENT_MS / 60000,
    filesScanned: scanned,
    scans
  }, null, 2) + '\n');

  console.log(`Sentinel scan: ${scanned} files across ${scans.length} target sets, no credential or roster sentinel present: PASS`);
  console.log(`Crash artifacts examined: ${scans.find(result => result.label === 'crash artifacts').filesScanned}. Planted control found: PASS`);
} catch (error) {
  console.error('Sentinel scan failed.');
  console.error(error.message.split('\n').slice(0, 20).join('\n'));
  process.exitCode = 1;
} finally {
  if (planted) await rm(control, { force: true });
}
