// SPDX-License-Identifier: GPL-3.0-only
// An extension declares itself in data (QGD-APP-0001), and this is what a
// declaration has to be for the core to accept it.
//
// The point of a manifest is that **nothing about an extension is learned by
// running it**. The core reads this, decides, and only then loads code — so a
// manifest that is malformed, asks for a grant nobody defined, or declares a
// tier this release cannot sandbox is refused with none of its code loaded.
//
// QGD-APP-0004 is why `tier` is here and why the check is strict: the sandbox
// that contributed and unofficial extensions need is a later Part, so until
// it exists anything but `official` fails to load. Failing closed is the
// decision. The alternative is a release that runs third-party code with the
// core's privileges, which is exactly what D-2 was decided to prevent.

// D-2, KI7MT 2026-10-05. Named here because the API's shape depends on there
// being more than one tier, even while only the first can be loaded.
export const TIERS = ['official', 'contributed', 'unofficial'] as const;
export type Tier = (typeof TIERS)[number];

// What this release can actually run. Separate from TIERS on purpose: the list
// of tiers that exist and the list this build will load are different facts,
// and conflating them is how an unsandboxed load happens by accident.
export const LOADABLE_TIERS: readonly Tier[] = ['official'];

// The manifest format this core reads, and the extension API version it
// serves (QGD-APP-0019). A manifest states both, so a manifest written for a
// later core is refused with the version it needs rather than half-understood.
export const MANIFEST_VERSION = 1;
export const API_VERSION = '1.0.0';

// Activation reasons beyond the extension's contributions, which activate it
// on their own (a pinned card, QGD-APP-0020). Closed, like the grant register:
// an event nobody defined would be a trigger nothing checks.
export const ACTIVATION_EVENTS = ['onStartupFinished'] as const;

// A card an extension offers Home (QGD-HOM-0001). Its identifier, once
// published, never changes, because a pin names it (QGD-APP-0019).
export interface CardContribution {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  // The shortest interval the broker may refresh it at (QGD-HOM-0005).
  readonly refreshSeconds: number;
}

export interface ExtensionManifest {
  readonly manifestVersion: number;
  readonly id: string;
  readonly name: string;
  readonly tier: Tier;
  readonly version: string;
  // The extension API versions it works with, as VS Code's engines.vscode.
  readonly engines: { readonly qgd: string };
  // What it asks for. An empty list is valid and means an extension that can
  // call only the parts of the API that need no grant (QGD-APP-0005).
  readonly grants: readonly string[];
  // Its code, relative to its own directory; run only in the extension host
  // (QGD-APP-0015). Absent for an extension with nothing to run.
  readonly main?: string;
  readonly contributes: { readonly cards: readonly CardContribution[] };
  readonly activationEvents: readonly string[];
  // Its own page, if it has one: a sandboxed webview (QGD-APP-0015).
  readonly page?: string;
}

// An id names the extension's folder (QGD-ENG-0018) and its key-values in
// state.sqlite, and appears in a refusal message. Bounded and plain.
const APP_ID = /^[a-z][a-z0-9-]{1,30}$/;

// The same test, for code that receives an identifier from somewhere other than
// a manifest and must hold it to the same shape (QGD-ENG-0018: it names a folder).
export function isExtensionId(value: unknown): value is string {
  return typeof value === 'string' && APP_ID.test(value);
}

// Split before matching rather than one pattern with an optional group round
// a bounded repetition, which eslint-plugin-security reads as unsafe
// (QGD-SEC-0013). Two plain patterns say the same thing and neither can
// backtrack.
const VERSION_CORE = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
const VERSION_SUFFIX = /^[0-9A-Za-z.]{1,32}$/;

function isVersion(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 48) return false;
  const parts = value.split('-');
  if (parts.length > 2) return false;
  if (!VERSION_CORE.test(parts[0])) return false;
  return parts.length === 1 || VERSION_SUFFIX.test(parts[1]);
}
// A path inside the extension, and only inside it: no absolute path, no
// parent segment, no backslash.
const PAGE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,96}$/;

export class ManifestError extends Error {
  // The grant or tier the refusal is about, so the core can name it to the
  // operator rather than reporting that something was wrong (QGD-APP-0011).
  constructor(message: string, readonly subject?: string) { super(message); }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isTier(value: unknown): value is Tier {
  return typeof value === 'string' && (TIERS as readonly string[]).includes(value);
}

// Every field a manifest may have. Anything else is refused by name rather
// than ignored (QGD-APP-0019, QGD-SEC-0006): an ignored field is a promise
// the extension thinks it made and the core never read.
const FIELDS = ['manifestVersion', 'id', 'name', 'tier', 'version', 'engines', 'grants',
  'main', 'contributes', 'activationEvents', 'page'];
const CARD_FIELDS = ['id', 'name', 'description', 'refreshSeconds'];
const MAX_CARDS = 16;

function onlyKnown(value: Record<string, unknown>, allowed: readonly string[], where: string, subject?: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new ManifestError(`${where} has a field this core does not know: "${key}".`, subject ?? key);
  }
}

function parseVersion(value: string): [number, number, number] {
  const [major, minor, patch] = value.split('-')[0].split('.').map(Number);
  return [major, minor, patch];
}

// engines.qgd as a caret range only: ^MAJOR.MINOR.PATCH, satisfied by this
// API's version when the major is the same and the version is not older. One
// kind of range is all an extension needs, and a range grammar is a parser
// nobody has tested.
// A pre-release on either side satisfies nothing: an extension cannot ask for
// one, and a core that is one serves no published extension. Under 0.x the
// minor is the breaking number, as in npm's caret.
export function satisfiesApi(range: unknown, api: string = API_VERSION): boolean {
  if (typeof range !== 'string' || !range.startsWith('^') || !VERSION_CORE.test(range.slice(1))) return false;
  if (!VERSION_CORE.test(api)) return false;
  const wanted = parseVersion(range.slice(1));
  const have = parseVersion(api);
  if (wanted[0] !== have[0]) return false;
  if (wanted[0] === 0 && wanted[1] !== have[1]) return false;
  for (let i = 1; i < 3; i++) {
    if (have[i] > wanted[i]) return true;
    if (have[i] < wanted[i]) return false;
  }
  return true;
}

function validCard(value: unknown, id: string, seen: Set<string>): CardContribution {
  if (!isRecord(value)) throw new ManifestError(`"${id}" offers a card that is not an object.`, id);
  onlyKnown(value, CARD_FIELDS, `A card in "${id}"`, id);
  const { id: card, name, description, refreshSeconds } = value;
  if (typeof card !== 'string' || !APP_ID.test(card)) throw new ManifestError(`"${id}" offers a card with no well-formed id.`, id);
  if (seen.has(card)) throw new ManifestError(`"${id}" offers the card "${card}" twice.`, card);
  seen.add(card);
  if (typeof name !== 'string' || name.trim() === '' || name.length > 48) {
    throw new ManifestError(`The card "${card}" in "${id}" has no name to show.`, card);
  }
  if (typeof description !== 'string' || description.trim() === '' || description.length > 120) {
    throw new ManifestError(`The card "${card}" in "${id}" has no one-line description.`, card);
  }
  if (!Number.isInteger(refreshSeconds) || (refreshSeconds as number) < 60 || (refreshSeconds as number) > 86_400) {
    throw new ManifestError(`The card "${card}" in "${id}" has no refresh interval between a minute and a day.`, card);
  }
  return { id: card, name, description, refreshSeconds: refreshSeconds as number };
}

function validPath(value: unknown): value is string {
  return typeof value === 'string' && PAGE.test(value) && !value.includes('..');
}

// `known` is the grant register's ids. Passed in rather than read here: this
// package depends on nothing, and the core is what holds the register.
export function validateManifest(value: unknown, known: ReadonlySet<string>): ExtensionManifest {
  if (!isRecord(value)) throw new ManifestError('An extension manifest is not an object.');

  const { manifestVersion, id, name, tier, version, engines, grants, main, contributes, activationEvents, page } = value;
  if (typeof id !== 'string' || !APP_ID.test(id)) {
    throw new ManifestError('An extension manifest has no well-formed id.');
  }
  onlyKnown(value, FIELDS, `"${id}"`, id);
  if (manifestVersion !== MANIFEST_VERSION) {
    throw new ManifestError(`"${id}" is written for manifest version ${String(manifestVersion)}; this core reads version ${MANIFEST_VERSION}.`, id);
  }
  if (typeof name !== 'string' || name.trim() === '' || name.length > 64) {
    throw new ManifestError(`"${id}" has no name to show.`, id);
  }
  if (!isTier(tier)) {
    throw new ManifestError(`"${id}" declares no tier the core recognises.`, id);
  }
  // Refused here, before anything is loaded (QGD-APP-0004). The tier is a
  // claim, and a claim confers nothing (QGD-APP-0017): what may load is
  // decided by where the extension came from, in extension-runtime.ts.
  if (!LOADABLE_TIERS.includes(tier)) {
    throw new ManifestError(
      `"${id}" is ${tier}, and this release runs only ${LOADABLE_TIERS.join(', ')} extensions: ` +
      'the sandbox a contributed or unofficial extension needs is not built yet, ' +
      'so it is refused rather than run with the core’s own access.', tier);
  }
  if (!isVersion(version)) {
    throw new ManifestError(`"${id}" has no well-formed version.`, id);
  }
  if (!isRecord(engines)) throw new ManifestError(`"${id}" does not say which extension API it works with (engines.qgd).`, id);
  onlyKnown(engines, ['qgd'], `"${id}" engines`, id);
  if (!satisfiesApi(engines.qgd)) {
    throw new ManifestError(`"${id}" needs extension API ${String(engines.qgd)}; this core serves ${API_VERSION}.`, id);
  }
  if (!Array.isArray(grants)) {
    throw new ManifestError(`"${id}" does not say which grants it asks for; an empty list is how an extension asks for none.`, id);
  }
  const asked: string[] = [];
  for (const grant of grants) {
    if (typeof grant !== 'string') throw new ManifestError(`"${id}" asks for a grant that is not a name.`, id);
    if (!known.has(grant)) {
      // Named, because a refusal nobody can read is a refusal nobody can act
      // on (QGD-APP-0006, QGD-APP-0011).
      throw new ManifestError(`"${id}" asks for "${grant}", which is not a grant this product defines.`, grant);
    }
    if (asked.includes(grant)) throw new ManifestError(`"${id}" asks for "${grant}" twice.`, grant);
    asked.push(grant);
  }
  const cards: CardContribution[] = [];
  if (contributes !== undefined) {
    if (!isRecord(contributes)) throw new ManifestError(`"${id}" has contributions that are not an object.`, id);
    onlyKnown(contributes, ['cards'], `"${id}" contributes`, id);
    if (contributes.cards !== undefined) {
      if (!Array.isArray(contributes.cards) || contributes.cards.length > MAX_CARDS) {
        throw new ManifestError(`"${id}" offers its cards as something other than a list of at most ${MAX_CARDS}.`, id);
      }
      const seen = new Set<string>();
      for (const card of contributes.cards) cards.push(validCard(card, id, seen));
    }
  }
  const events: string[] = [];
  if (activationEvents !== undefined) {
    if (!Array.isArray(activationEvents)) throw new ManifestError(`"${id}" lists its activation events as something other than a list.`, id);
    for (const event of activationEvents) {
      if (typeof event !== 'string' || !(ACTIVATION_EVENTS as readonly string[]).includes(event)) {
        throw new ManifestError(`"${id}" activates on "${String(event)}", which is not an event this core defines.`, id);
      }
      if (!events.includes(event)) events.push(event);
    }
  }
  if (main !== undefined && (!validPath(main) || !main.endsWith('.js'))) {
    throw new ManifestError(`"${id}" names code that is not a .js file inside itself.`, id);
  }
  // Cards are drawn from data the extension's code returns, so offering one
  // with no code to answer for it is a manifest that cannot be kept.
  if (cards.length > 0 && main === undefined) {
    throw new ManifestError(`"${id}" offers cards and has no main module to provide them.`, id);
  }
  if (page !== undefined && !validPath(page)) {
    throw new ManifestError(`"${id}" names a page that points outside itself.`, id);
  }
  return {
    manifestVersion: MANIFEST_VERSION, id, name, tier, version, engines: { qgd: engines.qgd as string }, grants: asked,
    ...(main !== undefined ? { main: main as string } : {}),
    contributes: { cards },
    activationEvents: events,
    ...(page !== undefined ? { page: page as string } : {})
  };
}
