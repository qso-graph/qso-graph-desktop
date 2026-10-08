// SPDX-License-Identifier: GPL-3.0-only
// QGD-LOG-0004: the credential core never hands a secret to a logger.
//
// Redaction in the node logger is the second line of defence. This is the
// first: a secret must not be named in a tracing call at all, because a value
// the core raises has already left the core's control.
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const SOURCES = [
  'native/persona-core/src/lib.rs',
  'native/persona-core/src/validation.rs',
  'native/persona-core/src/corelog.rs'
];

// What a secret is called in this core.
const SECRET_NAMES = /\b(password|api_key|apiKey|secret|secrets|credential|credentials|creds|merged|raw|selected|pythonKey|token|passphrase)\b/;

// Every tracing call, from the macro to the end of its argument list.
function tracingCalls(source) {
  const calls = [];
  const pattern = /tracing::(trace|debug|info|warn|error)!\s*\(/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    let depth = 1;
    let index = pattern.lastIndex;
    while (index < source.length && depth > 0) {
      if (source[index] === '(') depth++;
      else if (source[index] === ')') depth--;
      index++;
    }
    const text = source.slice(match.index, index);
    // The message is a string literal and carries no value: "credential saved"
    // says the word without handing anything over. Only the field expressions
    // are checked, so strings are blanked first.
    calls.push({ level: match[1], text: text.replace(/"(?:[^"\\]|\\.)*"/g, '""'), raw: text });
  }
  return calls;
}

describe('QGD-LOG-0004', () => {
  it('finds the tracing calls it is meant to be checking', async () => {
    const source = await readFile(SOURCES[0], 'utf8');
    // A checker that matches nothing would pass every file.
    expect(tracingCalls(source).length).toBeGreaterThan(0);
  });

  it('names no secret in any tracing call in the core', async () => {
    for (const file of SOURCES) {
      for (const call of tracingCalls(await readFile(file, 'utf8'))) {
        expect(SECRET_NAMES.test(call.text), `${file}: ${call.raw.slice(0, 120)}`).toBe(false);
      }
    }
  });

  it('would catch a secret if one were added', () => {
    const planted = 'tracing::info!(provider = %provider, password = %password, "credential saved");';
    const calls = tracingCalls(planted);
    expect(calls).toHaveLength(1);
    expect(SECRET_NAMES.test(calls[0].text)).toBe(true);
  });

  it('does not fire on the fields the core actually raises', () => {
    const real = 'tracing::info!(provider = %provider, outcome = %result, "credential tested");';
    expect(SECRET_NAMES.test(tracingCalls(real)[0].text)).toBe(false);
  });

  it('is not fooled by a secret hidden in the message text either way round', () => {
    // A message naming a secret is not a leak.
    const message = 'tracing::info!(provider = %provider, "password rotated");';
    expect(SECRET_NAMES.test(tracingCalls(message)[0].text)).toBe(false);
    // A field holding one is, whatever the message says.
    const field = 'tracing::info!(secret = %value, "all well");';
    expect(SECRET_NAMES.test(tracingCalls(field)[0].text)).toBe(true);
  });
});
