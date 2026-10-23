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
import { HINT_MAX, INPUT_KINDS, MAX_INPUTS, TEXT_MAX, type PageInput } from './inputs.js';

export const MANIFEST_VERSION = 1;
export const API_VERSION = '1.0.0';

// Activation reasons beyond the extension's contributions, which activate it
// on their own (a pinned card, QGD-APP-0020). Closed, like the grant register:
// an event nobody defined would be a trigger nothing checks.
export const ACTIVATION_EVENTS = ['onStartupFinished'] as const;

// A page an extension offers (KI7MT, 2026-10-22): the core draws it from the
// data the extension answers with, and no extension code or markup runs in
// the window. It can be pinned to Home, where it is a tile drawn from this
// entry alone, its name, description and icon, the same shape for every
// extension; clicking the tile opens the page. A page under no other is a
// destination, on the rail whenever its extension is on (KI7MT, 2026-10-23:
// "enable in settings, add to the rail"), so a manifest does not say so. Its
// identifier, once published, never changes, because a pin names it
// (QGD-APP-0019).
export interface PageContribution {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  // The shortest interval the broker may refresh it at while it is open
  // (QGD-HOM-0005).
  readonly refreshSeconds: number;
  // A name from the core's own icon set; the window draws no extension
  // artwork. An unknown name is drawn as a generic icon.
  readonly icon?: string;
  // The fields the page asks the operator for, drawn and checked by the core
  // (inputs.ts).
  readonly inputs?: readonly PageInput[];
  // Whether the page needs the internet (KI7MT, 2026-10-23): a page that does
  // not keeps working offline, though its extension may fetch for another
  // page. Absent, the core works it out from the extension's grants.
  readonly network?: boolean;
  // An area of pages (KI7MT, 2026-10-23: "Open POTA, see all the things you
  // can do there"): a page `under` another of the same extension is a tab in
  // that page's area, reached from its pin or rail item and not pinned or
  // railed on its own. `tab` is the short name on its tab; absent, its name.
  readonly under?: string;
  readonly tab?: string;
  // Its destination's colour on the rail, one of the core's own by name
  // (KI7MT, 2026-10-23): never a colour of the extension's own, so every
  // theme draws it. Absent, blue.
  readonly hue?: PageHue;
}

// The core's colours a destination may take, and the theme token each is.
export const PAGE_HUES = { blue: 'general', amber: 'callsigns', green: 'locations', slate: 'settings' } as const;
export type PageHue = keyof typeof PAGE_HUES;

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
  readonly contributes: { readonly pages: readonly PageContribution[] };
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
const PAGE_FIELDS = ['id', 'name', 'description', 'refreshSeconds', 'icon', 'inputs', 'network', 'under', 'tab', 'hue'];
export const TAB_MAX = 24;
const INPUT_FIELDS = ['id', 'label', 'kind', 'max', 'hint'];
const MAX_PAGES = 16;
// A tile shows the name on one line and the description on two (KI7MT,
// 2026-10-22: every extension conforms to one tile).
export const PAGE_NAME_MAX = 40;
export const PAGE_DESCRIPTION_MAX = 120;

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

// Whether a page needs the internet: its own word where it gives one, or
// else whether its extension may fetch at all, from its grants (KI7MT,
// 2026-10-23). A page that does not is asked while offline.
export function pageNeedsNetwork(manifest: Pick<ExtensionManifest, 'grants'>, page: Pick<PageContribution, 'network'>): boolean {
  return page.network ?? manifest.grants.some(grant => grant.startsWith('source:') || grant.startsWith('service:'));
}

function validPage(value: unknown, id: string, seen: Set<string>): PageContribution {
  if (!isRecord(value)) throw new ManifestError(`"${id}" offers a page that is not an object.`, id);
  onlyKnown(value, PAGE_FIELDS, `A page in "${id}"`, id);
  const { id: page, name, description, refreshSeconds, icon, inputs, network, under, tab, hue } = value;
  if (typeof page !== 'string' || !APP_ID.test(page)) throw new ManifestError(`"${id}" offers a page with no well-formed id.`, id);
  if (seen.has(page)) throw new ManifestError(`"${id}" offers the page "${page}" twice.`, page);
  seen.add(page);
  if (typeof name !== 'string' || name.trim() === '' || name.length > PAGE_NAME_MAX) {
    throw new ManifestError(`The page "${page}" in "${id}" has no name of at most ${PAGE_NAME_MAX} characters to show.`, page);
  }
  if (typeof description !== 'string' || description.trim() === '' || description.length > PAGE_DESCRIPTION_MAX) {
    throw new ManifestError(`The page "${page}" in "${id}" has no description of at most ${PAGE_DESCRIPTION_MAX} characters.`, page);
  }
  // Drawn by the core, which refuses markup in anything it draws
  // (QGD-HOM-0002). Refused here, where it is the extension's to fix, rather
  // than there, where one page's text would make all of Home unreadable.
  if (/[<>]/.test(name) || /[<>]/.test(description)) {
    throw new ManifestError(`The page "${page}" in "${id}" has markup in its name or description.`, page);
  }
  if (!Number.isInteger(refreshSeconds) || (refreshSeconds as number) < 60 || (refreshSeconds as number) > 86_400) {
    throw new ManifestError(`The page "${page}" in "${id}" has no refresh interval between a minute and a day.`, page);
  }
  if (icon !== undefined && (typeof icon !== 'string' || !APP_ID.test(icon))) {
    throw new ManifestError(`The page "${page}" in "${id}" names an icon that is not a plain name.`, page);
  }
  if (network !== undefined && typeof network !== 'boolean') {
    throw new ManifestError(`The page "${page}" in "${id}" says whether it needs the internet with something other than true or false.`, page);
  }
  if (under !== undefined && (typeof under !== 'string' || !APP_ID.test(under) || under === page)) {
    throw new ManifestError(`The page "${page}" in "${id}" is under something that is not another page's id.`, page);
  }
  if (tab !== undefined && (typeof tab !== 'string' || tab.trim() === '' || tab.length > TAB_MAX || /[<>]/.test(tab))) {
    throw new ManifestError(`The page "${page}" in "${id}" has a tab name that is not plain text of at most ${TAB_MAX} characters.`, page);
  }
  if (hue !== undefined && (typeof hue !== 'string' || !Object.hasOwn(PAGE_HUES, hue))) {
    throw new ManifestError(`The page "${page}" in "${id}" names a colour that is not one of ${Object.keys(PAGE_HUES).join(', ')}.`, page);
  }
  const fields = validInputs(inputs, page, id);
  return {
    id: page, name, description, refreshSeconds: refreshSeconds as number,
    ...(icon !== undefined ? { icon: icon as string } : {}),
    ...(fields.length > 0 ? { inputs: fields } : {}),
    ...(network !== undefined ? { network: network as boolean } : {}),
    ...(under !== undefined ? { under: under as string } : {}), ...(tab !== undefined ? { tab: tab as string } : {}),
    ...(hue !== undefined ? { hue: hue as PageHue } : {})
  };
}

// A page's fields: at most four, each with an id, a plain label and a kind
// the core can check; a text with the longest value it takes.
function validInputs(value: unknown, page: string, id: string): PageInput[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_INPUTS) {
    throw new ManifestError(`The page "${page}" in "${id}" lists its fields as something other than a list of at most ${MAX_INPUTS}.`, page);
  }
  const seen = new Set<string>();
  return value.map((entry: unknown): PageInput => {
    if (!isRecord(entry)) throw new ManifestError(`The page "${page}" in "${id}" has a field that is not an object.`, page);
    onlyKnown(entry, INPUT_FIELDS, `A field on the page "${page}" in "${id}"`, id);
    const { id: field, label, kind, max, hint } = entry;
    if (typeof field !== 'string' || !APP_ID.test(field) || seen.has(field)) {
      throw new ManifestError(`The page "${page}" in "${id}" has a field with no well-formed, unique id.`, page);
    }
    seen.add(field);
    if (typeof label !== 'string' || label.trim() === '' || label.length > 32 || /[<>]/.test(label)) {
      throw new ManifestError(`The field "${field}" on the page "${page}" in "${id}" has no plain label of at most 32 characters.`, field);
    }
    if (!(INPUT_KINDS as readonly unknown[]).includes(kind)) {
      throw new ManifestError(`The field "${field}" on the page "${page}" in "${id}" is not a grid, a callsign or a text.`, field);
    }
    if (max !== undefined && (kind !== 'text' || !Number.isInteger(max) || (max as number) < 1 || (max as number) > TEXT_MAX)) {
      throw new ManifestError(`The field "${field}" on the page "${page}" in "${id}" gives a longest value that is not a whole number from 1 to ${TEXT_MAX}, or is not a text.`, field);
    }
    if (hint !== undefined && (typeof hint !== 'string' || hint.trim() === '' || hint.length > HINT_MAX || /[<>]/.test(hint))) {
      throw new ManifestError(`The field "${field}" on the page "${page}" in "${id}" has a hint that is not plain text of at most ${HINT_MAX} characters.`, field);
    }
    return { id: field, label, kind: kind as PageInput['kind'], ...(max !== undefined ? { max: max as number } : {}), ...(hint !== undefined ? { hint: hint as string } : {}) };
  });
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
  if (typeof name !== 'string' || name.trim() === '' || name.length > 64 || /[<>]/.test(name)) {
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
  const pages: PageContribution[] = [];
  if (contributes !== undefined) {
    if (!isRecord(contributes)) throw new ManifestError(`"${id}" has contributions that are not an object.`, id);
    onlyKnown(contributes, ['pages'], `"${id}" contributes`, id);
    if (contributes.pages !== undefined) {
      if (!Array.isArray(contributes.pages) || contributes.pages.length > MAX_PAGES) {
        throw new ManifestError(`"${id}" offers its pages as something other than a list of at most ${MAX_PAGES}.`, id);
      }
      const seen = new Set<string>();
      for (const entry of contributes.pages) pages.push(validPage(entry, id, seen));
      // An area is one level deep: a page is under a page of this extension
      // that is under none.
      for (const entry of pages) {
        if (entry.under === undefined) continue;
        const head = pages.find(other => other.id === entry.under);
        if (!head || head.under !== undefined) {
          throw new ManifestError(`The page "${entry.id}" in "${id}" is under "${entry.under}", which is not a page of its own here.`, entry.id);
        }
      }
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
  // Pages are drawn from data the extension's code returns, so offering one
  // with no code to answer for it is a manifest that cannot be kept.
  if (pages.length > 0 && main === undefined) {
    throw new ManifestError(`"${id}" offers pages and has no main module to provide them.`, id);
  }
  if (page !== undefined && !validPath(page)) {
    throw new ManifestError(`"${id}" names a page that points outside itself.`, id);
  }
  return {
    manifestVersion: MANIFEST_VERSION, id, name, tier, version, engines: { qgd: engines.qgd as string }, grants: asked,
    ...(main !== undefined ? { main: main as string } : {}),
    contributes: { pages },
    activationEvents: events,
    ...(page !== undefined ? { page: page as string } : {})
  };
}
