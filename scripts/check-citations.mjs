// SPDX-License-Identifier: GPL-3.0-only
// Every requirement ID a Markdown file cites exists in the spec (#95; Watson's
// review of the 0.2.1 milestone: documentation builds nothing, so a citation
// to an ID the spec doesn't have would otherwise go unchecked, as sixteen
// QGD-AST-* IDs did on 2026-10-23). Seconds, so it runs on every change,
// documentation-only ones included.
//
// An ID "exists" if the spec names it anywhere: defined in a table, or listed
// as retired and never reused. The RVM is generated from the spec and is not
// read here.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ID = /QGD-[A-Z]{2,4}-\d{4}(?:\.\d+)?/g;
const SPEC = 'spec/QGD-SPEC-001.md';
const SKIP = new Set(['node_modules', '.git', 'dist', 'out', 'report', 'rvm', 'vendor', '.cache']);

export function idsIn(text) {
  return new Set(text.match(ID) ?? []);
}

export function markdownFiles(root) {
  const found = [];
  const walk = dir => {
    for (const name of readdirSync(dir)) {
      if (SKIP.has(name)) continue;
      const path = join(dir, name);
      const info = statSync(path);
      if (info.isDirectory()) walk(path);
      else if (name.endsWith('.md')) found.push(relative(root, path));
    }
  };
  walk(root);
  return found.sort();
}

// The citations in each file that the spec doesn't have.
export function unknownCitations(spec, files) {
  const known = idsIn(spec);
  const problems = [];
  for (const [file, text] of files) {
    const lines = text.split('\n');
    lines.forEach((line, index) => {
      for (const id of line.match(ID) ?? []) if (!known.has(id)) problems.push(`${file}:${index + 1}: ${id}`);
    });
  }
  return problems;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const spec = readFileSync(SPEC, 'utf8');
  const files = markdownFiles('.').filter(file => file !== SPEC).map(file => [file, readFileSync(file, 'utf8')]);
  const problems = unknownCitations(spec, files);
  if (problems.length > 0) {
    console.error(`Requirement IDs cited but not in ${SPEC}:`);
    for (const problem of problems) console.error(`  ${problem}`);
    process.exit(1);
  }
  console.log(`Citations: every QGD-* ID in ${files.length} Markdown files exists in the spec.`);
}
