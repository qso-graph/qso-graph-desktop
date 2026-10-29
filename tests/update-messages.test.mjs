// SPDX-License-Identifier: GPL-3.0-only
// Every reason the credential core gives for refusing an update reaches the
// operator in its own words (#128). The callsign service passes on only the
// sentences on its list, so a refusal missing from it would be shown as "The
// callsign request could not be completed", hiding why an update was refused.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const service = readFileSync('packages/callsigns/callsign-service.ts', 'utf8');
const list = service.slice(service.indexOf('const MESSAGES = ['), service.indexOf('];', service.indexOf('const MESSAGES = [')));

// The fixed sentences a function in these files returns as an error.
function refusals(file) {
  const source = readFileSync(file, 'utf8').split('#[cfg(test)]')[0];
  const found = new Set();
  for (const pattern of [/Err\("([^"]+)"\)/g, /ok_or\("([^"]+)"\)/g, /map_err\(\|_\| "([^"]+)"\)/g, /const REFUSED: &str = "([^"]+)";/g]) {
    for (const match of source.matchAll(pattern)) found.add(match[1]);
  }
  return [...found];
}

describe('the update refusals the operator is told (#128)', () => {
  for (const file of ['packages/callsign-core/src/updates.rs', 'packages/callsign-core/src/feed_signature.rs']) {
    it(`passes on every refusal in ${file}`, () => {
      const said = refusals(file);
      expect(said.length).toBeGreaterThan(1);
      for (const sentence of said) {
        expect(list.includes(JSON.stringify(sentence)) || list.includes(`'${sentence}'`), sentence).toBe(true);
      }
    });
  }

  it('would catch a refusal missing from the list', () => {
    expect(list.includes("'The update feed was signed by a stranger.'")).toBe(false);
  });
});
