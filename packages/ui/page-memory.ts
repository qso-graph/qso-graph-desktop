// SPDX-License-Identifier: GPL-3.0-only
// What a page's tables were filtered and sorted by, kept for the session by
// the page's key, so leaving a page and coming back finds it as it was
// (KI7MT, 2026-10-23). In memory only: a new start begins from each filter's
// own start.
import type { TableSort } from './page-shapes.js';

export interface PageMemory {
  readonly chosen: Record<number, Record<number, string>>;
  readonly sorts: Record<number, TableSort>;
}

const memory = new Map<string, PageMemory>();

export function recall(key: string | undefined): PageMemory | undefined {
  return key === undefined ? undefined : memory.get(key);
}

export function remember(key: string | undefined, value: PageMemory): void {
  if (key !== undefined) memory.set(key, value);
}
