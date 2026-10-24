// SPDX-License-Identifier: GPL-3.0-only
// What Settings is told about the extensions that loaded (QGD-APP-0012).
//
// A contract of its own, beside logs-contract.ts and on the same pattern: the
// shape lives with the side that serves it and the renderer depends on it
// (QGD-REP-0006). It is deliberately **not** part of `extension-api`: an extension
// has no business enumerating the others, and `extension-api` is what an extension
// is written against.
//
// This exists because the grant model was built without it. The requirement
// says grants are shown in Settings with the extension that holds them and
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
  // False means holding it needs nobody: reading reference data the core
  // already loaded, or a source the core itself registered. Those are shown
  // as held and are not offered as a choice, because there is no choice.
  readonly needsOperator: boolean;
  readonly held: boolean;
}

export interface ExtensionEntry {
  readonly id: string;
  readonly name: string;
  readonly tier: string;
  readonly version: string;
  // The names of the pages it offers, so Settings can say what turning it off
  // takes away.
  readonly pages: readonly string[];
  // Off when the operator turned it off (QGD-HOM-0007): it stays installed,
  // offers no pages and is not started.
  readonly enabled: boolean;
  // Every grant the manifest asked for, each with whether it is held.
  readonly grants: readonly GrantOffer[];
}

export interface RefusedEntry {
  readonly source: string;
  readonly reason: string;
}

export interface ExtensionInventory {
  readonly extensions: readonly ExtensionEntry[];
  // Extensions that did not load, so an operator can see that something was
  // refused rather than silently missing (QGD-APP-0011).
  readonly refused: readonly RefusedEntry[];
}

export type ExtensionsCommand =
  | { readonly type: 'inventory' }
  | { readonly type: 'set-enabled'; readonly id: string; readonly enabled: boolean };

export type ExtensionsReply =
  | { readonly ok: true; readonly inventory: ExtensionInventory }
  | { readonly ok: false; readonly error: string };

const EXTENSION_ID = /^[a-z][a-z0-9-]{1,30}$/;

export function validateExtensionsCommand(value: unknown): value is ExtensionsCommand {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const command = value as Record<string, unknown>;
  const keys = Object.keys(command).sort().join(',');
  if (command.type === 'inventory') return keys === 'type';
  if (command.type === 'set-enabled') {
    return keys === 'enabled,id,type' && typeof command.id === 'string' && EXTENSION_ID.test(command.id)
      && typeof command.enabled === 'boolean';
  }
  return false;
}

// The window's check on what it is told (QGD-SEC-0006): only the fields
// Settings shows, each bounded and plain.
const plain = (value: unknown, limit: number) => typeof value === 'string' && value.length > 0 && value.length <= limit && !/[<>]/.test(value);

function isShownEntry(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.id === 'string' && EXTENSION_ID.test(entry.id) && plain(entry.name, 64)
    && typeof entry.enabled === 'boolean'
    && Array.isArray(entry.pages) && entry.pages.length <= 32 && entry.pages.every(page => plain(page, 48));
}

export function isExtensionsReply(value: unknown): value is ExtensionsReply {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const reply = value as Record<string, unknown>;
  if (reply.ok === false) return typeof reply.error === 'string';
  if (reply.ok !== true || typeof reply.inventory !== 'object' || reply.inventory === null) return false;
  const { extensions, refused } = reply.inventory as Record<string, unknown>;
  // What did not load, each with its words, so Settings can say so rather
  // than leave it missing (QGD-APP-0011).
  const isRefused = (entry: unknown) => typeof entry === 'object' && entry !== null && !Array.isArray(entry)
    && typeof (entry as Record<string, unknown>).source === 'string' && ((entry as Record<string, unknown>).source as string).length <= 1024
    && plain((entry as Record<string, unknown>).reason, 400);
  return Array.isArray(extensions) && extensions.length <= 64 && extensions.every(isShownEntry)
    && (refused === undefined || (Array.isArray(refused) && refused.length <= 64 && refused.every(isRefused)));
}
