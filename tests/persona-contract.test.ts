// SPDX-License-Identifier: GPL-3.0-only
import { expect, it } from 'vitest';
import { validateCommand } from '../src/persona-contract.js';
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
