// SPDX-License-Identifier: GPL-3.0-only
import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { allowsSender, RENDERER_URL, validateCommand as check } from '../packages/callsigns/callsign-contract.js';
import { serviceIds, validateRegister } from '../packages/callsigns/services.js';

// The services come from the register the product ships, not from a list here
// (QGD-PSN-0002). A service dropped from it must stop being accepted, which is
// what tests/services.test.ts drives from the other side.
const services = serviceIds(validateRegister(JSON.parse(await readFile('data/service-profiles.json', 'utf8'))));
const validateCommand = (value: unknown) => check(value, services);
const ID = '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b';
it('accepts intended callsign and credential commands', () => {
  expect(validateCommand({ type: 'create', call: 'W1AW', description: 'Home', start: '2026-01-01' })).toBe(true);
  // The description may be empty: the call alone names it.
  expect(validateCommand({ type: 'create', call: 'W1AW/P', description: '' })).toBe(true);
  expect(validateCommand({ type: 'update', id: ID, call: 'K1ABC', description: 'Home station' })).toBe(true);
  expect(validateCommand({ type: 'save-credentials', id: ID, provider: 'qrz_logbook', credentials: { username: 'W1AW', apiKey: 'fake' } })).toBe(true);
  expect(validateCommand({ type: 'remove-secret', id: ID, provider: 'qrz', field: 'password' })).toBe(true);
  expect(validateCommand({ type: 'set-preference', id: ID, provider: 'qrz', preferred: 'api_key' })).toBe(true);
  expect(validateCommand({ type: 'remove-callsign', id: ID })).toBe(true);
  expect(validateCommand({ type: 'test-credential', id: ID, provider: 'qrz' })).toBe(true);
});
it.each([
  { type: 'require-credential', id: ID, provider: 'qrz' },
  { type: 'list', path: '/other/profiles' },
  { type: 'save-credentials', id: ID, provider: 'qrz', credentials: { apiKey: 'fake', file: '/tmp/secret' } },
  { type: 'status', id: ID, provider: 'unregistered' },
  { type: 'remove-secret', id: ID, provider: 'qrz', field: 'username' },
  { type: 'set-preference', id: ID, provider: 'qrz', preferred: 'file' },
  { type: 'set-preference', id: ID, provider: 'qrz', preferred: 'password', secret: 'fake' },
  { type: 'remove-callsign', id: ID, path: '/other' },
  { type: 'test-credential', id: ID, provider: 'qrz', url: 'https://other.invalid' },
  // A callsign is named by its id and nothing else: not its call, not its
  // description, not an id of another version.
  { type: 'set-active', id: 'W1AW' },
  { type: 'set-active', id: 'home' },
  { type: 'set-active', id: '6f9619ff-8b86-1d11-b42d-00c04fc964ff' },
  { type: 'status', id: ID.toUpperCase(), provider: 'qrz' },
  { type: 'update', call: 'W1AW', description: '' },
  { type: 'create', call: 'W1AW', description: 'x'.repeat(65) },
  { type: 'create', call: 'W1AW', description: 'two\nlines' },
  { type: 'create', id: ID, call: 'W1AW', description: '' },
  null, [],
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

describe('QGD-SEC-0020: a reference fetch carries no credential', () => {
  it('refuses a reference URL with a user name or password, which would be sent as Basic auth', async () => {
    const { validateServiceCommand } = await import('../packages/callsigns/callsign-contract.js');
    const ask = (url: string) => validateServiceCommand({ type: 'fetch-reference', url }, services);
    expect(ask('https://adif.org.uk/317/x.zip')).toBe(true);
    for (const url of ['https://user:secret@adif.org.uk/x.zip', 'https://user@adif.org.uk/x.zip', 'https://:secret@adif.org.uk/x.zip', 'https://us%65r@adif.org.uk/x.zip']) {
      expect(ask(url), url).toBe(false);
    }
  });
});

// One backup, with ticks (#64): the parts, from the window to main and from
// main to the core, each refused when it is not what a backup has.
describe('backup parts (#64)', () => {
  it('the window names the parts it wants backed up or restored, and nothing else', () => {
    expect(validateCommand({ type: 'export-callsigns', parts: ['callsigns', 'settings'] })).toBe(true);
    expect(validateCommand({ type: 'export-callsigns', parts: ['settings'] })).toBe(true);
    for (const parts of [undefined, [], ['logins'], ['settings', 'settings'], ['callsigns', 'settings', 'callsigns'], 'settings']) {
      expect(validateCommand({ type: 'export-callsigns', parts }), JSON.stringify(parts)).toBe(false);
    }
    expect(validateCommand({ type: 'import-callsigns', apply: false, replace: false })).toBe(true);
    expect(validateCommand({ type: 'import-callsigns', apply: true, replace: true, parts: ['settings'] })).toBe(true);
    expect(validateCommand({ type: 'import-callsigns', apply: true, replace: true, parts: ['logins'] })).toBe(false);
  });

  it('main hands the core the Locations, the settings, or both, and never neither', async () => {
    const { validateServiceCommand } = await import('../packages/callsigns/callsign-contract.js');
    const ask = (value: Record<string, unknown>) => validateServiceCommand({ type: 'export-callsigns', ...value }, services);
    expect(ask({ locations: '{}' })).toBe(true);
    expect(ask({ settings: '{}' })).toBe(true);
    expect(ask({ locations: '{}', settings: '{}' })).toBe(true);
    expect(ask({})).toBe(false);
    expect(ask({ settings: 'x'.repeat(262_145) })).toBe(false);
    expect(ask({ settings: {} })).toBe(false);
  });
});
