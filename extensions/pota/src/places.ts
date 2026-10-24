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

// The names in some cells, each once, alphabetically, "—" left out.
function valuesOf(cells: readonly string[]): string[] {
  return [...new Set(cells.flatMap(cell => cell.split(',').map(value => value.trim()).filter(value => value !== '' && value !== UNPLACED)))]
    .sort((a, b) => a.localeCompare(b));
}

export const placesBy = (places: readonly PotaPlace[]) => new Map(places.map(place => [place.location, place]));

// The rows with Program and Entity cells added after `rows`' own, each only
// where it offers two choices or more, and its filter, which comes first: a
// filter of one choice says nothing (KI7MT, 2026-10-23: "hide them when
// there's only one choice"). In CONUS both are hidden; near the Canadian
// border both show; in Scotland near England, Entity alone. A column the
// core does not draw is only there for its filter. `start`, where each
// starts when it offers that choice. `offered`, which of the two a page
// wants: Spots has Entity alone, the DXCC entity a chaser counts (KI7MT,
// 2026-10-23), since its programs and entities are nearly the same list.
export function withPlaces(rows: readonly (readonly string[])[], cells: readonly Placed[], start: Partial<Placed> = {},
  offered: readonly (keyof Placed)[] = ['program', 'entity']):
  { rows: string[][]; columns: string[]; hidden?: number; filters: TableFilter[] } {
  const plain = { rows: rows.map(row => [...row]), columns: [], filters: [] };
  if (rows.length === 0 || cells.length !== rows.length) return plain;
  const at = rows[0]!.length;
  const levels = (['program', 'entity'] as const).filter(level => offered.includes(level) && valuesOf(cells.map(cell => cell[level])).length >= 2);
  if (levels.length === 0) return plain;
  const placed = rows.map((row, index) => [...row, ...levels.map(level => cells[index]![level])]);
  const label = (level: keyof Placed) => (level === 'program' ? 'Program' : 'Entity');
  // Each column's own values, alphabetically, at most a filter's hundred.
  const filters = levels.map((level, index): TableFilter => {
    const options = valuesOf(cells.map(cell => cell[level])).slice(0, 100);
    const begin = start[level];
    return { column: at + index, label: label(level), options, multiple: true,
      ...(begin !== undefined && options.includes(begin) ? { start: begin } : {}) };
  });
  return { rows: placed, columns: levels.map(label), hidden: levels.length, filters };
}
