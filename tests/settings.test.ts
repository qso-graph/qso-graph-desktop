// SPDX-License-Identifier: GPL-3.0-only
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS, isThemeChoice, readSettings, validateSettingsCommand, DAY_ONE_PINS, isPins, MAX_PINS } from '../packages/main/settings-contract.js';
import { applyTheme, followSystem, isPinned, resolveTheme, type Appearance, type Theme } from '../packages/renderer/theme.js';
import { WINDOW_BACKGROUND, windowBackground } from '../packages/main/window-background.js';
import { readFile } from 'node:fs/promises';
import { THEME_CHOICES } from '../packages/main/settings-contract.js';

// Enough of an element for applyTheme, which touches one attribute and one
// style property.
function fakeRoot() {
  const attributes = new Map<string, string>();
  return {
    style: { colorScheme: 'untouched' },
    setAttribute(name: string, value: string) { attributes.set(name, value); },
    getAttribute(name: string) { return attributes.get(name) ?? null; }
  };
}

describe('QGD-FRM-0001 and QGD-FRM-0002 which theme is in force', () => {
  it.each([
    ['system', true, 'dark'],
    ['system', false, 'light'],
    ['dark', false, 'dark'],
    ['light', true, 'light']
  ] as const)('choice %s with system-dark %s resolves to %s', (choice, prefersDark, expected) => {
    expect(resolveTheme(choice, prefersDark)).toBe(expected);
  });

  it('defaults to dark, as rig and SDR software is', () => {
    expect(DEFAULT_SETTINGS.theme).toBe('dark');
  });

  it('marks a named theme as pinned and System as followed', () => {
    expect(isPinned('system')).toBe(false);
    expect(isPinned('light')).toBe(true);
    expect(isPinned('dark')).toBe(true);
  });

  it('writes color-scheme only for a theme the user chose', () => {
    // The regression this exists for: prefers-color-scheme reports the page's
    // USED colour scheme. Writing color-scheme while following the system makes
    // the media query report back what was just written, so the first reading
    // becomes permanent and the shell never follows anything. Measured through
    // Electron's nativeTheme in the smoke suite; stated here.
    for (const theme of ['light', 'dark'] as Theme[]) {
      const followed = fakeRoot();
      applyTheme(theme, false, followed as unknown as HTMLElement);
      expect(followed.getAttribute('data-theme')).toBe(theme);
      expect(followed.style.colorScheme, 'following must leave the root to the stylesheet').toBe('');

      const chosen = fakeRoot();
      applyTheme(theme, true, chosen as unknown as HTMLElement);
      expect(chosen.getAttribute('data-theme')).toBe(theme);
      expect(chosen.style.colorScheme).toBe(theme);
    }
  });
});

describe('QGD-FRM-0001 the frame before the renderer draws', () => {
  it('opens the window in the theme the shell is about to apply', () => {
    for (const choice of THEME_CHOICES) {
      for (const systemPrefersDark of [true, false]) {
        const resolved = resolveTheme(choice, systemPrefersDark);
        expect(windowBackground(choice, systemPrefersDark),
          `${choice} with system-dark ${systemPrefersDark} must open as ${resolved}`)
          .toBe(WINDOW_BACKGROUND[resolved]);
      }
    }
  });

  it('uses the same two colours the stylesheet does', async () => {
    // The main process cannot import the renderer's theme module, so these two
    // values are a copy. This is what stops the copy drifting.
    const css = await readFile('packages/renderer/style.css', 'utf8');
    const block = (selector: string) => {
      const start = css.indexOf(selector);
      expect(start, `${selector} must exist in the stylesheet`).toBeGreaterThan(-1);
      const body = css.slice(start, css.indexOf('}', start));
      const page = /--page:\s*(#[0-9a-f]{3,8})/i.exec(body);
      expect(page, `${selector} must set --page`).not.toBeNull();
      return page![1].toLowerCase();
    };
    expect(block(':root {')).toBe(WINDOW_BACKGROUND.light);
    expect(block(':root[data-theme="dark"] {')).toBe(WINDOW_BACKGROUND.dark);
  });

  it('declares support for both schemes exactly once, at the root', async () => {
    // A theme block that narrowed color-scheme would answer the media query
    // two rules below it, which is the defect this guards.
    const css = await readFile('packages/renderer/style.css', 'utf8');
    const declarations = [...css.matchAll(/^\s*color-scheme:\s*([^;]+);/gm)].map(match => match[1].trim());
    expect(declarations).toEqual(['light dark']);
  });
});

describe('QGD-SEC-0006 the settings channel rejects rather than coerces', () => {
  it('accepts the two commands it has', () => {
    expect(validateSettingsCommand({ type: 'read' })).toBe(true);
    for (const value of ['system', 'light', 'dark']) {
      expect(validateSettingsCommand({ type: 'write', key: 'theme', value })).toBe(true);
    }
  });

  it.each([
    [{ type: 'read', extra: 1 }, 'an unexpected key'],
    [{ type: 'write', key: 'theme', value: 'sepia' }, 'a value outside the contract'],
    [{ type: 'write', key: 'theme' }, 'a missing value'],
    [{ type: 'write', key: 'constructor', value: 'x' }, 'a prototype-polluting key'],
    [{ type: 'write', key: '__proto__', value: 'x' }, 'the other one'],
    [{ type: 'write', key: 'windowSize', value: 1 }, 'a key that is not a setting'],
    [{ type: 'nonsense' }, 'an unknown command'],
    ['read', 'a string'],
    [null, 'null'],
    [[{ type: 'read' }], 'an array']
  ])('refuses %#: %s', command => {
    expect(validateSettingsCommand(command)).toBe(false);
  });

  it('knows a theme choice from anything else', () => {
    expect(isThemeChoice('dark')).toBe(true);
    expect(isThemeChoice('Dark')).toBe(false);
    expect(isThemeChoice(null)).toBe(false);
  });
});

describe('QGD-ENG-0003 reading a settings file that is not what we wrote', () => {
  it('reads what is valid and defaults the rest, key by key', () => {
    expect(readSettings({ theme: 'dark' })).toEqual({ theme: 'dark', grants: {}, pins: DAY_ONE_PINS, extensionsOff: [], welcomeHidden: '' });
    // A hand-edited or older file must not take the whole thing down.
    expect(readSettings({ theme: 'sepia' })).toEqual({ theme: 'dark', grants: {}, pins: DAY_ONE_PINS, extensionsOff: [], welcomeHidden: '' });
    expect(readSettings({ unknown: true })).toEqual({ theme: 'dark', grants: {}, pins: DAY_ONE_PINS, extensionsOff: [], welcomeHidden: '' });
    expect(readSettings(null)).toEqual({ theme: 'dark', grants: {}, pins: DAY_ONE_PINS, extensionsOff: [], welcomeHidden: '' });
    expect(readSettings('not an object')).toEqual({ theme: 'dark', grants: {}, pins: DAY_ONE_PINS, extensionsOff: [], welcomeHidden: '' });
  });

  it('ignores an inherited property rather than reading it as a setting', () => {
    const hostile = Object.create({ theme: 'dark' }) as Record<string, unknown>;
    expect(readSettings(hostile)).toEqual({ theme: 'dark', grants: {}, pins: DAY_ONE_PINS, extensionsOff: [], welcomeHidden: '' });
  });
});

describe('QGD-FRM-0001 where the system appearance is read from', () => {
  // A media query that lies, which is what Electron 44 gave us: the system was
  // dark and this reported light.
  function fakeWindow(queryMatches: boolean) {
    const listeners = new Set<(event: { matches: boolean }) => void>();
    const query = {
      matches: queryMatches,
      addEventListener: (_name: string, listener: (event: { matches: boolean }) => void) => { listeners.add(listener); },
      removeEventListener: (_name: string, listener: (event: { matches: boolean }) => void) => { listeners.delete(listener); }
    };
    return {
      window: { matchMedia: () => query },
      announce: (matches: boolean) => { for (const listener of [...listeners]) listener({ matches }); },
      listening: () => listeners.size
    };
  }

  function fakeAppearance(prefersDark: boolean) {
    const listeners = new Set<(prefersDark: boolean) => void>();
    const appearance: Appearance = {
      prefersDark: () => Promise.resolve(prefersDark),
      onChange: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }
    };
    return { appearance, announce: (value: boolean) => { for (const listener of [...listeners]) listener(value); }, listening: () => listeners.size };
  }

  it('takes its first answer from the main process, not the media query', async () => {
    const fake = fakeWindow(false);
    const stub = Reflect.set(globalThis, 'window', fake.window);
    expect(stub).toBe(true);
    const main = fakeAppearance(true);
    const seen: boolean[] = [];
    const stop = followSystem(value => seen.push(value), main.appearance);
    await Promise.resolve();
    await Promise.resolve();
    // The media query said light. The main process said dark. Dark is applied,
    // and light is never applied on the way there.
    expect(seen).toEqual([true]);
    stop();
  });

  it('follows a change from either source and stops following both', async () => {
    const fake = fakeWindow(false);
    Reflect.set(globalThis, 'window', fake.window);
    const main = fakeAppearance(false);
    const seen: boolean[] = [];
    const stop = followSystem(value => seen.push(value), main.appearance);
    await Promise.resolve();
    await Promise.resolve();
    expect(seen).toEqual([false]);

    main.announce(true);
    expect(seen).toEqual([false, true]);
    fake.announce(false);
    expect(seen).toEqual([false, true, false]);

    stop();
    expect(main.listening()).toBe(0);
    expect(fake.listening()).toBe(0);
    main.announce(true);
    fake.announce(true);
    expect(seen).toEqual([false, true, false]);
  });

  it('falls back to the media query when the main process cannot answer', async () => {
    const fake = fakeWindow(true);
    Reflect.set(globalThis, 'window', fake.window);
    const refusing: Appearance = {
      prefersDark: () => Promise.reject(new Error('refused')),
      onChange: () => () => {}
    };
    const seen: boolean[] = [];
    const stop = followSystem(value => seen.push(value), refusing);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(seen).toEqual([true]);
    stop();
  });

  it('works with no appearance surface at all', () => {
    // A preload that does not expose it must not leave the window unthemed.
    const fake = fakeWindow(true);
    Reflect.set(globalThis, 'window', fake.window);
    const seen: boolean[] = [];
    const stop = followSystem(value => seen.push(value), undefined);
    expect(seen).toEqual([true]);
    stop();
    expect(fake.listening()).toBe(0);
  });
});

describe('the grants the operator has allowed', () => {
  it('defaults to none, which is what a fresh install has', () => {
    expect(DEFAULT_SETTINGS.grants).toEqual({});
    expect(readSettings({}).grants).toEqual({});
  });

  it('accepts a well-formed map and refuses anything else', () => {
    expect(readSettings({ grants: { 'qrz-lookup': ['service:qrz', 'callsign:list'] } }).grants)
      .toEqual({ 'qrz-lookup': ['service:qrz', 'callsign:list'] });
    // Not a map at all, or an entry for no extension id: nothing is read.
    for (const bad of [[], 'service:qrz', null, { 'QRZ-Lookup': ['service:qrz'] }]) {
      expect(readSettings({ grants: bad }).grants, JSON.stringify(bad)).toEqual({});
    }
    // An unreadable entry for a real extension id fails closed: that
    // extension holds nothing that needs the operator, rather than its entry
    // vanishing and the default handing it everything back (QGD-APP-0012.1).
    for (const bad of [
      { 'qrz-lookup': 'service:qrz' },            // not a list
      { 'qrz-lookup': ['not a grant id'] },       // not a grant id
      { 'qrz-lookup': [1] }                       // not a string
    ]) {
      expect(readSettings({ grants: bad }).grants, JSON.stringify(bad)).toEqual({ 'qrz-lookup': [] });
    }
  });

  it('is a settable key, so a withdrawal can be written', () => {
    // QGD-APP-0012: the operator can withdraw a grant. That means the key has
    // to pass the write-command validator, with its value checked.
    expect(validateSettingsCommand({ type: 'write', key: 'grants', value: { solar: [] } })).toBe(true);
    expect(validateSettingsCommand({ type: 'write', key: 'grants', value: { solar: ['nope'] } })).toBe(false);
  });

  it('still refuses the prototype-polluting keys', () => {
    for (const key of ['__proto__', 'constructor', 'prototype']) {
      expect(validateSettingsCommand({ type: 'write', key, value: {} }), key).toBe(false);
    }
  });
});

describe('P8-pins: pins in settings.json (QGD-HOM-0003, QGD-HOM-0004)', () => {
  it('starts a new install with the day-one cards pinned, in order', () => {
    expect(readSettings({})).toMatchObject({ pins: ['on-the-air/conditions', 'astro/astro', 'on-the-air/parks'] });
    expect(DAY_ONE_PINS).toEqual(['on-the-air/conditions', 'astro/astro', 'on-the-air/parks']);
  });

  it('keeps the order an operator set', () => {
    const pins = ['other/second', 'on-the-air/conditions', 'other/card'];
    expect(readSettings({ pins }).pins).toEqual(pins);
  });

  it('refuses a seventh pin, a duplicate, a malformed name or a gap', () => {
    const six = Array.from({ length: MAX_PINS }, (_, i) => `ext/card-${i}`);
    expect(isPins(six)).toBe(true);
    expect(isPins([...six, 'ext/card-six'])).toBe(false);
    expect(isPins(['ext/card', 'ext/card'])).toBe(false);
    for (const bad of ['card', 'Ext/Card', 'ext/', 'a/b/c', '../x/y']) expect(isPins([bad]), bad).toBe(false);
    const gap = ['ext/card']; gap.length = 2;
    expect(isPins(gap)).toBe(false);
    // A file holding a bad list keeps the day-one pins rather than half of it.
    expect(readSettings({ pins: ['ext/card', 'ext/card'] }).pins).toEqual(DAY_ONE_PINS);
  });
});

describe('pins change only through Home (QGD-HOM-0005)', () => {
  it('refuses a settings write to pins, which would bypass Home cancelling what an unpinned card has in flight', () => {
    expect(validateSettingsCommand({ type: 'write', key: 'pins', value: [] })).toBe(false);
    expect(validateSettingsCommand({ type: 'write', key: 'theme', value: 'dark' })).toBe(true);
  });
});

describe('grants in a damaged settings file fail closed (QGD-APP-0012, QGD-APP-0012.1)', () => {
  it('keeps every readable entry, and reads an unreadable one as everything withdrawn', () => {
    const settings = readSettings({ grants: { 'on-the-air': [], 'another-one': 'typo', 'third-one': ['callsign:list'] } });
    expect(settings.grants).toEqual({ 'on-the-air': [], 'another-one': [], 'third-one': ['callsign:list'] });
  });
});

describe('a withdrawal is never lost to a long grants map', () => {
  it('reads every entry, however many there are', () => {
    const grants: Record<string, unknown> = {};
    for (let i = 0; i < 70; i++) grants[`ext-${i}`] = ['callsign:list'];
    grants['on-the-air'] = 'damaged';
    expect(readSettings({ grants }).grants['on-the-air']).toEqual([]);
  });
});

describe('QGD-FRM-0016: the welcome remembers the release it was hidden for', () => {
  it('starts empty, so a new install shows it', () => {
    expect(readSettings({}).welcomeHidden).toBe('');
  });

  it('keeps a release name, and nothing else', () => {
    expect(readSettings({ welcomeHidden: '0.0.0-preview.1' }).welcomeHidden).toBe('0.0.0-preview.1');
    expect(readSettings({ welcomeHidden: '<script>' }).welcomeHidden).toBe('');
    expect(readSettings({ welcomeHidden: 7 }).welcomeHidden).toBe('');
    expect(validateSettingsCommand({ type: 'write', key: 'welcomeHidden', value: '0.1.0' })).toBe(true);
    expect(validateSettingsCommand({ type: 'write', key: 'welcomeHidden', value: 'x'.repeat(41) })).toBe(false);
  });
});

