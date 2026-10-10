// SPDX-License-Identifier: GPL-3.0-only
// The settings a user can change, and what a valid value is.
//
// QGD-ENG-0003 puts these in a file rather than the database, so the
// application starts before the engine is up. QGD-SEC-0006 applies here as it
// does to every other boundary: a value is validated against this contract and
// rejected, never coerced into something near enough.
// The three values are the theme control's own (QGD-REP-0004); this contract
// says what a *stored* theme may be, which is the same set.
import { THEME_CHOICES, isThemeChoice, type ThemeChoice } from '../ui/theme-choice.js';
export { THEME_CHOICES, isThemeChoice, type ThemeChoice };

export interface Settings {
  // QGD-FRM-0002: System is the default.
  theme: ThemeChoice;
  // Which grants the operator has allowed, per application id (QGD-APP-0012).
  // Here rather than in the database because the frame decides what an
  // application may do before the engine is up (QGD-ENG-0003), and because a
  // permission the operator gave must be visible and revocable in a file they
  // own.
  //
  // Absent or empty means an application holds only the grants that need
  // nobody — which is the safe default and the one a fresh install has.
  grants: Readonly<Record<string, readonly string[]>>;
}

export const DEFAULT_SETTINGS: Settings = { theme: 'system', grants: {} };

// An application id and a grant id, both already bounded by the app API's own
// validators. Re-checked here because this value arrives from a settings file
// on disk, which is a boundary of its own (QGD-SEC-0006).
const APP_ID = /^[a-z][a-z0-9-]{1,30}$/;
const GRANT_ID = /^[a-z]+:[a-z0-9-]+$/;

export function isGrantMap(value: unknown): value is Readonly<Record<string, readonly string[]>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 64) return false;
  for (const [app, grants] of entries) {
    if (!APP_ID.test(app)) return false;
    if (!Array.isArray(grants) || grants.length > 32) return false;
    for (const grant of grants) {
      if (typeof grant !== 'string' || !GRANT_ID.test(grant)) return false;
    }
  }
  return true;
}

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

// One validator per settable key, so adding a setting means adding its rule
// rather than widening a general one.
const VALIDATORS: { [K in keyof Settings]: (value: unknown) => value is Settings[K] } = {
  theme: isThemeChoice,
  grants: isGrantMap
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
  // One named read per key, rather than a loop over the table.
  //
  // The loop was `settings[key] = value` over a union of keys, which stopped
  // type-checking the moment Settings had two keys of different types:
  // TypeScript cannot see that the validator it indexed is the one for the key
  // it is assigning, so it demands a value satisfying *every* key's type. The
  // honest fix is to say which validator goes with which key, which is what
  // the table was for anyway — and this keeps the rule that adding a setting
  // means adding its rule, with no cast anywhere.
  const read = <K extends keyof Settings>(key: K, accepts: (value: unknown) => value is Settings[K]): void => {
    // Own properties only: a file whose JSON carried "__proto__" would
    // otherwise be read through the prototype chain.
    if (!Object.hasOwn(source, key)) return;
    if (accepts(source[key])) settings[key] = source[key] as Settings[K];
  };
  read('theme', isThemeChoice);
  read('grants', isGrantMap);
  return settings;
}
