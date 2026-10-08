// SPDX-License-Identifier: GPL-3.0-only
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS, isThemeChoice, readSettings, validateSettingsCommand
} from '../src/settings-contract.js';
import { resolveTheme } from '../src/renderer/theme.js';

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
