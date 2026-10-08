// SPDX-License-Identifier: GPL-3.0-only
// QGD-CRD-0006: a credential never appears in a log, an error message, an IPC
// payload rendered to a screen, or a report. QGD-PII-0003 says the same of
// roster field values. Issue #3 item 3 is the scan; item 4's second half — that
// compliance claims stay absent until supported — is checked here too, because
// both are assertions over the artifacts a completed run produced.
//
// Run by scripts/verify.mjs AFTER summary.json and report.md are written. No
// suite can do this: those two files do not exist until every suite has
// finished, so a suite scanning them reads the previous run's.
//
// Positive controls throughout. A scanner that matches nothing reports every
// artifact clean, and a claim checker that recognises nothing passes everything.
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

// The shape scripts/report.mjs redacts, so scanner and redactor cannot drift.
export const SENTINEL = /QG_FAKE_(?:CREDENTIAL|ROSTER)_[A-Za-z0-9_-]+/g;

// Language asserting validation, certification or an approved mode. "Built
// against AWS-LC FIPS" is a build fact; these would be claims about a
// certificate, a module boundary and an operational environment.
// Identified by opaque id, never by their wording: a finding records the id and
// the location only. Writing the matched text into report/artifact-scan.json
// made the next scan flag this scan's own diagnostic, so a single claim failed
// every run after it until the evidence file was deleted by hand. The same rule
// already applied to sentinels; it applies here for the same reason.
//
// Not the bare word CMVP: naming the register is a fact, and
// report/crypto-evidence.json records the comparison against it. Quoting a
// certificate number in a report about this build is the claim.
const COMPLIANCE_CLAIMS = [
  { id: 'C1', pattern: /FIPS\s*140(?:-[23])?\s*(?:validated|certified|compliant|approved)/i },
  { id: 'C2', pattern: /validated\s+(?:crypto(?:graphic)?\s+)?module/i },
  { id: 'C3', pattern: /certificate\s*#?\s*\d{4,}/i },
  { id: 'C4', pattern: /FIPS\s+(?:mode\s+)?(?:certified|validated)/i },
  { id: 'C5', pattern: /meets\s+FIPS/i }
];
const claimIn = text => COMPLIANCE_CLAIMS.filter(claim => claim.pattern.test(text)).map(claim => claim.id);

const RECENT_MS = 60 * 60 * 1000;
const CRASH_REPORTS = join(homedir(), 'Library/Logs/DiagnosticReports');
const PACKAGED = resolve('out/mac-arm64/QG Desktop.app/Contents/Resources');
// Pixels are not text. A credential rendered into a screenshot cannot be found
// by scanning bytes, so these are scanned for embedded ASCII only — metadata and
// text chunks — and the claim is limited accordingly. Visible disclosure is
// asserted where the screenshot is taken: scripts/smoke.mjs checks the rendered
// body text carries no sentinel before capturing.
const PIXELS = /\.(png|jpg|jpeg|gif|webp|icns)$/i;

// Missing is fine; unreadable is not. A file that cannot be read must never be
// counted as a clean file.
async function walk(directory, { recent = false, match } = {}) {
  const files = [];
  const unreadable = [];
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code !== 'ENOENT') unreadable.push({ path: directory, code: error.code });
    return { files, unreadable };
  }
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = await walk(path, { recent, match });
      files.push(...nested.files);
      unreadable.push(...nested.unreadable);
      continue;
    }
    if (!entry.isFile()) continue;
    if (match && !match.test(entry.name)) continue;
    if (recent) {
      try {
        const info = await stat(path);
        if (Date.now() - info.mtimeMs > RECENT_MS) continue;
      } catch (error) {
        if (error.code !== 'ENOENT') unreadable.push({ path, code: error.code });
        continue;
      }
    }
    files.push(path);
  }
  return { files, unreadable };
}

export function sentinelsIn(text) {
  return [...String(text).matchAll(SENTINEL)].map(match => match[0]);
}

async function scan(label, { files, unreadable }) {
  const findings = [];
  let scanned = 0;
  const skipped = [...unreadable];
  for (const path of files) {
    let bytes;
    try {
      bytes = await readFile(path);
    } catch (error) {
      // Gone between listing and reading is not a finding; anything else is.
      if (error.code !== 'ENOENT') skipped.push({ path, code: error.code });
      continue;
    }
    scanned++;
    // latin1 so a sentinel embedded in a non-UTF-8 artifact is still found.
    const found = sentinelsIn(bytes.toString('latin1'));
    // The value is never reported: only where, and how many.
    if (found.length) findings.push({ path, occurrences: found.length });
  }
  return { label, filesScanned: scanned, pixelFilesTextOnly: files.filter(path => PIXELS.test(path)).length, findings, unreadable: skipped };
}

// Returns { ok, failures, evidence }. Never throws for a finding: the caller
// decides, because it has a report to write either way.
export async function artifactScan() {
  const failures = [];
  const control = resolve('report/artifact-scan-control.tmp');
  await mkdir('report', { recursive: true });

  // Control 1: the scanner must find a planted sentinel.
  await writeFile(control, 'planted QG_FAKE_CREDENTIAL_control0000 for the control\n');
  const controlScan = await scan('control', { files: [control], unreadable: [] });
  await rm(control, { force: true });
  if (controlScan.findings.length !== 1) failures.push('the scanner did not find a planted sentinel, so a clean result would mean nothing');

  // Control 2: the claim checker must recognise a claim.
  const claimControl = ['this build is FIPS 140-3 validated', 'validated cryptographic module', 'certificate #5429']
    .every(claim => claimIn(claim).length > 0);
  if (!claimControl) failures.push('the compliance-claim checker does not recognise a known claim');
  // And it must not fire on the register being named, or recording the facts
  // becomes impossible.
  const factControl = ['cmvpComparison', 'register: data/cmvp-aws-lc.json', 'appearsInValidatedList: false']
    .every(fact => claimIn(fact).length === 0);
  if (!factControl) failures.push('the compliance-claim checker fires on a recorded fact');

  const targets = [
    ['reports and evidence', await walk(resolve('report'))],
    ['crash artifacts', await walk(CRASH_REPORTS, { recent: true, match: /Electron|QG.?Desktop|qg-desktop|persona/i })],
    ['profile and preference files left in the repository', await walk(resolve('.'), { match: /^(personas\.json|desktop-preferences\.json|current\.txt)$/ })],
    // No extension filter: ASAR enabled means the application's own code lives
    // in app.asar, which stores its entries uncompressed, so a sentinel inside
    // it is plain text in the archive.
    ['packaged application', await walk(PACKAGED)],
    ['compiled output', await walk(resolve('dist'))]
  ];

  const scans = [];
  for (const [label, found] of targets) scans.push(await scan(label, found));

  for (const result of scans) {
    for (const finding of result.findings) failures.push(`${result.label}: sentinel in ${finding.path} (${finding.occurrences})`);
    for (const entry of result.unreadable) failures.push(`${result.label}: could not read ${entry.path} (${entry.code}) — coverage incomplete`);
  }

  // Coverage must be real. A scan of nothing is not a clean scan.
  const reports = scans.find(result => result.label === 'reports and evidence');
  if (reports.filesScanned < 2) failures.push(`only ${reports.filesScanned} report artifacts were scanned`);
  const packaged = scans.find(result => result.label === 'packaged application');
  let packagedExists = true;
  try { await stat(PACKAGED); } catch { packagedExists = false; }
  if (packagedExists && packaged.filesScanned === 0) failures.push('the packaged application exists but nothing in it was scanned');

  // Compliance claims, over this run's completed text artifacts.
  const claims = [];
  const textArtifacts = reports ? (await walk(resolve('report'), { match: /\.(md|json|txt|log)$/ })).files : [];
  for (const path of textArtifacts) {
    const text = await readFile(path, 'utf8').catch(() => '');
    // The id and the location, never the wording.
    for (const id of claimIn(text)) claims.push({ path, claimPattern: id });
  }
  for (const claim of claims) failures.push(`unsupported compliance claim ${claim.claimPattern} in ${claim.path}`);
  if (textArtifacts.length === 0) failures.push('no text artifacts were checked for compliance claims');

  const evidence = {
    date: new Date().toISOString(),
    pattern: 'QG_FAKE_(CREDENTIAL|ROSTER)_<id>, the shape scripts/report.mjs redacts',
    positiveControls: { plantedSentinelFound: controlScan.findings.length === 1, claimCheckerRecognisesAClaim: claimControl },
    coverage: {
      note: 'Artifacts are read as bytes and decoded as latin1, so a sentinel embedded in a non-UTF-8 artifact is found. Only locations and counts are recorded, never a matched value.',
      pixelLimitation: 'Image files are scanned for embedded ASCII only. A credential rendered as pixels cannot be found this way; visible disclosure is asserted at capture time in scripts/smoke.mjs, which checks the rendered body text carries no sentinel before the screenshot is taken.',
      suiteOutput: 'Each suite\'s stdout and stderr are scanned by scripts/verify.mjs before redaction or disposal; successful output is otherwise discarded, so it cannot be scanned here.',
      crashArtifactsWindowMinutes: RECENT_MS / 60000
    },
    complianceClaimsFound: claims,
    filesScanned: scans.reduce((total, result) => total + result.filesScanned, 0),
    scans
  };
  // Before writing: this file is scanned by the next run, so it must not itself
  // contain a sentinel or claim language. Checked rather than assumed, because
  // assuming it is exactly how the previous version poisoned every later run.
  const serialized = JSON.stringify(evidence, null, 2);
  const selfSentinels = sentinelsIn(serialized);
  const selfClaims = claimIn(serialized);
  if (selfSentinels.length) failures.push(`this scan's own evidence would carry ${selfSentinels.length} sentinel(s); not written`);
  if (selfClaims.length) failures.push(`this scan's own evidence would carry claim language (${selfClaims.join(', ')}); not written`);
  if (!selfSentinels.length && !selfClaims.length) await writeFile('report/artifact-scan.json', serialized + '\n');
  return { ok: failures.length === 0, failures, evidence };
}

// Standalone use, for a scan outside a verification run.
if (import.meta.url === `file://${process.argv[1]}`) {
  const { ok, failures, evidence } = await artifactScan();
  if (!ok) {
    console.error('Artifact scan failed.');
    for (const failure of failures) console.error(`  ${failure}`);
    process.exitCode = 1;
  } else {
    console.log(`Artifact scan: ${evidence.filesScanned} files, no sentinel and no unsupported compliance claim: PASS`);
  }
}
