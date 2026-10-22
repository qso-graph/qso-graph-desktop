// SPDX-License-Identifier: GPL-3.0-only
// P8-contract and P8-contribution: manifest version 1 (QGD-APP-0019,
// QGD-HOM-0001). Each refusal names what it refused, so the operator, or the
// person writing the extension, can act on it.
import { describe, expect, it } from 'vitest';
import { API_VERSION, MANIFEST_VERSION, satisfiesApi, validateManifest } from '../packages/extension-api/manifest.js';

const known = new Set(['source:noaa-swpc', 'callsign:list']);
const PAGE = { id: 'conditions', name: 'Conditions', description: 'Solar flux, K and A, and the band outlook.', refreshSeconds: 900 };
const BASE = {
  manifestVersion: 1, id: 'on-the-air', name: 'On the Air', tier: 'official', version: '1.0.0',
  engines: { qgd: '^1.0.0' }, grants: ['source:noaa-swpc'], main: 'dist/main.js',
  contributes: { pages: [PAGE] }
};

describe('P8-contract: manifest version 1 (QGD-APP-0019)', () => {
  it('accepts a well-formed manifest with pages and no webview', () => {
    const manifest = validateManifest(BASE, known);
    expect(manifest.contributes.pages).toEqual([PAGE]);
    expect(manifest.main).toBe('dist/main.js');
    expect(manifest.page).toBeUndefined();
    expect(manifest.manifestVersion).toBe(MANIFEST_VERSION);
  });

  it('refuses an unknown field anywhere, naming it, rather than ignoring it', () => {
    expect(() => validateManifest({ ...BASE, colour: 'blue' }, known)).toThrowError(/does not know: "colour"/);
    expect(() => validateManifest({ ...BASE, engines: { qgd: '^1.0.0', node: '>=20' } }, known)).toThrowError(/does not know: "node"/);
    expect(() => validateManifest({ ...BASE, contributes: { pages: [PAGE], views: [] } }, known)).toThrowError(/does not know: "views"/);
    expect(() => validateManifest({ ...BASE, contributes: { pages: [{ ...PAGE, html: '<b>' }] } }, known)).toThrowError(/does not know: "html"/);
    // Cards were Home's live panels until 2026-10-22; a manifest offering
    // them is refused by name rather than read as pages.
    expect(() => validateManifest({ ...BASE, contributes: { cards: [PAGE] } }, known)).toThrowError(/does not know: "cards"/);
  });

  it('refuses a missing or different manifestVersion, saying which it reads', () => {
    const { manifestVersion: _omitted, ...without } = BASE;
    expect(() => validateManifest(without, known)).toThrowError(/manifest version undefined; this core reads version 1/);
    expect(() => validateManifest({ ...BASE, manifestVersion: 2 }, known)).toThrowError(/manifest version 2/);
  });

  it('refuses an engines.qgd range the core does not satisfy, naming the version it needs', () => {
    expect(() => validateManifest({ ...BASE, engines: { qgd: '^2.0.0' } }, known)).toThrowError(/needs extension API \^2\.0\.0; this core serves 1\.0\.0/);
    expect(() => validateManifest({ ...BASE, engines: { qgd: '>=1.0.0' } }, known)).toThrowError(/needs extension API >=1\.0\.0/);
    expect(() => validateManifest({ ...BASE, engines: {} }, known)).toThrowError(/needs extension API undefined/);
    const { engines: _gone, ...noEngines } = BASE;
    expect(() => validateManifest(noEngines, known)).toThrowError(/engines\.qgd/);
  });

  it('reads caret ranges against the API version, and nothing else', () => {
    expect(API_VERSION).toBe('1.0.0');
    expect(satisfiesApi('^1.0.0', '1.0.0')).toBe(true);
    expect(satisfiesApi('^1.0.0', '1.4.2')).toBe(true);
    expect(satisfiesApi('^1.2.0', '1.1.9')).toBe(false);
    expect(satisfiesApi('^1.2.3', '1.2.2')).toBe(false);
    expect(satisfiesApi('^1.0.0', '2.0.0')).toBe(false);
    for (const range of ['1.0.0', '~1.0.0', '^1', '^1.0', '*', '', 7]) expect(satisfiesApi(range, '1.0.0'), String(range)).toBe(false);
    // Pre-releases satisfy nothing, either way round.
    expect(satisfiesApi('^1.0.0', '1.0.0-next')).toBe(false);
    expect(satisfiesApi('^1.0.0-next', '1.0.0')).toBe(false);
    // Under 0.x the minor is the breaking number.
    expect(satisfiesApi('^0.1.0', '0.2.0')).toBe(false);
    expect(satisfiesApi('^0.1.0', '0.1.5')).toBe(true);
  });

  it('refuses activation events nobody defined', () => {
    expect(validateManifest({ ...BASE, activationEvents: ['onStartupFinished'] }, known).activationEvents).toEqual(['onStartupFinished']);
    expect(() => validateManifest({ ...BASE, activationEvents: ['onEverything'] }, known)).toThrowError(/"onEverything", which is not an event/);
  });

  it('refuses code outside the extension or not JavaScript, and pages with no code to answer them', () => {
    for (const main of ['../main/main.js', '/etc/x.js', 'main.ts', '']) {
      expect(() => validateManifest({ ...BASE, main }, known), main).toThrowError(/names code that is not a \.js file inside itself/);
    }
    const { main: _none, ...noMain } = BASE;
    expect(() => validateManifest(noMain, known)).toThrowError(/offers pages and has no main module/);
  });
});

describe('P8-contribution: the pages a manifest offers (QGD-HOM-0001)', () => {
  it('refuses a page with no name, description or refresh interval, naming the page', () => {
    for (const [field, value, message] of [
      ['name', '', /has no name of at most 40/], ['description', ' ', /no description of at most 120/],
      // One line and two on a tile: every extension conforms (KI7MT, 2026-10-22).
      ['name', 'x'.repeat(41), /at most 40/], ['description', 'x'.repeat(121), /at most 120/],
      ['icon', 'Sun!', /icon that is not a plain name/], ['rail', 'yes', /true or false/],
      ['refreshSeconds', 30, /no refresh interval between a minute and a day/], ['refreshSeconds', 1.5, /refresh interval/],
      ['refreshSeconds', undefined, /refresh interval/]
    ] as const) {
      expect(() => validateManifest({ ...BASE, contributes: { pages: [{ ...PAGE, [field]: value }] } }, known), String(field))
        .toThrowError(message);
    }
  });

  it('refuses markup in a page\'s name or description, which Home would refuse to draw', () => {
    expect(() => validateManifest({ ...BASE, contributes: { pages: [{ ...PAGE, description: 'SFI < 100' }] } }, known)).toThrowError(/markup in its name or description/);
    expect(() => validateManifest({ ...BASE, contributes: { pages: [{ ...PAGE, name: '<b>Bold</b>' }] } }, known)).toThrowError(/markup/);
    expect(() => validateManifest({ ...BASE, name: 'On <the> Air' }, known)).toThrowError(/no name to show/);
  });

  it('refuses a page offered twice, and a list that is not a short list', () => {
    expect(() => validateManifest({ ...BASE, contributes: { pages: [PAGE, PAGE] } }, known)).toThrowError(/offers the page "conditions" twice/);
    const many = Array.from({ length: 17 }, (_, i) => ({ ...PAGE, id: `page-${i}` }));
    expect(() => validateManifest({ ...BASE, contributes: { pages: many } }, known)).toThrowError(/at most 16/);
  });

  it('keeps an icon name and a rail item when given, and leaves them out when not', () => {
    const manifest = validateManifest({ ...BASE, contributes: { pages: [{ ...PAGE, icon: 'sun', rail: true }] } }, known);
    expect(manifest.contributes.pages[0]).toEqual({ ...PAGE, icon: 'sun', rail: true });
    expect(validateManifest({ ...BASE, contributes: { pages: [{ ...PAGE, rail: false }] } }, known).contributes.pages[0]).toEqual(PAGE);
  });
});
