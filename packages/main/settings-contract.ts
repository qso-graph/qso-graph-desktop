// SPDX-License-Identifier: GPL-3.0-only
// The settings a user can change, and what a valid value is.
//
// QGD-ENG-0003 puts these in a file rather than the database, so the
// application starts before the engine is up. QGD-SEC-0006 applies here as it
// does to every other boundary: a value is validated against this contract and
// rejected, never coerced into something near enough.
// The three values are the theme control's own (QGD-REP-0004); this contract
// says what a *stored* theme may be, which is the same set.
import { isAreaEntry } from '../storage/area-entry.js';
import { THEME_CHOICES, isThemeChoice, type ThemeChoice } from '../ui/theme-choice.js';
export { THEME_CHOICES, isThemeChoice, type ThemeChoice };

export interface Settings {
  // QGD-FRM-0002: Dark is the default.
  theme: ThemeChoice;
  // Which grants the operator has allowed, per application id (QGD-APP-0012).
  // Here rather than in the database because the core decides what an
  // application may do before the engine is up (QGD-ENG-0003), and because a
  // permission the operator gave must be visible and revocable in a file they
  // own.
  //
  // Absent or empty means an application holds only the grants that need
  // nobody — which is the safe default and the one a fresh install has.
  grants: Readonly<Record<string, readonly string[]>>;
  // The pages pinned to Home, in order: at most eight, each named
  // "extension/page" (QGD-HOM-0003). A pin naming a page no extension offers
  // is kept and not shown, so a page whose extension is turned off comes back
  // where it was when it is turned on.
  pins: readonly string[];
  // The extensions the operator has turned on, by id (QGD-HOM-0007). Absent
  // or empty means none is: a new install starts with Home, Callsigns,
  // Locations and Settings alone, and the operator adds what they use (KI7MT,
  // 2026-10-23). An extension a later release brings arrives off too.
  extensionsOn: readonly string[];
  // The release the operator ticked "Don't show this again" on the welcome
  // for (QGD-FRM-0016), or empty. A new release does not match it, so the
  // welcome shows once more, as WSJT-X's versioned setting does.
  welcomeHidden: string;
  // My Area (KI7MT, 2026-10-23): the parts of POTA the operator works in, at
  // POTA's own three levels, a program (IT), an entity (291) or a location
  // (US-ID), at most MAX_AREA. Chosen before anything is fetched for them,
  // so nothing outside it is. Empty means the active Location's own.
  area: readonly string[];
}

// Enough for a home location, its neighbours and a trip's, and never the
// world (KI7MT, 2026-10-23).
export const MAX_AREA = 10;

export function isArea(value: unknown): value is readonly string[] {
  if (!Array.isArray(value) || value.length > MAX_AREA) return false;
  const seen = new Set<string>();
  for (let at = 0; at < value.length; at++) {
    const location: unknown = value[at];
    if (!Object.hasOwn(value, at) || !isAreaEntry(location) || seen.has(location)) return false;
    seen.add(location);
  }
  return true;
}

// Two rows of four on Home (KI7MT, 2026-10-22; was six).
export const MAX_PINS = 8;
// The day-one pages (QGD-HOM-0004): what a new install starts with. Your
// station was the second until it was retired (KI7MT, 2026-10-22); a pin for
// it in an older settings.json names no page, and Home skips it.
// Astro joined it (KI7MT, 2026-10-22). None since 2026-10-23 (KI7MT): every
// extension starts off, and turning one on pins its destinations.
export const DAY_ONE_PINS: readonly string[] = [];

// Dark by default (KI7MT, 2026-10-22): rig control and SDR software is dark,
// day or night. Light and System stay one choice away (QGD-FRM-0002).
export const DEFAULT_SETTINGS: Settings = { theme: 'dark', grants: {}, pins: DAY_ONE_PINS, extensionsOn: [], welcomeHidden: '', area: [] };

// A release name, as package.json writes one, or empty.
export function isWelcomeHidden(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 40 && /^[0-9A-Za-z.+-]*$/.test(value);
}

const PAGE_KEY = /^[a-z][a-z0-9-]{1,30}\/[a-z][a-z0-9-]{1,30}$/;

export function isPins(value: unknown): value is readonly string[] {
  if (!Array.isArray(value) || value.length > MAX_PINS) return false;
  const seen = new Set<string>();
  for (let at = 0; at < value.length; at++) {
    const pin: unknown = value[at];
    if (!Object.hasOwn(value, at) || typeof pin !== 'string' || !PAGE_KEY.test(pin) || seen.has(pin)) return false;
    seen.add(pin);
  }
  return true;
}

// An application id and a grant id, both already bounded by the extension API's own
// validators. Re-checked here because this value arrives from a settings file
// on disk, which is a boundary of its own (QGD-SEC-0006).
const APP_ID = /^[a-z][a-z0-9-]{1,30}$/;
const GRANT_ID = /^[a-z]+:[a-z0-9-]+$/;

export function isExtensionIds(value: unknown): value is readonly string[] {
  if (!Array.isArray(value) || value.length > 64) return false;
  const seen = new Set<string>();
  for (let at = 0; at < value.length; at++) {
    const id: unknown = value[at];
    if (!Object.hasOwn(value, at) || typeof id !== 'string' || !APP_ID.test(id) || seen.has(id)) return false;
    seen.add(id);
  }
  return true;
}

function readGrants(value: unknown): Readonly<Record<string, readonly string[]>> {
  if (isGrantMap(value)) return value;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const out: Record<string, readonly string[]> = {};
  // Every entry, however many: a cut-off would drop a withdrawal past it.
  for (const [app, grants] of Object.entries(value as Record<string, unknown>)) {
    if (!APP_ID.test(app)) continue;
    out[app] = Array.isArray(grants) && grants.length <= 32 && grants.every(grant => typeof grant === 'string' && GRANT_ID.test(grant))
      ? grants as string[] : [];
  }
  return out;
}

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

// What the settings channel may write. Pins are not among them: they change
// only through Home's channel, which cancels what an unpinned page has in
// flight (QGD-HOM-0005); a write that bypassed it would leave that running.
// Nor is which extensions are on: that changes only through the extensions
// channel, which stops the extension as it records it (QGD-HOM-0007).
export type WritableSetting = Exclude<keyof Settings, 'pins' | 'extensionsOn'>;

export type SettingsCommand =
  | { type: 'read' }
  | { type: 'write'; key: WritableSetting; value: unknown };

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
const VALIDATORS: { [K in WritableSetting]: (value: unknown) => value is Settings[K] } = {
  theme: isThemeChoice,
  grants: isGrantMap,
  welcomeHidden: isWelcomeHidden,
  area: isArea
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
      return VALIDATORS[value.key as WritableSetting](value.value);
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
  // Grants are read entry by entry, failing closed: an extension whose entry
  // cannot be read holds only the grants that need nobody, as if every other
  // were withdrawn. Discarding the whole map would hand an official extension
  // back every grant it declares (QGD-APP-0012.1), undoing withdrawals the
  // operator made; a typo must never widen what an extension holds.
  if (Object.hasOwn(source, 'grants')) settings.grants = readGrants(source.grants);
  read('pins', isPins);
  read('extensionsOn', isExtensionIds);
  read('welcomeHidden', isWelcomeHidden);
  read('area', isArea);
  return settings;
}
