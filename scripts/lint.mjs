// SPDX-License-Identifier: GPL-3.0-only
// QGD-SEC-0013: the ESLint security rules, svelte/no-at-html-tags and the
// sql.raw ban, run over the product.
//
// Two things this does beyond running ESLint.
//
// The product is TypeScript and is linted after compilation, because
// typescript-eslint peers on TypeScript below 6.1 and this project is on 7.
// A finding in dist/ names a line nobody edits, so each one is translated back
// through the source map to the .ts line that produced it.
//
// And a gate that silently stops running passes everything. Before reporting,
// a known-bad fixture is linted for each rule family and the rule is required
// to fire.
import { ESLint } from 'eslint';
import { readFile, readdir } from 'node:fs/promises';
import { SourceMap } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';

const root = resolve('.');
const maps = new Map();

async function original(file, line, column) {
  if (!file.includes('/dist/')) return undefined;
  if (!maps.has(file)) {
    try {
      const payload = JSON.parse(await readFile(`${file}.map`, 'utf8'));
      maps.set(file, new SourceMap(payload));
    } catch { maps.set(file, undefined); }
  }
  const map = maps.get(file);
  if (!map) return undefined;
  // ESLint counts from one; a source map counts from zero.
  const entry = map.findEntry(line - 1, Math.max(0, column - 1));
  if (!entry || entry.originalSource === undefined) return undefined;
  // A map's source is relative to the compiled file, not to the repository.
  const raw = entry.originalSource.replace(/^file:\/\//, '');
  const source = raw.startsWith('/') ? raw : resolve(dirname(file), raw);
  return `${relative(root, source)}:${entry.originalLine + 1}:${entry.originalColumn + 1}`;
}

// QGD-SEC-0011, independent of the plugin. A Svelte template compiles to an
// innerHTML assignment that cannot be tied back to the tag that produced it, so
// this reads the source and does not depend on the lint config still covering it.
async function svelteSources(directory, found = []) {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); } catch { return found; }
  for (const entry of entries) {
    if (['node_modules', 'dist', 'out', 'report', 'target', '.git'].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await svelteSources(path, found);
    else if (entry.name.endsWith('.svelte')) found.push(path);
  }
  return found;
}

const eslint = new ESLint({ cwd: root });

// The controls. Each must fire, or a clean report below means nothing.
const CONTROLS = [
  { name: 'svelte/no-at-html-tags', path: 'src/renderer/__control__.svelte', code: '<div>{@html value}</div>\n' },
  // The same rule again, on a component whose script is TypeScript. The plain
  // fixture above parses without a TypeScript parser configured and fired
  // happily while every real component in src/ was a parse error reviewing
  // nothing — so it reported PASS through the whole failure.
  {
    name: 'svelte/no-at-html-tags',
    label: 'svelte/no-at-html-tags on a TypeScript component',
    path: 'src/renderer/__control__.svelte',
    code: '<script lang="ts">\n  interface Props { value: string }\n  const { value }: Props = $props();\n</script>\n<div>{@html value}</div>\n'
  },
  { name: 'no-eval', path: 'scripts/__control__.mjs', code: 'eval("1");\n' },
  { name: 'no-restricted-syntax', path: 'scripts/__control__.mjs', code: 'spawn("x", { shell: true });\n' },
  { name: 'security/detect-non-literal-require', path: 'scripts/__control__.mjs', code: 'const m = require(name);\n' },
  { name: 'security/detect-unsafe-regex', path: 'scripts/__control__.mjs', code: 'const r = /(a+)+$/;\n', expect: false }
];

// Some rules cannot be fixture-tested where they matter: a fixture under src/
// is not in the TypeScript project, and the type-aware rules need one. So the
// product's configuration is asserted directly — this is what is actually in
// force for src/main.ts, rather than what a fixture elsewhere implies.
const REQUIRED_FOR_PRODUCT = [
  'no-eval',
  'no-implied-eval',
  'no-new-func',
  'no-restricted-syntax',
  'security/detect-unsafe-regex',
  'security/detect-non-literal-require',
  'security/detect-non-literal-regexp',
  '@typescript-eslint/no-explicit-any',
  '@typescript-eslint/no-unsafe-assignment',
  '@typescript-eslint/no-unsafe-member-access',
  '@typescript-eslint/no-unsafe-call',
  '@typescript-eslint/no-unsafe-argument',
  '@typescript-eslint/no-floating-promises',
  '@typescript-eslint/no-misused-promises'
];

const failures = [];
for (const control of CONTROLS) {
  const [result] = await eslint.lintText(control.code, { filePath: resolve(root, control.path), warnIgnored: false });
  const fired = (result?.messages ?? []).some(message => message.ruleId === control.name);
  const wanted = control.expect !== false;
  if (fired !== wanted) {
    const label = control.label ?? control.name;
    failures.push(wanted
      ? `the ${label} gate did not fire on a known-bad fixture, so it is not running`
      : `the ${label} rule fired where it is deliberately off; the configuration has drifted`);
  }
}

// A well-formed component has to parse, or the rules above have nothing to
// look at. Checked as its own control because a parse error is reported with a
// null ruleId, which no rule-named control can notice.
const [parsedControl] = await eslint.lintText(
  '<script lang="ts">\n  interface Props { value: string }\n  const { value }: Props = $props();\n</script>\n<p>{value}</p>\n',
  { filePath: resolve(root, 'src/renderer/__control__.svelte'), warnIgnored: false }
);
const parseErrors = (parsedControl?.messages ?? []).filter(message => message.ruleId === null);
if (parseErrors.length) {
  failures.push(`a TypeScript component does not parse, so no rule reviews one: ${parseErrors[0].message}`);
}

// What is actually in force for the product.
const productConfig = await eslint.calculateConfigForFile(resolve(root, 'src/main.ts'));
for (const rule of REQUIRED_FOR_PRODUCT) {
  const setting = productConfig.rules?.[rule];
  const severity = Array.isArray(setting) ? setting[0] : setting;
  if (severity !== 'error' && severity !== 2) {
    failures.push(`${rule} is not an error for src/main.ts; the product is not held to it`);
  }
}

const svelteFiles = await svelteSources(root);

for (const file of svelteFiles) {
  const text = await readFile(file, 'utf8');
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index++) {
    if (lines[index].includes('{@html')) {
      failures.push(`${relative(root, file)}:${index + 1}  QGD-SEC-0011: {@html} in a Svelte template`);
    }
  }
}

const results = await eslint.lintFiles(['.']);
let errors = 0;
for (const result of results) {
  for (const message of result.messages) {
    // Severity 1 counts too: a rule that should be a gate and arrives as a
    // warning is exactly how the plugin's findings were lost before.
    if (message.severity < 1) continue;
    errors++;
    const where = await original(result.filePath, message.line, message.column);
    const location = where ?? `${relative(root, result.filePath)}:${message.line}:${message.column}`;
    const through = where ? `  (via ${relative(root, result.filePath)}:${message.line})` : '';
    failures.push(`${location}  ${message.message}  [${message.ruleId}]${through}`);
  }
}

if (failures.length) {
  console.error('Security lint failed.');
  for (const failure of failures) console.error(`  ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Security lint: ${results.length} files, ${svelteFiles.length} Svelte source(s), ${CONTROLS.length} controls as expected, ${REQUIRED_FOR_PRODUCT.length} rules in force for the product, 0 findings: PASS`);
}
