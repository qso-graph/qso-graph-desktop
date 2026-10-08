// SPDX-License-Identifier: GPL-3.0-only
// The settings a user can change, and what a valid value is.
//
// QGD-ENG-0003 puts these in a file rather than the database, so the
// application starts before the engine is up. QGD-SEC-0006 applies here as it
// does to every other boundary: a value is validated against this contract and
// rejected, never coerced into something near enough.
export const THEME_CHOICES = ['system', 'light', 'dark'] as const;
export type ThemeChoice = (typeof THEME_CHOICES)[number];

export interface Settings {
  // QGD-FRM-0002: System is the default.
  theme: ThemeChoice;
}

export const DEFAULT_SETTINGS: Settings = { theme: 'system' };

export type SettingsCommand =
  | { type: 'read' }
  | { type: 'write'; key: keyof Settings; value: unknown };

export type SettingsReply =
  | { ok: true; data: Settings }
  | { ok: false; error: string };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function keys(value: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(value).every(key => allowed.includes(key));
}

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return typeof value === 'string' && (THEME_CHOICES as readonly string[]).includes(value);
}

// One validator per settable key, so adding a setting means adding its rule
// rather than widening a general one.
const VALIDATORS: { [K in keyof Settings]: (value: unknown) => value is Settings[K] } = {
  theme: isThemeChoice
};

export function validateSettingsCommand(value: unknown): value is SettingsCommand {
  if (!record(value)) return false;
  switch (value.type) {
    case 'read':
      return keys(value, ['type']);
    case 'write':
      if (!keys(value, ['type', 'key', 'value'])) return false;
      // Object.hasOwn, not `in`: `'constructor' in VALIDATORS` is true through
      // the prototype chain, and the lookup then returned Object's own
      // constructor — a callable that accepts anything — so a write to
      // "constructor" was ACCEPTED. "__proto__" resolved to Object.prototype
      // and threw instead of being refused. Both are the prototype-polluting
      // keys QGD-SEC-0006 names, and both passed before this line changed.
      if (typeof value.key !== 'string' || !Object.hasOwn(VALIDATORS, value.key)) return false;
      return VALIDATORS[value.key as keyof Settings](value.value);
    default:
      return false;
  }
}

// A settings file that has been edited by hand, or written by an older version,
// is read key by key: a bad value falls back to its default rather than taking
// the whole file down with it.
export function readSettings(stored: unknown): Settings {
  const source = record(stored) ? stored : {};
  const settings = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(VALIDATORS) as (keyof Settings)[]) {
    // Own properties only: a file whose JSON carried "__proto__" would
    // otherwise be read through the prototype chain.
    if (!Object.hasOwn(source, key)) continue;
    const value = source[key];
    if (VALIDATORS[key](value)) settings[key] = value;
  }
  return settings;
}
