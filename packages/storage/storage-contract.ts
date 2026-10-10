// SPDX-License-Identifier: GPL-3.0-only
// What the renderer may ask about storage, and what it is told (QGD-ENG-0006,
// QGD-FRM-0012).
//
// The renderer asks for status, and nothing else: there is no engine to start
// or stop. Status also arrives unasked, pushed by the broker whenever it
// changes, so the screen is never polling and never stale (QGD-ENG-0006).
// QGD-SEC-0006 applies as at every boundary: checked on arrival, refused rather
// than coerced.
export const STORAGE_STATES = ['starting', 'ready', 'failed', 'unavailable'] as const;
export type StorageState = (typeof STORAGE_STATES)[number];

export const STORAGE_CHANNEL = 'storage:request';
export const STORAGE_STATUS_CHANNEL = 'storage:status';

export interface DatasetSummary {
  state: 'loaded' | 'not loaded';
  fetchedAt?: string;
  rows?: number;
  version?: string;
}

export interface ReferenceSummary {
  adif: DatasetSummary;
  parks: DatasetSummary;
  programs: DatasetSummary;
  locations: DatasetSummary;
  // When the last refresh ran, and whether a build is running now.
  refreshing: boolean;
}

export interface StorageStatus {
  state: StorageState;
  // The operator's own folder, where the stores are (QGD-FRM-0012). Shown so
  // a support conversation can name it; never something the renderer acts on.
  folder?: string;
  // Bytes on disk: state.sqlite with its WAL, and reference.sqlite (null when
  // there is none yet).
  sizes?: { state: number; reference: number | null };
  reference?: ReferenceSummary;
  // In words a person can act on. Never a value, a path or a stack (QGD-ENG-0016).
  reason?: string;
}

export type StorageCommand = { type: 'status' };
export type StorageReply = { ok: true; status: StorageStatus } | { ok: false; error: string };

const DATASETS = ['adif', 'parks', 'programs', 'locations'] as const;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function only(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function isDataset(value: unknown): value is DatasetSummary {
  if (!record(value) || !only(value, ['state', 'fetchedAt', 'rows', 'version'])) return false;
  if (value.state !== 'loaded' && value.state !== 'not loaded') return false;
  if (value.fetchedAt !== undefined && typeof value.fetchedAt !== 'string') return false;
  if (value.rows !== undefined && !Number.isInteger(value.rows)) return false;
  return value.version === undefined || typeof value.version === 'string';
}

export function isStorageStatus(value: unknown): value is StorageStatus {
  if (!record(value) || !only(value, ['state', 'folder', 'sizes', 'reference', 'reason'])) return false;
  if (!(STORAGE_STATES as readonly unknown[]).includes(value.state)) return false;
  if (value.folder !== undefined && typeof value.folder !== 'string') return false;
  if (value.reason !== undefined && typeof value.reason !== 'string') return false;
  if (value.sizes !== undefined) {
    const sizes = value.sizes;
    if (!record(sizes) || !only(sizes, ['state', 'reference']) || !Number.isInteger(sizes.state)
        || !(sizes.reference === null || Number.isInteger(sizes.reference))) return false;
  }
  if (value.reference !== undefined) {
    const reference = value.reference;
    if (!record(reference) || !only(reference, [...DATASETS, 'refreshing'])) return false;
    if (typeof reference.refreshing !== 'boolean') return false;
    if (!DATASETS.every((name) => isDataset(reference[name]))) return false;
  }
  return true;
}

// A reply from the storage process, checked whole before it is read or passed
// on (QGD-SEC-0006). Null, an array, a missing field or an extra one: refused.
export function isStorageReply(value: unknown): value is StorageReply {
  if (!record(value)) return false;
  if (value.ok === true) return only(value, ['ok', 'status']) && isStorageStatus(value.status);
  if (value.ok === false) return only(value, ['ok', 'error']) && typeof value.error === 'string';
  return false;
}

// Exactly { type: 'status' }. A command carrying a path would be the renderer
// choosing where the stores are.
export function validateStorageCommand(value: unknown): value is StorageCommand {
  return record(value) && value.type === 'status' && Object.keys(value).length === 1;
}

export function referenceLoaded(status: StorageStatus | undefined): boolean | undefined {
  if (!status?.reference) return undefined;
  return DATASETS.some((name) => status.reference![name].state === 'loaded');
}
