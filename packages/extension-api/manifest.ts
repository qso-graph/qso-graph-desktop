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

export interface ExtensionManifest {
  readonly id: string;
  readonly name: string;
  readonly tier: Tier;
  readonly version: string;
  // What it asks for. An empty list is valid and means an extension that can
  // draw its page and nothing else (QGD-APP-0005).
  readonly grants: readonly string[];
  // Where its page is, relative to the extension's own directory.
  readonly page: string;
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

// `known` is the grant register's ids. Passed in rather than read here: this
// package depends on nothing, and the core is what holds the register.
export function validateManifest(value: unknown, known: ReadonlySet<string>): ExtensionManifest {
  if (!isRecord(value)) throw new ManifestError('An extension manifest is not an object.');

  const { id, name, tier, version, grants, page } = value;
  if (typeof id !== 'string' || !APP_ID.test(id)) {
    throw new ManifestError('An extension manifest has no well-formed id.');
  }
  if (typeof name !== 'string' || name.trim() === '' || name.length > 64) {
    throw new ManifestError(`"${id}" has no name to show.`, id);
  }
  if (!isTier(tier)) {
    throw new ManifestError(`"${id}" declares no tier the core recognises.`, id);
  }
  // Refused here, before anything is loaded (QGD-APP-0004).
  if (!LOADABLE_TIERS.includes(tier)) {
    throw new ManifestError(
      `"${id}" is ${tier}, and this release runs only ${LOADABLE_TIERS.join(', ')} extensions: ` +
      'the sandbox a contributed or unofficial application needs is not built yet, ' +
      'so it is refused rather than run with the core’s own access.', tier);
  }
  if (!isVersion(version)) {
    throw new ManifestError(`"${id}" has no well-formed version.`, id);
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
  if (typeof page !== 'string' || !PAGE.test(page) || page.includes('..')) {
    throw new ManifestError(`"${id}" does not say where its page is, or points outside itself.`, id);
  }
  return { id, name, tier, version, grants: asked, page };
}
