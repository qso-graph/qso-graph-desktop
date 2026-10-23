// SPDX-License-Identifier: GPL-3.0-only
// What an extension answers when the core asks for a page's data, and the
// check it passes before Home draws it (QGD-HOM-0002).
//
// The core draws every page. An extension returns data in one of these shapes
// and nothing else: no markup, no code, no colours of its own. That is what
// keeps extension code off Home, keeps every page looking like the rest of the
// application, and keeps a page cheap to draw on a Raspberry Pi 5.
//
// The shapes are versioned from the first extension (QGD-APP-0019): an
// extension written against version 1 must still draw when the core grows a
// version 2, so a new shape is added beside these, never by changing them.

// Version 2 added the table (KI7MT, 2026-10-20). The core draws both: data
// written against version 1 has no table and is drawn as it always was, and a
// table in data that says version 1 is refused, not guessed at.
//
// Version 3 let a figure carry the time it was observed (KI7MT, 2026-10-22):
// a page whose figures come from feeds that update at different times, as
// Conditions' daily solar flux and three-hourly K index do, says each one's
// time, which a single page time cannot.
//
// Version 4 let a section carry a heading (KI7MT, 2026-10-22): a page is a
// page now, not a card on Home, and Astro's is Sun, Twilight, Radio depths and
// Moon, each under its own name.
//
// Version 5 let a table come in groups, and a row give one value across its
// columns (Watson and KI7MT, 2026-10-22): Astro's Sun, Twilight, Radio depths
// and Moon were four tables, each sizing its own columns, so the times moved
// left and right down the page. One table in four groups lines them up by
// construction; and a distance or a phase has no clock, so it is said once
// rather than printed under UTC and again under Your clock.
//
// Version 6 added the map (KI7MT, 2026-10-22): a flat world map with the
// night greyed out and the terminator drawn, for Astro's grey line. The
// extension says where the sun is overhead and which places to mark; the core
// has the map and works out the night itself, so no extension draws a picture.
// It also let a table name up to three of its columns as filters, which the
// core draws as choices above it and applies at once, with no new question
// (KI7MT, 2026-10-23: Parks On the Air's band and mode), mark where on the
// page the core draws the page's fields, so an answer can sit just under the
// question (Astro's grey line, below its map), leave a section's heading out
// of the page's contents line (which the core draws at the top of a page of
// three or more headed parts), and say it may be
// sorted by any column, which the core does in the window when a heading is
// clicked: a column with a filter's options sorts in their order.
export const PAGE_DATA_VERSION = 6;
export const PAGE_DATA_VERSIONS: readonly number[] = [1, 2, 3, 4, 5, 6];

// Bounds on everything an extension can put on a page. A page fills the main
// pane, so these are a page's and not a card's; and bounded content is
// content the core can draw without trusting the sender (QGD-SEC-0006).
export const PAGE_LIMITS = {
  sections: 12,
  figures: 8,
  items: 40,
  label: 40,
  value: 32,
  unit: 12,
  title: 80,
  detail: 120,
  alert: 200,
  reason: 160,
  columns: 8,
  rows: 500,
  filters: 3,
  options: 100,
  groups: 40,
  marks: 4,
  // A cell holds ADIF's own text whole, up to the 1000 characters QG Storage
  // allows it (ADIF Lookup, KI7MT 2026-10-23): cut, ADIF would be reworded.
  cell: 1000,
  heading: 60
} as const;

export interface Figure {
  readonly label: string;
  readonly value: string;
  readonly unit?: string;
  // When this figure was observed, as ISO 8601 UTC, where it differs from
  // the page's. Version 3. The core writes it out.
  readonly observedAt?: string;
}

export interface Item {
  readonly title: string;
  readonly detail?: string;
}

// Any section may have a heading, from version 4.
export type Section = (
  // A few numbers with their names: solar flux, K index.
  | { readonly shape: 'figures'; readonly figures: readonly Figure[] }
  // A short list: spots, activations, nets.
  | { readonly shape: 'items'; readonly items: readonly Item[] }
  // Something happening now: a geomagnetic storm, a radio blackout.
  | { readonly shape: 'alert'; readonly level: 'info' | 'warning' | 'severe'; readonly text: string }
  // Rows under named columns: the bands with their outlook. Version 2. From
  // version 5 the rows may come in named groups instead, and a row of two
  // cells in a wider table gives one value across the columns after its first.
  | { readonly shape: 'table'; readonly columns: readonly string[]; readonly rows: readonly Row[]; readonly filters?: readonly TableFilter[]; readonly sortable?: boolean; readonly sortedBy?: TableSort }
  | { readonly shape: 'table'; readonly columns: readonly string[]; readonly groups: readonly TableGroup[]; readonly filters?: readonly TableFilter[]; readonly sortable?: boolean; readonly sortedBy?: TableSort }
  // The world, with the night greyed out from where the sun is overhead, and
  // up to four places marked. Version 6. Optionally the moon, where it is
  // overhead, and a twilight band from the horizon down to a depth, as the
  // grey line: the extension says which depth it means.
  | { readonly shape: 'map'; readonly sun: Place; readonly moon?: Place; readonly twilight?: number; readonly marks: readonly Mark[] }
  // Where the core draws the page's own fields (its manifest's inputs), once
  // at most; without it they are at the top. Version 6.
  | { readonly shape: 'fields' }
  // A sentence or two as plain text, with no box: a note that is not an
  // alert (KI7MT, 2026-10-23). Version 6.
  | { readonly shape: 'text'; readonly text: string }
) & { readonly heading?: string; readonly contents?: false };

export type Row = readonly string[];

// The order the extension sent a sortable table's rows in: by this column,
// this way. The core shows it as the table's sort from the start, and sorts
// that column by the order sent rather than by its text, so a time of day
// that crosses midnight still sorts newest first (KI7MT, 2026-10-23).
export interface TableSort {
  readonly column: number;
  readonly direction: 'ascending' | 'descending';
}

// A column the operator can narrow the table by: its index, what the choice
// is called, and the values to offer in the order to offer them. Without
// options the core offers the column's own values, in the order they first
// appear. Version 6.
export interface TableFilter {
  readonly column: number;
  readonly label: string;
  readonly options?: readonly string[];
}

// A place on the earth, in degrees: north and east positive.
export interface Place {
  readonly latitude: number;
  readonly longitude: number;
}

export interface Mark extends Place {
  readonly label: string;
}

export interface TableGroup {
  readonly heading: string;
  readonly rows: readonly Row[];
}

export interface PageData {
  readonly version: number;
  // When the source observed what the page shows, as ISO 8601 UTC. The core
  // says how old it is; an extension cannot claim its data is fresh.
  readonly observedAt: string;
  readonly sections: readonly Section[];
}

// A page answer: its data, or why there is none, in words (QGD-HOM-0006).
export type PageAnswer =
  | { readonly ok: true; readonly data: PageData }
  | { readonly ok: false; readonly reason: string };

export class PageError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function only(value: Record<string, unknown>, keys: readonly string[], where: string): void {
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) throw new PageError(`${where} has a field pages do not have: "${key}".`);
  }
}

// Text the core will draw: a bounded string with no markup in it. Svelte
// would escape markup anyway; refusing it says the extension sent something
// a page cannot hold, which is the finding (P8-shapes).
function text(value: unknown, limit: number, where: string): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > limit) {
    throw new PageError(`${where} is not text of at most ${limit} characters.`);
  }
  if (/[<>]/.test(value)) throw new PageError(`${where} holds markup, which a page does not draw.`);
  return value;
}

// Three flat patterns rather than one with nested optional groups, which the
// security lint reads as able to backtrack (QGD-SEC-0013).
const ISO_UTC = [
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$/,
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/,
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
];

// Every index, holes included: .map() skips a hole in a sparse array, so a
// list with a gap in it would pass with nothing in the gap checked.
function each<T>(list: readonly unknown[], where: string, check: (value: unknown, at: number) => T): T[] {
  const out: T[] = [];
  for (let at = 0; at < list.length; at++) {
    if (!Object.hasOwn(list, at)) throw new PageError(`${where} has a gap at position ${at + 1}.`);
    out.push(check(list[at], at));
  }
  return out;
}

// A real calendar time. Date.parse rolls 30 February over to 2 March, so
// the parsed time is written back out and compared with what was sent.
function realTime(value: string): boolean {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return false;
  const written = new Date(parsed).toISOString();
  return written.slice(0, 16) === value.slice(0, 16) && (value.length < 20 || written.slice(0, 19) === value.slice(0, 19));
}

// A latitude and longitude, both in range: a map refuses a place off it
// rather than wrapping it round to somewhere the extension never meant.
function place(value: unknown, where: string): Place {
  if (!isRecord(value)) throw new PageError(`${where} is not a place.`);
  const { latitude, longitude } = value;
  if (typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90
    || typeof longitude !== 'number' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new PageError(`${where} is not a latitude from −90 to 90 and a longitude from −180 to 180.`);
  }
  return { latitude, longitude };
}

function isUtcTime(value: unknown): value is string {
  return typeof value === 'string' && ISO_UTC.some(pattern => pattern.test(value)) && realTime(value);
}

// A section's heading, checked and taken off, then the section itself as its
// shape has it.
function section(value: unknown, at: number, version: number): Section {
  const where = `Section ${at + 1}`;
  if (!isRecord(value)) throw new PageError(`${where} is not an object.`);
  const { heading, contents, ...rest } = value;
  // Left out of the page's contents line: said only of a heading, and only
  // as false, since every heading is in it otherwise (version 6).
  if (Object.hasOwn(value, 'contents')) {
    if (version < 6) throw new PageError(`${where} says whether it is in the page's contents, which page data version ${version} does not have.`);
    if (contents !== false || !Object.hasOwn(value, 'heading')) throw new PageError(`${where}'s contents is not false on a section with a heading.`);
  }
  if (!Object.hasOwn(value, 'heading')) return shape(rest, where, version);
  if (version < 4) throw new PageError(`${where} has a heading, which page data version ${version} does not have.`);
  return {
    ...shape(rest, where, version), heading: text(heading, PAGE_LIMITS.heading, `${where}'s heading`),
    ...(contents === false ? { contents: false as const } : {})
  };
}

function shape(value: Record<string, unknown>, where: string, version: number): Section {
  if (value.shape === 'figures') {
    only(value, ['shape', 'figures'], where);
    if (!Array.isArray(value.figures) || value.figures.length === 0 || value.figures.length > PAGE_LIMITS.figures) {
      throw new PageError(`${where} has no figures, or more than ${PAGE_LIMITS.figures}.`);
    }
    return {
      shape: 'figures',
      figures: each(value.figures, where, (figure: unknown, i: number): Figure => {
        const name = `${where}, figure ${i + 1}`;
        if (!isRecord(figure)) throw new PageError(`${name} is not an object.`);
        only(figure, ['label', 'value', 'unit', 'observedAt'], name);
        if (figure.observedAt !== undefined) {
          if (version < 3) throw new PageError(`${name} has a time, which page data version ${version} does not have.`);
          if (!isUtcTime(figure.observedAt)) throw new PageError(`${name}'s time is not an ISO 8601 UTC time.`);
        }
        return {
          label: text(figure.label, PAGE_LIMITS.label, `${name}'s label`),
          value: text(figure.value, PAGE_LIMITS.value, `${name}'s value`),
          ...(figure.unit !== undefined ? { unit: text(figure.unit, PAGE_LIMITS.unit, `${name}'s unit`) } : {}),
          ...(figure.observedAt !== undefined ? { observedAt: figure.observedAt as string } : {})
        };
      })
    };
  }
  if (value.shape === 'items') {
    only(value, ['shape', 'items'], where);
    if (!Array.isArray(value.items) || value.items.length > PAGE_LIMITS.items) {
      throw new PageError(`${where} has items as something other than a list of at most ${PAGE_LIMITS.items}.`);
    }
    return {
      shape: 'items',
      items: each(value.items, where, (item: unknown, i: number): Item => {
        const name = `${where}, item ${i + 1}`;
        if (!isRecord(item)) throw new PageError(`${name} is not an object.`);
        only(item, ['title', 'detail'], name);
        return {
          title: text(item.title, PAGE_LIMITS.title, `${name}'s title`),
          ...(item.detail !== undefined ? { detail: text(item.detail, PAGE_LIMITS.detail, `${name}'s detail`) } : {})
        };
      })
    };
  }
  if (value.shape === 'alert') {
    only(value, ['shape', 'level', 'text'], where);
    if (value.level !== 'info' && value.level !== 'warning' && value.level !== 'severe') {
      throw new PageError(`${where} is an alert with no level of info, warning or severe.`);
    }
    return { shape: 'alert', level: value.level, text: text(value.text, PAGE_LIMITS.alert, `${where}'s text`) };
  }
  if (value.shape === 'table') {
    if (version < 2) throw new PageError(`${where} is a table, which page data version ${version} does not have.`);
    const grouped = Object.hasOwn(value, 'groups');
    if (grouped && version < 5) throw new PageError(`${where} has groups, which page data version ${version} does not have.`);
    only(value, ['shape', 'columns', grouped ? 'groups' : 'rows', 'filters', 'sortable', 'sortedBy'], where);
    if (value.sortable !== undefined) {
      if (version < 6) throw new PageError(`${where} is sortable, which page data version ${version} does not have.`);
      if (value.sortable !== true) throw new PageError(`${where}'s sortable is not true.`);
    }
    if (!Array.isArray(value.columns) || value.columns.length === 0 || value.columns.length > PAGE_LIMITS.columns) {
      throw new PageError(`${where} has no columns, or more than ${PAGE_LIMITS.columns}.`);
    }
    const columns = each(value.columns, where, (column: unknown, i: number) =>
      text(column, PAGE_LIMITS.label, `${where}, column ${i + 1}`));
    const filtered = Object.hasOwn(value, 'filters');
    if (filtered && version < 6) throw new PageError(`${where} has filters, which page data version ${version} does not have.`);
    if (filtered && (!Array.isArray(value.filters) || value.filters.length === 0 || value.filters.length > PAGE_LIMITS.filters)) {
      throw new PageError(`${where} has no filters, or more than ${PAGE_LIMITS.filters}.`);
    }
    const filters = filtered ? each(value.filters as unknown[], where, (filter: unknown, f: number): TableFilter => {
      const name = `${where}, filter ${f + 1}`;
      if (!isRecord(filter)) throw new PageError(`${name} is not an object.`);
      only(filter, ['column', 'label', 'options'], name);
      if (typeof filter.column !== 'number' || !Number.isInteger(filter.column) || filter.column < 0 || filter.column >= columns.length) {
        throw new PageError(`${name} does not name one of the table's columns.`);
      }
      const label = text(filter.label, PAGE_LIMITS.label, `${name}'s label`);
      if (filter.options === undefined) return { column: filter.column, label };
      if (!Array.isArray(filter.options) || filter.options.length === 0 || filter.options.length > PAGE_LIMITS.options) {
        throw new PageError(`${name} has no options, or more than ${PAGE_LIMITS.options}.`);
      }
      const options = each(filter.options, name, (option: unknown, o: number) => text(option, PAGE_LIMITS.cell, `${name}, option ${o + 1}`));
      if (new Set(options).size !== options.length) throw new PageError(`${name} offers the same option twice.`);
      return { column: filter.column, label, options };
    }) : undefined;
    if (filters && new Set(filters.map(filter => filter.column)).size !== filters.length) {
      throw new PageError(`${where} filters one column twice.`);
    }
    let sortedBy: TableSort | undefined;
    if (value.sortedBy !== undefined) {
      if (value.sortable !== true) throw new PageError(`${where} says how it is sorted but is not sortable.`);
      const sort = value.sortedBy;
      if (!isRecord(sort)) throw new PageError(`${where}'s sortedBy is not an object.`);
      only(sort, ['column', 'direction'], `${where}'s sortedBy`);
      if (typeof sort.column !== 'number' || !Number.isInteger(sort.column) || sort.column < 0 || sort.column >= columns.length
        || (sort.direction !== 'ascending' && sort.direction !== 'descending')) {
        throw new PageError(`${where}'s sortedBy does not name a column and ascending or descending.`);
      }
      sortedBy = { column: sort.column, direction: sort.direction };
    }
    const withFilters = { ...(filters ? { filters } : {}), ...(value.sortable === true ? { sortable: true as const } : {}), ...(sortedBy ? { sortedBy } : {}) };
    const rowsOf = (list: unknown, name: string, room: number): Row[] => {
      if (!Array.isArray(list) || list.length > room) {
        throw new PageError(`${name} has rows as something other than a list of at most ${PAGE_LIMITS.rows} in the table.`);
      }
      return each(list, name, (row: unknown, i: number) => {
        const at = `${name}, row ${i + 1}`;
        // A row is exactly as wide as the columns: a short or long one would
        // put a value under the wrong heading. From version 5 a row of two
        // cells in a wider table is its name and one value across the rest,
        // which is said, not guessed: no other width is drawn.
        const spans = version >= 5 && columns.length > 2 && Array.isArray(row) && row.length === 2;
        if (!Array.isArray(row) || (row.length !== columns.length && !spans)) throw new PageError(`${at} does not have ${columns.length} cells.`);
        return each(row, at, (cell: unknown, c: number) => text(cell, PAGE_LIMITS.cell, `${at}, cell ${c + 1}`));
      });
    };
    if (!grouped) return { shape: 'table', columns, rows: rowsOf(value.rows, where, PAGE_LIMITS.rows), ...withFilters };
    if (!Array.isArray(value.groups) || value.groups.length === 0 || value.groups.length > PAGE_LIMITS.groups) {
      throw new PageError(`${where} has no groups, or more than ${PAGE_LIMITS.groups}.`);
    }
    // The bound on rows is the table's, however they are grouped.
    let room: number = PAGE_LIMITS.rows;
    const groups = each(value.groups, where, (group: unknown, g: number) => {
      const name = `${where}, group ${g + 1}`;
      if (!isRecord(group)) throw new PageError(`${name} is not a group.`);
      only(group, ['heading', 'rows'], name);
      const rows = rowsOf(group.rows, name, room);
      room -= rows.length;
      return { heading: text(group.heading, PAGE_LIMITS.heading, `${name}'s heading`), rows };
    });
    return { shape: 'table', columns, groups, ...withFilters };
  }
  if (value.shape === 'text') {
    if (version < 6) throw new PageError(`${where} is text, which page data version ${version} does not have.`);
    only(value, ['shape', 'text'], where);
    return { shape: 'text', text: text(value.text, PAGE_LIMITS.alert, `${where}'s text`) };
  }
  if (value.shape === 'fields') {
    if (version < 6) throw new PageError(`${where} places the page's fields, which page data version ${version} does not have.`);
    only(value, ['shape'], where);
    return { shape: 'fields' };
  }
  if (value.shape === 'map') {
    if (version < 6) throw new PageError(`${where} is a map, which page data version ${version} does not have.`);
    only(value, ['shape', 'sun', 'moon', 'twilight', 'marks'], where);
    // A depth below the horizon, no deeper than astronomical twilight's: past
    // that it is night, and a band would say otherwise.
    if (value.twilight !== undefined && (typeof value.twilight !== 'number' || !Number.isFinite(value.twilight)
      || value.twilight >= 0 || value.twilight < -18)) {
      throw new PageError(`${where}'s twilight is not a depth below the horizon, to −18°.`);
    }
    if (!Array.isArray(value.marks) || value.marks.length > PAGE_LIMITS.marks) {
      throw new PageError(`${where} has marks as something other than a list of at most ${PAGE_LIMITS.marks}.`);
    }
    const marks = each(value.marks, where, (mark: unknown, i: number): Mark => {
      const name = `${where}, mark ${i + 1}`;
      if (!isRecord(mark)) throw new PageError(`${name} is not an object.`);
      only(mark, ['label', 'latitude', 'longitude'], name);
      return { label: text(mark.label, PAGE_LIMITS.label, `${name}'s label`), ...place(mark, name) };
    });
    if (isRecord(value.sun)) only(value.sun, ['latitude', 'longitude'], `${where}'s sun`);
    if (isRecord(value.moon)) only(value.moon, ['latitude', 'longitude'], `${where}'s moon`);
    return {
      shape: 'map', sun: place(value.sun, `${where}'s sun`),
      ...(value.moon !== undefined ? { moon: place(value.moon, `${where}'s moon`) } : {}),
      ...(value.twilight !== undefined ? { twilight: value.twilight as number } : {}),
      marks
    };
  }
  throw new PageError(`${where} is not a figures, items, alert, text, table, map or fields section.`);
}

// The whole answer, checked before anything of it is drawn. Refused rather
// than coerced (QGD-SEC-0006): a page that cannot be shown says so.
export function validatePageAnswer(value: unknown): PageAnswer {
  if (!isRecord(value)) throw new PageError('A page answer is not an object.');
  if (value.ok === false) {
    only(value, ['ok', 'reason'], 'A page answer');
    return { ok: false, reason: text(value.reason, PAGE_LIMITS.reason, 'The reason') };
  }
  if (value.ok !== true) throw new PageError('A page answer says neither ok nor not.');
  only(value, ['ok', 'data'], 'A page answer');
  const data = value.data;
  if (!isRecord(data)) throw new PageError('A page answer has no data.');
  only(data, ['version', 'observedAt', 'sections'], 'Page data');
  if (typeof data.version !== 'number' || !PAGE_DATA_VERSIONS.includes(data.version)) {
    throw new PageError(`Page data is version ${String(data.version)}; this core draws versions ${PAGE_DATA_VERSIONS.slice(0, -1).join(', ')} and ${PAGE_DATA_VERSIONS.at(-1)}.`);
  }
  const version = data.version;
  if (!isUtcTime(data.observedAt)) {
    throw new PageError('Page data does not say, as an ISO 8601 UTC time, when it was observed.');
  }
  if (!Array.isArray(data.sections) || data.sections.length === 0 || data.sections.length > PAGE_LIMITS.sections) {
    throw new PageError(`Page data has no sections, or more than ${PAGE_LIMITS.sections}.`);
  }
  const sections = each(data.sections, 'Page data', (entry, i) => section(entry, i, version));
  if (sections.filter(entry => entry.shape === 'fields').length > 1) throw new PageError('Page data places the page\'s fields more than once.');
  return { ok: true, data: { version, observedAt: data.observedAt, sections } };
}
