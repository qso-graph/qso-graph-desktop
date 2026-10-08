// SPDX-License-Identifier: GPL-3.0-only
// QGD-CRD-0007 is Static as well as Test: the product's TypeScript must hold no
// outbound-network API, so the Rust credential core is the only component that
// can open a connection.
//
// Not AST-based, deliberately: TypeScript 7's package root exports only version
// information, and its `unstable/sync` surface is a project and type-checker
// API, not a JavaScript syntax tree. So this strips comments, then matches in
// two passes — one over code that still carries its module specifiers, one over
// code with string contents blanked so a quoted "fetch(" cannot false-positive.
// Whitespace is tolerated everywhere a call can take it.
//
// The guarantee is tests/network-static.test.mjs, which asserts every pattern
// below against the evasions that defeated the regex this replaced:
// `import { net } from 'electron'`, `import https from 'https'`, `fetch (url)`.

// Node's networking, with or without the node: prefix.
const MODULE = String.raw`(?:node:)?(?:http|https|http2|net|tls|dgram)`;
const CLIENTS = 'fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts';

// Matched against code that keeps its strings: module specifiers and the
// string-keyed property access that blanking would erase.
const WITH_STRINGS = [
  [new RegExp(String.raw`\bimport\b[^;\n]*?\bfrom\s*(['"\`])${MODULE}\1`), 'imports a networking module'],
  [new RegExp(String.raw`\bimport\s*\(\s*(['"\`])${MODULE}\1`), 'imports a networking module'],
  [new RegExp(String.raw`\brequire\s*\(\s*(['"\`])${MODULE}\1`), 'requires a networking module'],
  [new RegExp(String.raw`\b(?:import|require)\s*\(\s*(['"\`])https?://`), 'imports over the network'],
  [/\bimport\s*\{[^}]*\b(?:net|netLog|ClientRequest)\b[^}]*\}\s*from\s*(['"`])electron\1/, "imports electron's networking"],
  [new RegExp(String.raw`\[\s*(['"\`])(?:${CLIENTS})\1\s*\]`), 'reaches a network client by name']
];

// Matched against code with string contents blanked: bare identifiers.
const WITHOUT_STRINGS = [
  [/\bfetch\s*\(/, 'calls fetch'],
  [/\bnew\s+(?:XMLHttpRequest|WebSocket|EventSource)\b/, 'constructs a network client'],
  [/\b(?:XMLHttpRequest|WebSocket|EventSource)\s*\(/, 'calls a network client'],
  [/\.\s*sendBeacon\s*\(/, 'calls sendBeacon'],
  [/\bimportScripts\s*\(/, 'calls importScripts'],
  [/\b(?:net|netLog|ClientRequest)\s*\.\s*request\s*\(/, "calls electron's net.request"],
  [/\bnetLog\s*\./, "uses electron's netLog"]
];

// Comments out, line structure kept so a reported line number is the real one.
function stripComments(source) {
  let out = '';
  let state = 'code';
  let quote = '';
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    const next = source[index + 1];
    if (state === 'code') {
      if (character === '/' && next === '/') { state = 'line'; out += '  '; index++; continue; }
      if (character === '/' && next === '*') { state = 'block'; out += '  '; index++; continue; }
      if (character === "'" || character === '"' || character === '`') { state = 'string'; quote = character; }
      out += character;
      continue;
    }
    if (state === 'line') { if (character === '\n') { state = 'code'; out += character; } else out += ' '; continue; }
    if (state === 'block') {
      if (character === '*' && next === '/') { state = 'code'; out += '  '; index++; continue; }
      out += character === '\n' ? character : ' ';
      continue;
    }
    // Inside a string: copy it through, tracking escapes, so specifiers survive.
    out += character;
    if (character === '\\') { out += source[++index] ?? ''; continue; }
    if (character === quote) { state = 'code'; quote = ''; }
  }
  return out;
}

// String contents blanked, quotes and newlines kept. Template `${...}` holes
// stay as code, because code inside a template is still code.
function blankStrings(source) {
  let out = '';
  let quote = '';
  const holes = [];
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (!quote) {
      if (character === "'" || character === '"' || character === '`') { quote = character; out += character; continue; }
      out += character;
      continue;
    }
    if (character === '\\') { out += '  '; index++; continue; }
    if (character === quote && !holes.length) { quote = ''; out += character; continue; }
    if (quote === '`' && character === '$' && source[index + 1] === '{') { holes.push(true); out += '${'; index++; continue; }
    if (quote === '`' && character === '}' && holes.length) { holes.pop(); out += '}'; continue; }
    if (holes.length) { out += character; continue; }
    out += character === '\n' ? character : ' ';
  }
  return out;
}

export function violations(source, fileName = 'input.ts') {
  const code = stripComments(source);
  const bare = blankStrings(code);
  const found = [];
  const lineOf = (text, index) => text.slice(0, index).split('\n').length;
  for (const [pattern, what] of WITH_STRINGS) {
    const match = pattern.exec(code);
    if (match) found.push({ file: fileName, line: lineOf(code, match.index), what });
  }
  for (const [pattern, what] of WITHOUT_STRINGS) {
    const match = pattern.exec(bare);
    if (match) found.push({ file: fileName, line: lineOf(bare, match.index), what });
  }
  return found;
}

// The product files this gate covers.
export const PRODUCT_SOURCES = [
  'src/main.ts', 'src/persona-broker.ts', 'src/persona-contract.ts',
  'src/persona-service.ts', 'src/policy.ts', 'src/preload.cts', 'src/renderer/app.ts'
];
