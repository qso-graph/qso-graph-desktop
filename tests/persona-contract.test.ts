// SPDX-License-Identifier: GPL-3.0-only
import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { allowsSender, RENDERER_URL, validateCommand as check } from '../packages/personas/persona-contract.js';
import { serviceIds, validateRegister } from '../packages/personas/services.js';

// The services come from the register the product ships, not from a list here
// (QGD-PSN-0002). A service dropped from it must stop being accepted, which is
// what tests/services.test.ts drives from the other side.
const services = serviceIds(validateRegister(JSON.parse(await readFile('data/service-profiles.json', 'utf8'))));
const validateCommand = (value: unknown) => check(value, services);
it('accepts intended persona and credential commands', () => {
  expect(validateCommand({ type: 'upsert', name: 'home', callsign: 'W1AW', start: '2026-01-01' })).toBe(true);
  expect(validateCommand({ type: 'save-credentials', persona: 'home', provider: 'qrz_logbook', credentials: { username: 'W1AW', apiKey: 'fake' } })).toBe(true);
  expect(validateCommand({ type: 'remove-secret', persona: 'home', provider: 'qrz', field: 'password' })).toBe(true);
  expect(validateCommand({ type: 'set-preference', persona: 'home', provider: 'qrz', preferred: 'api_key' })).toBe(true);
  expect(validateCommand({ type: 'remove-persona', name: 'portable' })).toBe(true);
  expect(validateCommand({ type: 'test-credential', persona: 'portable', provider: 'qrz' })).toBe(true);
});
it.each([
  { type: 'require-credential', persona: 'home', provider: 'qrz' },
  { type: 'list', path: '/other/profiles' },
  { type: 'save-credentials', persona: 'home', provider: 'qrz', credentials: { apiKey: 'fake', file: '/tmp/secret' } },
  { type: 'status', persona: 'home', provider: 'unregistered' },
  { type: 'remove-secret', persona: 'home', provider: 'qrz', field: 'username' },
  { type: 'set-preference', persona: 'home', provider: 'qrz', preferred: 'file' },
  { type: 'set-preference', persona: 'home', provider: 'qrz', preferred: 'password', secret: 'fake' },
  { type: 'remove-persona', name: 'portable', path: '/other' },
  { type: 'test-credential', persona: 'portable', provider: 'qrz', url: 'https://other.invalid' },
  { type: 'set-active', name: 'x'.repeat(129) }, null, [],
])('refuses malformed or unauthorized operations (%#)', command => expect(validateCommand(command)).toBe(false));

describe('QGD-PRC-0006 sender rule', () => {
  const main = { id: 'main' };
  it('allows the bundled page in the main frame', () => {
    expect(allowsSender(main, main, RENDERER_URL)).toBe(true);
  });
  it.each([
    [{ id: 'sub' }, main, RENDERER_URL, 'a non-main frame'],
    [main, main, 'qg://desktop/index.html?probe=1', 'a query appended to the page'],
    [main, main, 'qg://desktop/app.js', 'another bundled resource'],
    [main, main, 'https://example.invalid/', 'an external page'],
    [main, main, undefined, 'no url at all'],
    [undefined, undefined, RENDERER_URL, 'no frame at all'],
    [null, null, RENDERER_URL, 'a null frame']
  ])('refuses %#: %s', (sender, mainFrame, url) => {
    expect(allowsSender(sender, mainFrame, url)).toBe(false);
  });
});
