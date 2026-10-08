// SPDX-License-Identifier: GPL-3.0-only
// QGD-SEC-0014: Electronegativity over the packaged application.
//
// Runs from the root install. It needed its own dependency tree while this
// project was on TypeScript 7, whose API its parser could not use; TypeScript is
// pinned to 6.0.3 under QGD-SEC-0019 and that isolation is gone.
//
// Pointed at app.asar, not the .app bundle. Given the bundle it parses no
// JavaScript and reports three global findings that are all false.
//
// Told the real Electron version, because by default it assumes v0.1.0 and asks
// about the remote module Electron removed in 14.
//
// SARIF rather than CSV: the CSV writer starts an asynchronous header write and
// an asynchronous append without sequencing them, so the header can land on top
// of the first finding. SARIF is written once.
//
// A finding is accepted only when its check, its file AND a fingerprint of the
// reviewed line all match data/electron-audit-accepted.json. Matching the check
// and file alone would wave through a new switch or a second preload under a
// rationale written for different code.
import asar from '@electron/asar';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const binary = resolve('node_modules/.bin/electronegativity');
const archive = resolve('out/mac-arm64/QG Desktop.app/Contents/Resources/app.asar');
const sarif = resolve('report/electron-audit.sarif');
const ELECTRON_VERSION = JSON.parse(await readFile('package.json', 'utf8')).devDependencies.electron;

// The reviewed line, normalised so that reformatting is not a new review but a
// different statement is.
//
// Read out of the archive, not the working tree. SARIF's paths are relative to
// what was scanned, and the loose dist/ can differ from what was packaged — so
// hashing the working tree would let an altered packaged statement inherit an
// unchanged local one's fingerprint, and would reject an unchanged package
// whose dist/ had simply been cleaned.
function lineFromArchive(file, line) {
  let bytes;
  try { bytes = asar.extractFile(archive, file); } catch { return undefined; }
  const text = bytes.toString('utf8');
  return (text.split('\n')[line - 1] ?? '').replace(/\s+/g, ' ').trim();
}

function fingerprint(file, line) {
  const source = lineFromArchive(file, line);
  if (source === undefined) return 'unreadable';
  return createHash('sha256').update(source).digest('hex').slice(0, 12);
}

const failures = [];
for (const [path, message] of [
  [binary, 'Electronegativity is not installed. Run: npm ci'],
  [archive, `No packaged application to audit at ${archive}. Run: make package`]
]) {
  try { await access(path); } catch { failures.push(message); }
}

if (!failures.length) {
  await rm(sarif, { force: true });
  const run = spawnSync(binary, ['-i', archive, '-e', ELECTRON_VERSION, '-o', sarif], { encoding: 'utf8', timeout: 300_000 });
  const report = await readFile(sarif, 'utf8').catch(() => '');

  let parsed;
  try { parsed = JSON.parse(report); } catch { parsed = undefined; }
  if (run.error || !parsed?.runs?.[0]) {
    failures.push('Electronegativity produced no report, so a clean result would mean nothing.');
    failures.push(`${run.stdout || ''}${run.stderr || ''}`.split('\n').filter(Boolean).slice(0, 8).join(' | '));
  } else {
    const register = JSON.parse(await readFile('data/electron-audit-accepted.json', 'utf8'));
    const accepted = new Map(register.accepted.map(entry => [`${entry.check}|${entry.file}|${entry.sample}`, entry]));
    const counts = new Map();

    const findings = [];
    for (const result of parsed.runs[0].results ?? []) {
      const where = result.locations?.[0]?.physicalLocation ?? {};
      const file = where.artifactLocation?.uri ?? 'unknown';
      const line = where.region?.startLine ?? 0;
      findings.push({ check: result.ruleId, file, line, sample: fingerprint(file, line) });
    }

    for (const finding of findings) {
      const key = `${finding.check}|${finding.file}|${finding.sample}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      if (finding.sample === 'unreadable') {
        failures.push(`${finding.file}:${finding.line}  ${finding.check} — could not be read out of the archive, so it cannot be matched to a review.`);
      } else if (!accepted.has(key)) {
        failures.push(`${finding.file}:${finding.line}  ${finding.check}  sample ${finding.sample} — not reviewed. Add it to data/electron-audit-accepted.json with a reason, or fix the finding.`);
      }
    }
    for (const [key, entry] of accepted) {
      const seen = counts.get(key) ?? 0;
      const expected = entry.occurrences ?? 1;
      if (seen === 0) failures.push(`${key} is accepted but no longer reported; remove the entry`);
      else if (seen !== expected) failures.push(`${key} is accepted ${expected} time(s) but reported ${seen}; review the new occurrence`);
    }

    if (!failures.length) {
      console.log(`Electron audit: the packaged archive at Electron ${ELECTRON_VERSION}; ${findings.length} finding(s), each matching a reviewed sample, none stale: PASS`);
    }
  }
}

if (failures.length) {
  console.error('Electron audit failed.');
  for (const failure of failures) console.error(`  ${failure}`);
  process.exitCode = 1;
}
