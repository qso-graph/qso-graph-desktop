// SPDX-License-Identifier: GPL-3.0-only
// QGD-LOG-0004: the credential core never hands a secret to a logger.
//
// Redaction in the node logger is the second line of defence. This is the
// first: a secret must not be named in a tracing call at all, because a value
// the core raises has already left the core's control.
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const SOURCES = [
  'packages/persona-core/src/lib.rs',
  'packages/persona-core/src/validation.rs',
  'packages/persona-core/src/corelog.rs'
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
    // Two different things live in a tracing call, and both can carry a value.
    //
    // The field expressions: `password = %password` hands one over by name.
    // The message: "credential saved" says the word and hands over nothing, so
    // string literals are blanked before the field check.
    //
    // But a Rust format string captures implicitly — `"password={password}"`
    // interpolates the variable into the message, carrying the value while
    // naming no field, and blanking the string would hide exactly that. So the
    // captures are pulled out of the literals first and checked on their own.
    const literals = text.match(/"(?:[^"\\]|\\.)*"/g) ?? [];
    const captures = literals.flatMap(literal =>
      [...literal.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)(?:[:?][^}]*)?\}/g)].map(capture => capture[1]));
    calls.push({
      level: match[1],
      text: text.replace(/"(?:[^"\\]|\\.)*"/g, '""'),
      captures,
      raw: text
    });
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
        const named = SECRET_NAMES.test(call.text);
        const captured = call.captures.some(capture => SECRET_NAMES.test(capture));
        expect(named || captured, `${file}: ${call.raw.slice(0, 120)}`).toBe(false);
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

  it('catches a secret captured implicitly by a format string', () => {
    // Names no field, carries the value anyway, and would reach the message
    // text where field-name redaction cannot see it.
    const implicit = tracingCalls('tracing::info!("password={password}");')[0];
    expect(SECRET_NAMES.test(implicit.text)).toBe(false);
    expect(implicit.captures.some(capture => SECRET_NAMES.test(capture))).toBe(true);

    const debugged = tracingCalls('tracing::warn!("value {api_key:?} rejected");')[0];
    expect(debugged.captures.some(capture => SECRET_NAMES.test(capture))).toBe(true);

    // An ordinary capture is not a finding.
    const ordinary = tracingCalls('tracing::info!("provider {provider} tested");')[0];
    expect(ordinary.captures).toEqual(['provider']);
    expect(ordinary.captures.some(capture => SECRET_NAMES.test(capture))).toBe(false);
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
