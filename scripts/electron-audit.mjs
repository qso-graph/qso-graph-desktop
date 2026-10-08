// SPDX-License-Identifier: GPL-3.0-only
// QGD-SEC-0014: Electronegativity over the packaged application.
//
// Run from tools/electronegativity, which has its own dependency tree: its
// TypeScript parser needs TypeScript 5 and this project is on 7, and a hoisted
// 7 stops the tool starting at all.
//
// Pointed at app.asar, not the .app bundle. Given the bundle it parses no
// JavaScript and reports three global findings that are all false — the
// application does set a content policy, a window-open handler, navigation
// prevention and permission handlers. Given the archive it reads the code.
//
// Told the real Electron version, because by default it assumes v0.1.0 and asks
// about the remote module, which Electron removed in 14.
//
// A finding must be in data/electron-audit-accepted.json or this fails. An
// entry there that the tool no longer reports also fails, so the list cannot
// outlive the thing it explains.
import { spawnSync } from 'node:child_process';
import { access, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const ANSI = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g');
const binary = resolve('tools/electronegativity/node_modules/.bin/electronegativity');
const archive = resolve('out/mac-arm64/QG Desktop.app/Contents/Resources/app.asar');
const csv = resolve('report/electron-audit.csv');
const ELECTRON_VERSION = JSON.parse(await readFile('package.json', 'utf8')).devDependencies.electron;

// A CSV field may hold commas inside quotes; the sample column always does.
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { field += '"'; index++; }
      else if (character === '"') quoted = false;
      else field += character;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === ',') { row.push(field.trim()); field = ''; }
    else if (character === '\n') { row.push(field.trim()); rows.push(row); row = []; field = ''; }
    else if (character !== '\r') field += character;
  }
  if (field || row.length) { row.push(field.trim()); rows.push(row); }
  return rows.filter(entry => entry.length > 1);
}

const failures = [];
for (const [path, message] of [[binary, 'Electronegativity is not installed. Run: npm install --prefix tools/electronegativity'],
                               [archive, `No packaged application to audit at ${archive}. Run: make package`]]) {
  try { await access(path); } catch { failures.push(message); }
}

if (!failures.length) {
  // Removed first: the tool does not truncate, so a previous longer report
  // leaves bytes under a shorter one and the parse reads a corrupted row — or,
  // worse, a stale finding.
  await rm(csv, { force: true });
  const run = spawnSync(binary, ['-i', archive, '-e', ELECTRON_VERSION, '-o', csv], { encoding: 'utf8', timeout: 300_000 });
  const output = `${run.stdout || ''}${run.stderr || ''}`.replace(ANSI, '');

  // With -o the tool writes the file and prints no banner, so the proof that it
  // ran is the file itself. The real control is the staleness check below: the
  // accepted entries are findings we know this application produces, so a tool
  // that reported nothing would fail on all three rather than pass silently.
  const report = await readFile(csv, 'utf8').catch(() => '');
  if (run.error || !report.startsWith('issue, severity, confidence')) {
    failures.push('Electronegativity produced no report, so a clean result would mean nothing.');
    failures.push(output.split('\n').filter(Boolean).slice(0, 10).join(' | '));
  } else {
    const register = JSON.parse(await readFile('data/electron-audit-accepted.json', 'utf8'));
    const accepted = new Map(register.accepted.map(entry => [`${entry.check}|${entry.file}`, entry]));
    const seen = new Set();

    const rows = parseCsv(report);
    const findings = rows.slice(1).map(([check, severity, confidence, file, location]) => ({ check, severity, confidence, file, location }));

    for (const finding of findings) {
      const key = `${finding.check}|${finding.file}`;
      seen.add(key);
      if (!accepted.has(key)) {
        failures.push(`${finding.file}:${finding.location}  ${finding.check}  ${finding.severity}/${finding.confidence} — not in data/electron-audit-accepted.json`);
      }
    }
    for (const key of accepted.keys()) {
      if (!seen.has(key)) failures.push(`${key} is accepted but the tool no longer reports it; remove the entry`);
    }

    if (!failures.length) {
      console.log(`Electron audit: the packaged archive at Electron ${ELECTRON_VERSION}; ${findings.length} finding(s), all reviewed and accepted, none stale: PASS`);
    }
  }
}

if (failures.length) {
  console.error('Electron audit failed.');
  for (const failure of failures) console.error(`  ${failure}`);
  process.exitCode = 1;
}
