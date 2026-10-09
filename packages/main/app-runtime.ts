// SPDX-License-Identifier: GPL-3.0-only
// Loading applications and deciding what they may do (QGD-APP-0001,
// QGD-APP-0004, QGD-APP-0005, QGD-APP-0006, QGD-APP-0011).
//
// This is the enforcement point. QGD-CRD-0002 puts the grant model's
// enforcement in the frame, and the reason is in the sentence: an application
// asking itself whether it is allowed is not a permission system. So every
// decision here is made from the manifest the frame read and the grants the
// operator allowed, and never from anything the application says at the time
// of the call.
//
// Deliberately free of Electron, the filesystem and IPC. Loading is given the
// manifests it should consider rather than finding them, and deciding is a
// function of a request and what is held. That is not tidiness: a decision
// that needs a window, a disk and a running engine to exercise is a decision
// that gets tested once, and this one needs to be tested against every way of
// getting it wrong.
import {
  type AppManifest, ManifestError, validateManifest
} from '../app-api/manifest.js';
import { type Grant, type GrantRegister, findGrant, grantIds } from '../app-api/grants.js';
import { type AppInfo, type AppRequest, requiredGrant } from '../app-api/api-contract.js';

export interface LoadedApp {
  readonly manifest: AppManifest;
  // What it actually holds. A grant it asked for that the operator has not
  // allowed is absent, which is why this is separate from manifest.grants:
  // asking and holding are different facts (QGD-APP-0012).
  readonly held: readonly string[];
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
  readonly loaded: readonly LoadedApp[];
  readonly refused: readonly RefusedApp[];
}

// What the operator has allowed, per application. Simple settings, so it lives
// in the settings file rather than the database (QGD-ENG-0003): the frame
// decides what an application may do before the engine is up.
export type AllowedGrants = Readonly<Record<string, readonly string[]>>;

// A grant the register marks `needsOperator: false` is held as soon as the
// manifest asks for it: reading reference data the frame has already loaded,
// or fetching from a source the frame itself registered, asks nothing of
// anybody. Everything else waits to be allowed.
export function heldGrants(
  manifest: AppManifest, register: GrantRegister, allowed: AllowedGrants
): string[] {
  const permitted = new Set(allowed[manifest.id] ?? []);
  return manifest.grants.filter(id => {
    const grant: Grant | undefined = findGrant(register, id);
    // A grant that is not in the register cannot be held. validateManifest
    // refuses the manifest for this already, so reaching here would mean the
    // register changed under a loaded application — in which case the answer
    // is still no.
    if (!grant) return false;
    return grant.needsOperator ? permitted.has(id) : true;
  });
}

// `manifests` is each candidate as it was read: its source, for a refusal to
// name, and whatever JSON.parse produced. Parsing is the caller's because a
// file that is not JSON is a different failure from a manifest that is wrong,
// and both have to be reported rather than one masking the other.
export function loadApps(
  manifests: readonly { readonly source: string; readonly value: unknown }[],
  register: GrantRegister,
  allowed: AllowedGrants = {}
): LoadResult {
  const known = grantIds(register);
  const loaded: LoadedApp[] = [];
  const refused: RefusedApp[] = [];
  const claimed = new Map<string, string>();

  for (const candidate of manifests) {
    let manifest: AppManifest;
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
    // Two applications with one id would share a database schema and role
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
    loaded.push({ manifest, held: heldGrants(manifest, register, allowed) });
  }
  return { loaded, refused };
}

// ---------------------------------------------------------------------------
// The decision.

export type Decision =
  | { readonly allowed: true }
  // `refused` is the grant that was missing, so the frame can say which
  // capability was refused and to whom (QGD-APP-0011). `why` is the sentence
  // shown to the operator.
  | { readonly allowed: false; readonly refused: string | undefined; readonly why: string };

export function decide(app: LoadedApp, request: AppRequest, register: GrantRegister): Decision {
  const needed = requiredGrant(request);
  // No grant needed: app.info only, so an application with nothing can still
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
      why: `"${app.manifest.name}" asked for ${needed}, which is not a capability this product has.`
    };
  }
  if (!app.held.includes(needed)) {
    const asked = app.manifest.grants.includes(needed);
    return {
      allowed: false,
      refused: needed,
      // The two cases read differently to an operator, and both are true
      // statements rather than a guess: one is fixable by allowing it, the
      // other is not fixable at all without a new version of the application.
      why: asked
        ? `"${app.manifest.name}" needs ${needed}, which has not been allowed.`
        : `"${app.manifest.name}" asked to use ${needed}, which it did not declare.`
    };
  }
  return { allowed: true };
}

export function appInfo(app: LoadedApp): AppInfo {
  const { id, name, tier, version } = app.manifest;
  // What it holds, not what it asked for: an application that has had a grant
  // withdrawn sees that here, which is how it can say why it stopped working
  // rather than failing at the next call.
  return { id, name, tier, version, grants: [...app.held] };
}

// Withdrawing a grant takes effect without a restart (QGD-APP-0012), so this
// returns the application as it now stands rather than mutating it: the next
// decision is made against the new value, and there is no moment where a
// half-updated application is being asked about.
export function withGrants(
  app: LoadedApp, register: GrantRegister, allowed: AllowedGrants
): LoadedApp {
  return { manifest: app.manifest, held: heldGrants(app.manifest, register, allowed) };
}
