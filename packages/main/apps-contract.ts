// SPDX-License-Identifier: GPL-3.0-only
// What Settings is told about the applications that loaded (QGD-APP-0012).
//
// A contract of its own, beside logs-contract.ts and on the same pattern: the
// shape lives with the side that serves it and the renderer depends on it
// (QGD-REP-0006). It is deliberately **not** part of `app-api`: an application
// has no business enumerating the others, and `app-api` is what an application
// is written against.
//
// This exists because the grant model was built without it. The requirement
// says grants are shown in Settings with the application that holds them and
// that a withdrawal takes effect without a restart — and the first version of
// P7 gave the operator a settings *file* and an IPC call, which is not a
// surface they can reach. Found in review.
export interface GrantOffer {
  readonly id: string;
  // The sentence the register carries, shown to the operator when they are
  // asked to allow it. A grant with no explanation cannot be put to anybody,
  // which is why the register refuses one.
  readonly what: string;
  readonly notWhat?: string;
  // False means holding it needs nobody: reading reference data the frame
  // already loaded, or a source the frame itself registered. Those are shown
  // as held and are not offered as a choice, because there is no choice.
  readonly needsOperator: boolean;
  readonly held: boolean;
}

export interface AppEntry {
  readonly id: string;
  readonly name: string;
  readonly tier: string;
  readonly version: string;
  // Every grant the manifest asked for, each with whether it is held.
  readonly grants: readonly GrantOffer[];
}

export interface RefusedEntry {
  readonly source: string;
  readonly reason: string;
}

export interface AppInventory {
  readonly apps: readonly AppEntry[];
  // Applications that did not load, so an operator can see that something was
  // refused rather than silently missing (QGD-APP-0011).
  readonly refused: readonly RefusedEntry[];
}

export type AppsCommand = { readonly type: 'inventory' };

export type AppsReply =
  | { readonly ok: true; readonly inventory: AppInventory }
  | { readonly ok: false; readonly error: string };

export function validateAppsCommand(value: unknown): value is AppsCommand {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === 1 && keys[0] === 'type' && (value as { type: unknown }).type === 'inventory';
}
