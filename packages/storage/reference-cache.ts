// SPDX-License-Identifier: GPL-3.0-only
// The last good lists of each resource that is a set of lists, POTA's and
// SOTA's, kept as files (QGD-REF-0010, QGD-REF-0018).
//
// reference.sqlite is derived, so it must be rebuildable without the network,
// and POTA's lists are not pinned by checksum. So each list's last good body is
// kept here with a record of where it came from, and a rebuild reads these and
// never invents a fetch time.
//
// The layout, under <userData>/reference/<resource>/ (pota/, sota/), one
// folder each, so pruning one resource can never remove another's bodies:
//   <sha256>.body  a list exactly as it arrived, named by its own SHA-256
//   <list>.json    the record: URL, ETag, Last-Modified, fetch time, row
//                  count, and the SHA-256 of the body it describes
//
// The order is what makes it safe. The body is written first, under a name
// nothing points to yet. Then the record is written beside its final name and
// renamed over it. That one rename publishes body and provenance together. A
// crash before it leaves the previous record pointing at the previous body,
// which is still there, because bodies are removed only by prune(), after a
// build that no longer needs them.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { StorageFailure, failure } from './errors.js';

export const POTA_LISTS = ['parks', 'programs', 'locations'] as const;
export type PotaList = (typeof POTA_LISTS)[number];
export const SOTA_LISTS = ['summits'] as const;
export type SotaList = (typeof SOTA_LISTS)[number];

// Each resource that is a set of lists, and its lists.
export const LISTED = { pota: POTA_LISTS, sota: SOTA_LISTS } as const;
export type ListedResource = keyof typeof LISTED;
export type AnyList = PotaList | SotaList;

export interface PotaRecord {
  list: AnyList;
  url: string;
  what: string;
  etag: string | null;
  lastModified: string | null;
  fetchedAt: string;   // ISO-8601 UTC, the time POTA answered with this body
  rowCount: number;
  sha256: string;
}

const SHA256 = /^[0-9a-f]{64}$/;

export function listDirectory(referenceCache: string, resource: ListedResource): string {
  return join(referenceCache, resource);
}
export function potaDirectory(referenceCache: string): string {
  return listDirectory(referenceCache, 'pota');
}

function digest(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function isRecord(value: unknown, list: AnyList): value is PotaRecord {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  // Absent as well as null: a server that sends no ETag or Last-Modified
  // (POTA's API sends neither) left the key out of records written before
  // commit() wrote null, and refusing those fetched the list on every start.
  const optional = (v: unknown) => v === undefined || v === null || typeof v === 'string';
  return r.list === list && typeof r.url === 'string' && typeof r.what === 'string'
    && optional(r.etag) && optional(r.lastModified)
    && typeof r.fetchedAt === 'string' && !Number.isNaN(Date.parse(r.fetchedAt))
    && Number.isInteger(r.rowCount) && (r.rowCount as number) >= 0
    && typeof r.sha256 === 'string' && SHA256.test(r.sha256);
}

// The record for a list, or undefined when there is none or it cannot be
// trusted. A record that does not parse is treated as absent: the list is then
// fetched again rather than built from something unreadable.
export function readRecord(referenceCache: string, list: AnyList, resource: ListedResource = 'pota'): PotaRecord | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(join(listDirectory(referenceCache, resource), `${list}.json`), 'utf8'));
  } catch {
    return undefined;
  }
  return isRecord(parsed, list) ? parsed : undefined;
}

// The body a record describes, checked against the record's SHA-256 before it
// is used. A body that does not match is refused, not built from.
export function readBody(referenceCache: string, record: PotaRecord, resource: ListedResource = 'pota'): string {
  let body: string;
  try {
    body = readFileSync(join(listDirectory(referenceCache, resource), `${record.sha256}.body`), 'utf8');
  } catch (error) {
    throw failure(error, 'build');
  }
  if (digest(body) !== record.sha256) throw new StorageFailure({ kind: 'build' });
  return body;
}

export interface CommitHooks {
  // For the crash control in tests: runs after the body is written and before
  // the record is renamed into place.
  beforeRecordRename?: () => void;
}

export function commit(
  referenceCache: string,
  meta: Omit<PotaRecord, 'sha256'>,
  body: string,
  hooks: CommitHooks = {},
  resource: ListedResource = 'pota'
): PotaRecord {
  const directory = listDirectory(referenceCache, resource);
  const record: PotaRecord = { ...meta, etag: meta.etag ?? null, lastModified: meta.lastModified ?? null, sha256: digest(body) };
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const bodyPath = join(directory, `${record.sha256}.body`);
    // Written beside its name and moved, so a body is never seen half-written.
    writeFileSync(`${bodyPath}.part`, body);
    renameSync(`${bodyPath}.part`, bodyPath);
    hooks.beforeRecordRename?.();
    const recordPath = join(directory, `${meta.list}.json`);
    writeFileSync(`${recordPath}.part`, JSON.stringify(record));
    renameSync(`${recordPath}.part`, recordPath);
  } catch (error) {
    throw failure(error, 'build');
  }
  return record;
}

// After a successful build: every body no record points to is removed, so a
// list that changes daily does not keep every day it ever had (QGD-REF-0010).
// Leftover .part files go too.
export function prune(referenceCache: string, resource: ListedResource = 'pota'): number {
  const directory = listDirectory(referenceCache, resource);
  const wanted = new Set(LISTED[resource].map((list) => readRecord(referenceCache, list, resource)?.sha256).filter(Boolean));
  let removed = 0;
  let names: string[];
  try { names = readdirSync(directory); } catch { return 0; }
  for (const name of names) {
    const body = /^([0-9a-f]{64})\.body$/.exec(name);
    if ((body && !wanted.has(body[1])) || name.endsWith('.part')) {
      try { rmSync(join(directory, name), { force: true }); removed += 1; } catch { /* tried again next build */ }
    }
  }
  return removed;
}
