#!/usr/bin/env node
// Generates rvm/QGD-RVM-001.md from the Verify columns of spec/QGD-SPEC-001.md.
//
// QGD-TST-0004: a hand-edited RVM fails `make verify`.
// QGD-TST-0005: a requirement with no Verify method fails `make verify`.
//
//   node scripts/gen-rvm.mjs          write the RVM
//   node scripts/gen-rvm.mjs --check  fail if the RVM on disk is not what this would write

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SPEC = resolve(root, 'spec/QGD-SPEC-001.md');
const RVM = resolve(root, 'rvm/QGD-RVM-001.md');

const ID = /^QGD-[A-Z]{3}-\d{4}(?:\.\d+)?$/;
const METHODS = new Set(['Test', 'Static', 'Demo', 'Inspection']);

const cells = (line) =>
  line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

const unticked = (s) => s.replace(/^`|`$/g, '');

function parse(spec) {
  const reqs = [];
  const errors = [];

  for (const line of spec.split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const c = cells(line);

    // Requirement row:  | `ID` | text | Verify |
    // The ID is tested BEFORE the column count: a row that drops the Verify cell
    // entirely must fail QGD-TST-0005, not be skipped as "not a requirement row".
    if (ID.test(unticked(c[0]))) {
      const id = unticked(c[0]);
      const text = c[1] ?? '';
      if (c.length < 3) {
        errors.push(`${id}: no Verify column (QGD-TST-0005)`);
        reqs.push({ id, text, verify: [], kind: 'requirement' });
        continue;
      }
      const verify = c[2]
        .split(',')
        .map((m) => m.trim())
        .filter(Boolean);

      if (verify.length === 0) {
        errors.push(`${id}: no Verify method (QGD-TST-0005)`);
      }
      for (const m of verify) {
        if (!METHODS.has(m)) errors.push(`${id}: unknown Verify method "${m}"`);
      }
      reqs.push({ id, text, verify, kind: 'requirement' });
      continue;
    }

    // Part row:  | **Pn** | `ID` | what | depends | exit gate |
    if (c.length >= 5 && ID.test(unticked(c[1]))) {
      reqs.push({
        id: unticked(c[1]),
        text: c[2],
        verify: ['Exit gate'],
        gate: c[4],
        part: c[0].replace(/\*/g, ''),
        kind: 'part',
      });
    }
  }

  const seen = new Set();
  for (const r of reqs) {
    if (seen.has(r.id)) errors.push(`${r.id}: duplicate ID`);
    seen.add(r.id);
  }

  return { reqs, errors };
}

function sha() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return 'uncommitted';
  }
}

function render(reqs) {
  const banner = `GENERATED from spec/QGD-SPEC-001.md at \`${sha()}\` — hand edits fail \`make verify\` (QGD-TST-0004); the spec's Verify columns are normative, this matrix is derived.`;
  const parts = reqs.filter((r) => r.kind === 'part');
  const plain = reqs.filter((r) => r.kind === 'requirement');
  const counts = {};
  for (const r of plain) for (const m of r.verify) counts[m] = (counts[m] ?? 0) + 1;

  const out = [];
  out.push(`<!-- ${banner} -->`);
  out.push('');
  out.push('# QSO Graph Desktop — Requirements Verification Matrix (QGD-RVM-001)');
  out.push('');
  out.push(`> **${banner}**`);
  out.push('>');
  out.push(
    `> ${plain.length} requirements · ${parts.length} Parts · ` +
      Object.entries(counts)
        .sort()
        .map(([m, n]) => `${n} ${m}`)
        .join(' · ') +
      '. NASA/SP-2016-6105 Rev 2, Appendix D structure — identifier → method(s).'
  );
  out.push('');
  out.push('## Requirements');
  out.push('');
  out.push('| `QGD-*` | Requirement | Verification method(s) | Automated |');
  out.push('|---------|-------------|------------------------|:---------:|');
  for (const r of plain) {
    const auto = r.verify.some((m) => m === 'Test' || m === 'Static') ? '✓' : '';
    out.push(`| \`${r.id}\` | ${r.text} | ${r.verify.join(', ')} | ${auto} |`);
  }
  out.push('');
  out.push('## Parts');
  out.push('');
  out.push('| Part | `QGD-*` | What | Exit gate |');
  out.push('|------|---------|------|-----------|');
  for (const r of parts) {
    out.push(`| ${r.part} | \`${r.id}\` | ${r.text} | ${r.gate} |`);
  }
  out.push('');
  return out.join('\n');
}

const spec = readFileSync(SPEC, 'utf8');
const { reqs, errors } = parse(spec);

if (errors.length) {
  console.error('spec/QGD-SPEC-001.md is invalid:');
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
}

const want = render(reqs);
const check = process.argv.includes('--check');

if (check) {
  if (!existsSync(RVM)) {
    console.error('rvm/QGD-RVM-001.md is missing — run: node scripts/gen-rvm.mjs');
    process.exit(1);
  }
  const have = readFileSync(RVM, 'utf8');
  // The provenance sha moves with every commit; compare everything else.
  const strip = (s) => s.replace(/ at `[0-9a-f]{7,40}|uncommitted`/g, ' at `SHA`');
  if (strip(have) !== strip(want)) {
    console.error(
      'rvm/QGD-RVM-001.md does not match spec/QGD-SPEC-001.md (QGD-TST-0004).\n' +
        'The RVM is generated. Edit the spec, then run: node scripts/gen-rvm.mjs'
    );
    process.exit(1);
  }
  console.log(`RVM matches the spec — ${reqs.length} entries.`);
} else {
  writeFileSync(RVM, want);
  console.log(`wrote rvm/QGD-RVM-001.md — ${reqs.length} entries.`);
}
