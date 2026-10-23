// SPDX-License-Identifier: GPL-3.0-only
// Program and Entity, the two filters POTA's own park list starts with
// (KI7MT, 2026-10-23: "They know this data better than we do"). Each row's
// POTA locations are named by their program and entity from reference data
// (pota.places), carried in two columns the core does not draw (hidden).
import type { PotaPlace } from '../../../packages/extension-api/api-contract.js';
import type { TableFilter } from '../../../packages/extension-api/pages.js';

export interface Placed { readonly program: string; readonly entity: string }

// A row's program and entity cells, from its locations: each name once, as
// ", "-separated values a multiple filter reads. A place POTA's lists do not
// name is "—", which no filter offers.
export const UNPLACED = '—';
export function placeCells(locations: readonly string[], places: ReadonlyMap<string, PotaPlace>): Placed {
  const found = locations.flatMap(location => { const place = places.get(location); return place ? [place] : []; });
  return {
    program: [...new Set(found.map(place => place.program))].join(', ') || UNPLACED,
    entity: [...new Set(found.map(place => place.entity))].join(', ') || UNPLACED
  };
}

// The two filters over the two hidden columns, at `at` and `at + 1`: each a
// column's own values, alphabetically, at most a filter's hundred.
export function placeFilters(rows: readonly (readonly string[])[], at: number): TableFilter[] {
  const valuesAt = (column: number) => [...new Set(rows.flatMap(row => (row[column] ?? '').split(',').map(value => value.trim()).filter(value => value !== '' && value !== UNPLACED)))]
    .sort((a, b) => a.localeCompare(b)).slice(0, 100);
  const filters: TableFilter[] = [
    { column: at, label: 'Program', options: valuesAt(at), multiple: true },
    { column: at + 1, label: 'Entity', options: valuesAt(at + 1), multiple: true }
  ];
  return filters.filter(filter => (filter.options?.length ?? 0) > 0);
}

export const placesBy = (places: readonly PotaPlace[]) => new Map(places.map(place => [place.location, place]));

// The rows with their Program and Entity cells added after `rows`' own, and
// the two filters over them, which come first. Without both filters to offer,
// or with `atLeast` and fewer choices than that in each, the rows stay as
// they were: a column the core does not draw is only there for its filter.
// `start`, where each filter starts when it offers that choice: Near me's
// opens on where the active Location is (KI7MT, 2026-10-23).
export function withPlaces(rows: readonly (readonly string[])[], cells: readonly Placed[], atLeast = 1, start: Partial<Placed> = {}):
  { rows: string[][]; columns: string[]; hidden?: number; filters: TableFilter[] } {
  const plain = { rows: rows.map(row => [...row]), columns: [], filters: [] };
  if (rows.length === 0 || cells.length !== rows.length) return plain;
  const at = rows[0]!.length;
  const placed = rows.map((row, index) => [...row, cells[index]!.program, cells[index]!.entity]);
  const filters = placeFilters(placed, at);
  if (filters.length !== 2 || filters.every(filter => (filter.options?.length ?? 0) < atLeast)) return plain;
  const startAt = (filter: TableFilter, value: string | undefined): TableFilter =>
    value !== undefined && filter.options?.includes(value) ? { ...filter, start: value } : filter;
  return { rows: placed, columns: ['Program', 'Entity'], hidden: 2, filters: [startAt(filters[0]!, start.program), startAt(filters[1]!, start.entity)] };
}
