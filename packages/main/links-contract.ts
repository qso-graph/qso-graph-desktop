// SPDX-License-Identifier: GPL-3.0-only
// The pages the application may open in the operator's browser (QGD-SEC-0009),
// from data/links.json and nowhere else. Pure, so the allowlist runs under unit
// tests: the window names a page, never a URL, and the URL is built here from
// the register and a reference checked against its form.
import { isPotaReference, isSummitReference } from '../storage/station-contract.js';

export const LINKS_CHANNEL = 'links:open';

export const DOCUMENTS = ['privacy', 'security', 'attributions', 'contributors', 'contributing', 'license'] as const;
export type DocumentName = typeof DOCUMENTS[number];
export const REFERENCE_KINDS = ['pota', 'sota'] as const;
export type ReferenceKind = typeof REFERENCE_KINDS[number];
// The programs and standards this product speaks, each to its own home page
// (KI7MT, 2026-10-22: Home's welcome names them).
// `releases` is where to get the application (KI7MT, 2026-10-22): the
// Releases page, now that the Preview and releases are published there.
export const SITES = ['adif', 'pota', 'sota', 'iota', 'releases'] as const;
export type SiteName = typeof SITES[number];

export type LinkCommand =
  | { type: 'document'; name: DocumentName }
  | { type: 'reference'; kind: ReferenceKind; reference: string }
  | { type: 'site'; name: SiteName }
  // A newer version's release page, for a build that cannot install it
  // itself (QGD-FRM-0019). Main's only: the window asks the updater, which
  // knows the version, and validateLinkCommand does not accept it.
  | { type: 'release'; version: string };

export interface LinkRegister {
  documents: { base: string; pages: Record<DocumentName, string> };
  references: Record<ReferenceKind, string>;
  sites: Record<SiteName, string>;
  release: string;
}

export class LinkRegisterError extends Error {}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// https and nothing else, with no credentials and no fragment the register
// did not write (QGD-SEC-0009).
function https(value: unknown, what: string): string {
  if (typeof value !== 'string' || value.length > 200) throw new LinkRegisterError(`${what} is not a short string`);
  let url: URL;
  try { url = new URL(value.replace('{reference}', 'X')); } catch { throw new LinkRegisterError(`${what} is not a URL`); }
  if (url.protocol !== 'https:' || url.username || url.password) throw new LinkRegisterError(`${what} is not a plain https:// URL`);
  return value;
}

export function validateLinkRegister(value: unknown): LinkRegister {
  if (!record(value) || !record(value.documents) || !record(value.documents.pages) || !record(value.references) || !record(value.sites)) {
    throw new LinkRegisterError('the link register is not shaped as expected');
  }
  const base = https(value.documents.base, 'documents.base');
  if (!base.endsWith('/')) throw new LinkRegisterError('documents.base does not end in /');
  const pages = {} as Record<DocumentName, string>;
  for (const name of DOCUMENTS) {
    const page = value.documents.pages[name];
    if (typeof page !== 'string' || !/^[A-Z][A-Za-z-]*(\.md)?$/.test(page)) throw new LinkRegisterError(`documents.pages.${name} is not a file name`);
    pages[name] = page;
  }
  const references = {} as Record<ReferenceKind, string>;
  for (const kind of REFERENCE_KINDS) {
    const template = https(value.references[kind], `references.${kind}`);
    if (template.split('{reference}').length !== 2) throw new LinkRegisterError(`references.${kind} does not hold {reference} once`);
    references[kind] = template;
  }
  const sites = {} as Record<SiteName, string>;
  for (const name of SITES) sites[name] = https(value.sites[name], `sites.${name}`);
  if (typeof value.release !== 'string' || value.release.split('{version}').length !== 2) throw new LinkRegisterError('release does not hold {version} once');
  https(value.release.replace('{version}', '0.0.0'), 'release');
  return { documents: { base, pages }, references, sites, release: value.release };
}

export function validateLinkCommand(value: unknown): value is LinkCommand {
  if (!record(value)) return false;
  const keys = Object.keys(value);
  if (value.type === 'document') {
    return keys.length === 2 && (DOCUMENTS as readonly unknown[]).includes(value.name);
  }
  if (value.type === 'site') return keys.length === 2 && (SITES as readonly unknown[]).includes(value.name);
  if (value.type === 'reference') {
    if (keys.length !== 3) return false;
    if (value.kind === 'pota') return isPotaReference(value.reference);
    if (value.kind === 'sota') return isSummitReference(value.reference);
  }
  return false;
}

// The page for a command. A reference is checked against its form, and the
// form holds nothing a URL would read as structure, beyond SOTA's one "/".
export function linkFor(register: LinkRegister, command: LinkCommand): string {
  if (command.type === 'site') return register.sites[command.name];
  if (command.type === 'document') return register.documents.base + register.documents.pages[command.name];
  if (command.type === 'release') {
    return /^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(command.version) ? register.release.replace('{version}', command.version) : '';
  }
  return register.references[command.kind].replace('{reference}', command.reference);
}
