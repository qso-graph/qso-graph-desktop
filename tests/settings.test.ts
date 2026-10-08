// SPDX-License-Identifier: GPL-3.0-only
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS, isThemeChoice, readSettings, validateSettingsCommand
} from '../src/settings-contract.js';
import { applyTheme, followSystem, isPinned, resolveTheme, type Appearance, type Theme } from '../src/renderer/theme.js';
import { WINDOW_BACKGROUND, windowBackground } from '../src/window-background.js';
import { readFile } from 'node:fs/promises';
import { THEME_CHOICES } from '../src/settings-contract.js';

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

  it('defaults to following the system', () => {
    expect(DEFAULT_SETTINGS.theme).toBe('system');
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
    const css = await readFile('src/renderer/style.css', 'utf8');
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
    const css = await readFile('src/renderer/style.css', 'utf8');
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
    expect(readSettings({ theme: 'dark' })).toEqual({ theme: 'dark' });
    // A hand-edited or older file must not take the whole thing down.
    expect(readSettings({ theme: 'sepia' })).toEqual({ theme: 'system' });
    expect(readSettings({ unknown: true })).toEqual({ theme: 'system' });
    expect(readSettings(null)).toEqual({ theme: 'system' });
    expect(readSettings('not an object')).toEqual({ theme: 'system' });
  });

  it('ignores an inherited property rather than reading it as a setting', () => {
    const hostile = Object.create({ theme: 'dark' }) as Record<string, unknown>;
    expect(readSettings(hostile)).toEqual({ theme: 'system' });
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
