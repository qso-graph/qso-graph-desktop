// SPDX-License-Identifier: GPL-3.0-only
// Loading extensions and deciding what they may do (QGD-APP-0001,
// QGD-APP-0004, QGD-APP-0005, QGD-APP-0006, QGD-APP-0011).
//
// This is the enforcement point. QGD-CRD-0002 puts the grant model's
// enforcement in the core, and the reason is in the sentence: an extension
// asking itself whether it is allowed is not a permission system. So every
// decision here is made from the manifest the core read and the grants the
// operator allowed, and never from anything the extension says at the time
// of the call.
//
// Deliberately free of Electron, the filesystem and IPC. Loading is given the
// manifests it should consider rather than finding them, and deciding is a
// function of a request and what is held. That is not tidiness: a decision
// that needs a window, a disk and a running engine to exercise is a decision
// that gets tested once, and this one needs to be tested against every way of
// getting it wrong.
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type ExtensionManifest, ManifestError, validateManifest
} from '../extension-api/manifest.js';
import { type Grant, type GrantRegister, findGrant, grantIds } from '../extension-api/grants.js';
import { type ExtensionInfo, type ExtensionRequest, requiredGrant } from '../extension-api/api-contract.js';

export interface LoadedExtension {
  readonly manifest: ExtensionManifest;
  // What it actually holds. A grant it asked for that the operator has not
  // allowed is absent, which is why this is separate from manifest.grants:
  // asking and holding are different facts (QGD-APP-0012).
  readonly held: readonly string[];
  // The manifest file it was read from. Its directory is where its code is,
  // and only directories the core chose are read (QGD-APP-0017).
  readonly source: string;
}

export interface RefusedApp {
  // The id when the manifest got far enough to have one; the file otherwise,
  // because a refusal nobody can trace to a file is not actionable.
  readonly id: string | undefined;
  readonly source: string;
  readonly reason: string;
  readonly subject: string | undefined;
}

export interface LoadResult {
  readonly loaded: readonly LoadedExtension[];
  readonly refused: readonly RefusedApp[];
}

// What the operator has allowed, per application. Simple settings, so it lives
// in the settings file rather than the database (QGD-ENG-0003): the core
// decides what an extension may do before the engine is up.
export type AllowedGrants = Readonly<Record<string, readonly string[]>>;

// A grant the register marks `needsOperator: false` is held as soon as the
// manifest asks for it: reading reference data the core has already loaded,
// or fetching from a source the core itself registered, asks nothing of
// anybody. Everything else waits to be allowed.
export function heldGrants(
  manifest: ExtensionManifest, register: GrantRegister, allowed: AllowedGrants
): string[] {
  const permitted = new Set(allowed[manifest.id] ?? []);
  return manifest.grants.filter(id => {
    const grant: Grant | undefined = findGrant(register, id);
    // A grant that is not in the register cannot be held. validateManifest
    // refuses the manifest for this already, so reaching here would mean the
    // register changed under a loaded application — in which case the answer
    // is still no.
    if (!grant) return false;
    // QGD-APP-0012.1: an official extension's grants are what it is, and are
    // not put to the operator, so it holds what it declares. The settings file
    // can still take grants back (QGD-APP-0012): once it lists grants for an
    // extension, that list is what the extension holds.
    if (manifest.tier === 'official' && !Object.hasOwn(allowed, manifest.id)) return true;
    return grant.needsOperator ? permitted.has(id) : true;
  });
}

// `manifests` is each candidate as it was read: its source, for a refusal to
// name, and whatever JSON.parse produced. Parsing is the caller's because a
// file that is not JSON is a different failure from a manifest that is wrong,
// and both have to be reported rather than one masking the other.
//
// `shipped` says the manifest was read from the application package's own
// extensions directory. Only those may be official (QGD-APP-0017): a manifest
// anywhere else that says `"tier": "official"` is refused, because the claim
// confers nothing and an official extension holds its grants unasked.
export function loadExtensions(
  manifests: readonly { readonly source: string; readonly value: unknown; readonly shipped?: boolean }[],
  register: GrantRegister,
  allowed: AllowedGrants = {}
): LoadResult {
  const known = grantIds(register);
  const loaded: LoadedExtension[] = [];
  const refused: RefusedApp[] = [];
  const claimed = new Map<string, string>();

  for (const candidate of manifests) {
    let manifest: ExtensionManifest;
    try {
      manifest = validateManifest(candidate.value, known);
    } catch (error) {
      const failure = error instanceof ManifestError ? error : undefined;
      refused.push({
        id: undefined,
        source: candidate.source,
        reason: failure?.message ?? 'The manifest could not be read.',
        subject: failure?.subject
      });
      continue;
    }
    if (manifest.tier === 'official' && candidate.shipped !== true) {
      refused.push({
        id: manifest.id,
        source: candidate.source,
        reason: `"${manifest.id}" says it is official, but it was not shipped with QSO Graph Desktop, so it is not loaded.`,
        subject: manifest.id
      });
      continue;
    }
    // Two extensions with one id would share a database schema and role
    // (QGD-ENG-0010) and a set of grants. The second is refused rather than
    // overwriting the first, and the refusal names what it collided with.
    const already = claimed.get(manifest.id);
    if (already !== undefined) {
      refused.push({
        id: manifest.id,
        source: candidate.source,
        reason: `"${manifest.id}" is already loaded from ${already}.`,
        subject: manifest.id
      });
      continue;
    }
    claimed.set(manifest.id, candidate.source);
    loaded.push({ manifest, held: heldGrants(manifest, register, allowed), source: candidate.source });
  }
  return { loaded, refused };
}

// ---------------------------------------------------------------------------
// The decision.

export type Decision =
  | { readonly allowed: true }
  // `refused` is the grant that was missing, so the core can say which
  // capability was refused and to whom (QGD-APP-0011). `why` is the sentence
  // shown to the operator.
  | { readonly allowed: false; readonly refused: string | undefined; readonly why: string };

export function decide(extension: LoadedExtension, request: ExtensionRequest, register: GrantRegister): Decision {
  const needed = requiredGrant(request);
  // No grant needed: extension.info only, so an extension with nothing can still
  // read its own standing (QGD-APP-0005).
  if (needed === undefined) return { allowed: true };

  // Refused before it is checked against what is held: a request naming a
  // source or service nobody registered produces a grant id that cannot
  // exist, and saying so names the right thing. Without this the operator is
  // told a grant was missing, which invites them to go and allow it.
  if (!findGrant(register, needed)) {
    return {
      allowed: false,
      refused: needed,
      why: `"${extension.manifest.name}" asked for ${needed}, which is not a capability this product has.`
    };
  }
  if (!extension.held.includes(needed)) {
    const asked = extension.manifest.grants.includes(needed);
    return {
      allowed: false,
      refused: needed,
      // The two cases read differently to an operator, and both are true
      // statements rather than a guess: one is fixable by allowing it, the
      // other is not fixable at all without a new version of the extension.
      why: asked
        ? `"${extension.manifest.name}" needs ${needed}, which has not been allowed.`
        : `"${extension.manifest.name}" asked to use ${needed}, which it did not declare.`
    };
  }
  return { allowed: true };
}

export function extensionInfo(extension: LoadedExtension): ExtensionInfo {
  const { id, name, tier, version } = extension.manifest;
  // What it holds, not what it asked for: an extension that has had a grant
  // withdrawn sees that here, which is how it can say why it stopped working
  // rather than failing at the next call.
  return { id, name, tier, version, grants: [...extension.held] };
}

// Withdrawing a grant takes effect without a restart (QGD-APP-0012), so this
// returns the extension as it now stands rather than mutating it: the next
// decision is made against the new value, and there is no moment where a
// half-updated application is being asked about.
export function withGrants(
  extension: LoadedExtension, register: GrantRegister, allowed: AllowedGrants
): LoadedExtension {
  return { manifest: extension.manifest, held: heldGrants(extension.manifest, register, allowed), source: extension.source };
}

// ---------------------------------------------------------------------------
// Reading what is on disk.
//
// Here rather than in extension-broker.ts because that module imports Electron, and
// a pure function behind an Electron import is a pure function no unit test
// can reach. Everything in this file is exercisable without a window.

interface SourceRegister {
  readonly sources: Readonly<Record<string, string>>;
}

export async function readSourceRegister(file: string): Promise<SourceRegister> {
  const parsed: unknown = JSON.parse(await readFile(file, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null) throw new Error('The source register is not an object.');
  const sources = (parsed as { sources?: unknown }).sources;
  if (typeof sources !== 'object' || sources === null) throw new Error('The source register has no sources.');
  const out: Record<string, string> = {};
  for (const [id, url] of Object.entries(sources as Record<string, unknown>)) {
    if (typeof url !== 'string' || !url.startsWith('https://')) {
      throw new Error(`Source "${id}" is not an HTTPS URL.`);
    }
    out[id] = url;
  }
  return { sources: out };
}

// Read from a directory of application directories. A manifest that cannot be
// parsed is reported as a refusal rather than skipped: an extension that
// silently fails to appear is harder to diagnose than one that says why.
// `shipped` marks every manifest found as the package's own (QGD-APP-0017);
// the caller knows which directories those are, a manifest never does.
export async function readManifests(
  directories: readonly string[], shipped = false
): Promise<{ source: string; value: unknown; shipped: boolean }[]> {
  const found: { source: string; value: unknown; shipped: boolean }[] = [];
  for (const directory of directories) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      // A directory that is not there holds no extensions. `apps/` is empty
      // until QGD-PRT-0108 and the proofs are absent from a shipped build
      // (QGD-APP-0014.1), so this is the ordinary case, not an error.
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const file = join(directory, entry.name, 'manifest.json');
      try {
        found.push({ source: file, value: JSON.parse(await readFile(file, 'utf8')), shipped });
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === 'ENOENT') continue;
        found.push({ source: file, value: { __unreadable: String(error) }, shipped });
      }
    }
  }
  return found;
}
