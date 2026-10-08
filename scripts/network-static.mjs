// SPDX-License-Identifier: GPL-3.0-only
// QGD-CRD-0007 is Static as well as Test: the product's TypeScript must hold no
// outbound-network API, so the Rust credential core is the only component that
// can open a connection.
//
// This tokenizes. Two earlier versions matched patterns against source text and
// both lost the same way — every fix opened another hole. A regex missed
// `import { net } from 'electron'`, `import https from 'https'` and `fetch (url)`;
// character-bounded patterns then missed a multiline import whose comment ran
// past the bound, crossed statement boundaries into a false positive, and hid a
// call behind an apostrophe in a comment inside a template interpolation. Those
// are not bugs in the patterns, they are the consequence of not knowing where a
// string, a comment, a regex literal or a statement begins and ends.
//
// TypeScript 7's package root exports only version information and its
// `unstable/sync` surface is a project and type-checker API, not a syntax tree,
// so the compiler's own parser is not available. This is a lexer, not a parser:
// it yields names, punctuators and string values with comments, regex literals
// and template text removed, and template interpolations tokenized as the code
// they are. Checks then run over tokens, where `fetch` in a comment is not a
// token and `from` in the next statement is not in this one.
//
// The guarantee is tests/network-static.test.mjs.

// Node's networking, with or without the node: prefix.
const MODULES = /^(?:node:)?(?:http|https|http2|net|tls|dgram)$/;
const NETWORK_OVER_THE_WIRE = /^https?:\/\//;
// Electron's own networking surface.
const ELECTRON_NETWORK = new Set(['net', 'netLog', 'ClientRequest']);
// Web platform clients.
const CLIENTS = new Set(['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts']);
const CLIENT_PROPERTIES = new Set(['sendBeacon', 'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'netLog']);
// After these, a slash opens a regex literal rather than dividing.
const REGEX_MAY_FOLLOW = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete',
  'void', 'do', 'else', 'yield', 'await', 'case', 'throw']);

const NAME_START = /[A-Za-z_$]/;
const NAME_PART = /[A-Za-z0-9_$]/;

// Tokens: { kind: 'name' | 'string' | 'punct', value, line }.
// Comments, regex literals, numbers and template text are dropped; the code
// inside a template interpolation is tokenized normally.
export function tokenize(source) {
  const tokens = [];
  let line = 1;
  let index = 0;
  // Each frame is a template literal whose interpolation we are inside.
  const templates = [];
  let braceDepth = 0;

  const previous = () => tokens[tokens.length - 1];
  const regexAllowed = () => {
    const token = previous();
    if (!token) return true;
    if (token.kind === 'string') return false;
    if (token.kind === 'name') return REGEX_MAY_FOLLOW.has(token.value);
    return !([')', ']', '}', '++', '--'].includes(token.value));
  };

  const readString = quote => {
    let value = '';
    index++;
    while (index < source.length && source[index] !== quote) {
      if (source[index] === '\\') { if (source[index + 1] === '\n') line++; index += 2; value += ' '; continue; }
      if (source[index] === '\n') line++;
      value += source[index++];
    }
    index++;
    return value;
  };

  while (index < source.length) {
    const character = source[index];
    const next = source[index + 1];

    if (character === '\n') { line++; index++; continue; }
    if (character === ' ' || character === '\t' || character === '\r') { index++; continue; }
    if (character === '/' && next === '/') { while (index < source.length && source[index] !== '\n') index++; continue; }
    if (character === '/' && next === '*') {
      index += 2;
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) { if (source[index] === '\n') line++; index++; }
      index += 2;
      continue;
    }
    if (character === '/' && regexAllowed()) {
      // A regex literal: skip it, including classes, so a quote inside cannot
      // be taken for a string delimiter.
      index++;
      let inClass = false;
      while (index < source.length) {
        if (source[index] === '\\') { index += 2; continue; }
        if (source[index] === '[') inClass = true;
        else if (source[index] === ']') inClass = false;
        else if (source[index] === '/' && !inClass) { index++; break; }
        else if (source[index] === '\n') { line++; break; }
        index++;
      }
      while (index < source.length && NAME_PART.test(source[index])) index++;
      continue;
    }
    if (character === "'" || character === '"') {
      const startLine = line;
      tokens.push({ kind: 'string', value: readString(character), line: startLine });
      continue;
    }
    if (character === '`') {
      // A template with no interpolation is a constant string: `node:https`
      // and [`fetch`] are ordinary specifiers and property names.
      let scan = index + 1;
      let constant = '';
      let simple = false;
      while (scan < source.length) {
        if (source[scan] === '\\') { constant += ' '; scan += 2; continue; }
        if (source[scan] === '`') { simple = true; break; }
        if (source[scan] === '$' && source[scan + 1] === '{') break;
        constant += source[scan++];
      }
      if (simple) {
        const startLine = line;
        for (const character of constant) if (character === '\n') line++;
        tokens.push({ kind: 'string', value: constant, line: startLine });
        index = scan + 1;
        continue;
      }
      // Otherwise: drop the text, tokenize each interpolation.
      index++;
      while (index < source.length) {
        if (source[index] === '\\') { index += 2; continue; }
        if (source[index] === '`') { index++; break; }
        if (source[index] === '$' && source[index + 1] === '{') {
          templates.push(braceDepth);
          braceDepth++;
          index += 2;
          break;
        }
        if (source[index] === '\n') line++;
        index++;
      }
      continue;
    }
    if (character === '}' && templates.length && braceDepth === templates[templates.length - 1] + 1) {
      // The interpolation closes; resume the template text that follows it.
      templates.pop();
      braceDepth--;
      index++;
      while (index < source.length) {
        if (source[index] === '\\') { index += 2; continue; }
        if (source[index] === '`') { index++; break; }
        if (source[index] === '$' && source[index + 1] === '{') { templates.push(braceDepth); braceDepth++; index += 2; break; }
        if (source[index] === '\n') line++;
        index++;
      }
      continue;
    }
    if (NAME_START.test(character)) {
      const start = index;
      while (index < source.length && NAME_PART.test(source[index])) index++;
      tokens.push({ kind: 'name', value: source.slice(start, index), line });
      continue;
    }
    if (character >= '0' && character <= '9') {
      while (index < source.length && /[0-9a-fA-FxXoObBeE._n]/.test(source[index])) index++;
      continue;
    }
    if (character === '{') braceDepth++;
    if (character === '}') braceDepth--;
    const two = character + (next ?? '');
    if (['++', '--', '=>', '?.', '??', '===', '!=='].includes(two)) { tokens.push({ kind: 'punct', value: two, line }); index += 2; continue; }
    tokens.push({ kind: 'punct', value: character, line });
    index++;
  }
  return tokens;
}

export function violations(source, fileName = 'input.ts') {
  const tokens = tokenize(source);
  const found = [];
  const add = (line, what) => found.push({ file: fileName, line, what });
  const is = (token, kind, value) => token && token.kind === kind && (value === undefined || token.value === value);

  for (let position = 0; position < tokens.length; position++) {
    const token = tokens[position];

    // import ... from 'module';  import 'module';  and the re-export forms,
    // export { get } from 'node:https' and export * from 'node:https', which
    // create the same dependency as an import.
    if ((is(token, 'name', 'import') || is(token, 'name', 'export')) && !is(tokens[position + 1], 'punct', '(')) {
      // The statement ends at its semicolon, or at the next import — never
      // later, so one import cannot be read as part of another.
      let end = position + 1;
      while (end < tokens.length && !is(tokens[end], 'punct', ';') &&
             !is(tokens[end], 'name', 'import') && !is(tokens[end], 'name', 'export')) end++;
      const clause = tokens.slice(position + 1, end);
      // `import { get as from } from 'node:https'` has two tokens named from,
      // and a semicolonless import may be followed by a re-export that has one
      // of its own. The contextual from is the FIRST whose next token is the
      // specifier: an alias named from is followed by a brace, and a later
      // declaration's from cannot be reached before this one's.
      let fromIndex = -1;
      for (let scan = 0; scan < clause.length; scan++) {
        if (is(clause[scan], 'name', 'from') && is(clause[scan + 1], 'string')) { fromIndex = scan; break; }
      }
      // `export const x = 1` has no specifier; only a re-export does.
      if (is(token, 'name', 'export') && fromIndex < 0) continue;
      const specifier = fromIndex >= 0 ? clause[fromIndex + 1] : clause[0];
      if (is(specifier, 'string')) {
        const verb = is(token, 'name', 'export') ? 're-exports' : 'imports';
        if (MODULES.test(specifier.value)) add(token.line, `${verb} ${specifier.value}`);
        else if (NETWORK_OVER_THE_WIRE.test(specifier.value)) add(token.line, `${verb} over the network`);
        else if (specifier.value === 'electron') {
          const bindings = fromIndex >= 0 ? clause.slice(0, fromIndex) : [];
          for (const entry of bindings) {
            if (is(entry, 'name') && ELECTRON_NETWORK.has(entry.value)) add(token.line, `${verb} ${entry.value} from electron`);
          }
        }
      }
      position = end - 1;
      continue;
    }

    // require('module') and import('module')
    if ((is(token, 'name', 'require') || is(token, 'name', 'import')) && is(tokens[position + 1], 'punct', '(') && is(tokens[position + 2], 'string')) {
      const specifier = tokens[position + 2].value;
      if (MODULES.test(specifier)) add(token.line, `requires ${specifier}`);
      if (NETWORK_OVER_THE_WIRE.test(specifier)) add(token.line, 'imports over the network');
      continue;
    }

    if (is(token, 'name') && CLIENTS.has(token.value) && is(tokens[position + 1], 'punct', '(')) {
      // Not a property of something else: `personas.fetch(` is not global fetch.
      if (!is(tokens[position - 1], 'punct', '.')) add(token.line, `calls ${token.value}`);
      continue;
    }
    if (is(token, 'name', 'new') && is(tokens[position + 1], 'name') && CLIENTS.has(tokens[position + 1].value)) {
      add(token.line, `constructs ${tokens[position + 1].value}`);
      continue;
    }
    if (is(token, 'punct', '.') && is(tokens[position + 1], 'name') && CLIENT_PROPERTIES.has(tokens[position + 1].value)) {
      add(token.line, `reaches ${tokens[position + 1].value}`);
      continue;
    }
    if (is(token, 'punct', '[') && is(tokens[position + 1], 'string') && CLIENT_PROPERTIES.has(tokens[position + 1].value)) {
      add(token.line, `reaches ${tokens[position + 1].value}`);
      continue;
    }
    if (is(token, 'name') && ELECTRON_NETWORK.has(token.value) &&
        is(tokens[position + 1], 'punct', '.') && is(tokens[position + 2], 'name', 'request')) {
      add(token.line, `calls ${token.value}.request`);
      continue;
    }
    // netLog has no request method; any use of it is the logging surface.
    if (is(token, 'name', 'netLog') && is(tokens[position + 1], 'punct', '.')) {
      add(token.line, "uses electron's netLog");
      continue;
    }
  }
  return found;
}

// The product files this gate covers.
export const PRODUCT_SOURCES = [
  'src/main.ts', 'src/persona-broker.ts', 'src/persona-contract.ts',
  'src/persona-service.ts', 'src/policy.ts', 'src/preload.cts', 'src/renderer/app.ts'
];
