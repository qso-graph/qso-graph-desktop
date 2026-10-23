// SPDX-License-Identifier: GPL-3.0-only
// The shapes a Home page is drawn from (QGD-HOM-0002), as the ui package sees
// them. Declared here rather than imported: ui depends on nothing
// (QGD-REP-0006), and these are checked against the extension API's own
// types where the renderer hands them over.
// observedAt: when this figure was observed, where it differs from the page (page data version 3).
export interface Figure { readonly label: string; readonly value: string; readonly unit?: string; readonly observedAt?: string }
export interface Item { readonly title: string; readonly detail?: string }
// Any section may carry a heading (page data version 4).
export type Section = (
  | { readonly shape: 'figures'; readonly figures: readonly Figure[] }
  | { readonly shape: 'items'; readonly items: readonly Item[] }
  | { readonly shape: 'alert'; readonly level: 'info' | 'warning' | 'severe'; readonly text: string }
  | { readonly shape: 'table'; readonly columns: readonly string[]; readonly rows: readonly (readonly string[])[]; readonly filters?: readonly TableFilter[]; readonly sortable?: boolean; readonly sortedBy?: TableSort; readonly hidden?: number }
  // In named groups, and a two-cell row across a wider table (version 5).
  | { readonly shape: 'table'; readonly columns: readonly string[]; readonly groups: readonly TableGroup[]; readonly filters?: readonly TableFilter[]; readonly sortable?: boolean; readonly sortedBy?: TableSort; readonly hidden?: number }
  // The world with the night greyed out, and places marked (version 6).
  | { readonly shape: 'map'; readonly sun: Place; readonly moon?: Place; readonly twilight?: number; readonly marks: readonly Mark[] }
  // Where the page's own fields are drawn (version 6).
  | { readonly shape: 'fields' }
  // Plain text, no box (version 6).
  | { readonly shape: 'text'; readonly text: string }
) & { readonly heading?: string; readonly contents?: false };

// The page's contents line: each section heading not left out of it, and
// each table group's, in order, with the id of the place it goes to. Drawn
// only when there are three or more, so a short page is not given one.
export interface ContentsEntry { readonly id: string; readonly label: string }
export function pageContents(sections: readonly Section[]): ContentsEntry[] {
  const entries: ContentsEntry[] = [];
  sections.forEach((section, at) => {
    // A section left out of the contents is left out with its groups: ADIF
    // Lookup's forty matches would otherwise be forty links (2026-10-23).
    if (section.contents === false) return;
    if (section.heading) entries.push({ id: `page-part-${at}`, label: section.heading });
    if (section.shape === 'table' && 'groups' in section) {
      section.groups.forEach((group, g) => entries.push({ id: `page-part-${at}-${g}`, label: group.heading }));
    }
  });
  return entries.length >= 3 ? entries : [];
}
export interface Place { readonly latitude: number; readonly longitude: number }
export interface Mark extends Place { readonly label: string }
// A column to narrow the table by (version 6).
export interface TableFilter {
  readonly column: number; readonly label: string; readonly options?: readonly string[]; readonly multiple?: true;
  readonly named?: readonly { readonly label: string; readonly values: readonly string[] }[]; readonly start?: string;
  // "Within 50 km": rows whose number is at most the bound.
  readonly upTo?: readonly { readonly label: string; readonly value: number }[];
}
export interface TableGroup { readonly heading: string; readonly rows: readonly (readonly string[])[] }

// What a filter offers: the extension's options, or else the column's own
// values in the order they first appear.
export function filterOptions(section: Extract<Section, { shape: 'table' }>, filter: TableFilter): readonly string[] {
  if (filter.upTo) return [];
  if (filter.options) return filter.options;
  const seen = new Set<string>();
  for (const group of tableGroups(section)) for (const row of group.rows) {
    const cell = row[filter.column];
    if (cell === undefined || row.length !== section.columns.length) continue;
    for (const value of filter.multiple ? valuesOf(cell) : [cell]) seen.add(value);
  }
  return [...seen];
}

// What a filter offers given the others' choices (KI7MT, 2026-10-23: Program
// United States should leave Entity with the United States' entities): its
// options that some row still has once every other filter is applied, as
// POTA's own park list narrows. The filter's own choice stays offered even
// when the others leave no row with it, so nothing chosen disappears.
export function offeredOptions(
  section: Extract<Section, { shape: 'table' }>, filter: TableFilter, chosen: Readonly<Record<number, string>>
): readonly string[] {
  const all = filterOptions(section, filter);
  const others = Object.fromEntries(Object.entries(chosen).filter(([column]) => Number(column) !== filter.column));
  if (all.length === 0 || Object.values(others).every(value => value === '')) return all;
  const present = new Set<string>();
  for (const group of filteredGroups(section, others)) for (const row of group.rows) {
    const cell = row[filter.column];
    if (cell === undefined) continue;
    for (const value of filter.multiple ? valuesOf(cell) : [cell]) present.add(value);
  }
  const own = chosen[filter.column];
  return all.filter(option => present.has(option) || option === own);
}

// A list cell as drawn: at most three values, then how many more, so one
// park in sixteen states (the Lewis and Clark trail) does not widen its
// column for every other row (KI7MT, 2026-10-23). Only how it is drawn: the
// cell and what its filter matches are whole, and the whole list is its
// title. Undefined when the cell is short enough to draw as it is.
export const LIST_SHOWN = 3;
export function shortList(cell: string): string | undefined {
  const values = valuesOf(cell);
  return values.length > LIST_SHOWN ? `${values.slice(0, LIST_SHOWN).join(', ')} +${values.length - LIST_SHOWN} more` : undefined;
}

// A cell holding several values, as "JP-FS, JP-GM" (a multiple filter).
export const valuesOf = (cell: string) => cell.split(',').map(value => value.trim()).filter(Boolean);

// The table's groups with only the rows every chosen filter matches; a group
// left empty is left out. A choice of '' is "All". A row that spans its
// columns has no cell to match, so it is kept only while nothing is chosen.
export function filteredGroups(section: Extract<Section, { shape: 'table' }>, chosen: Readonly<Record<number, string>>) {
  // Only a choice the table still offers: a refresh can bring a table whose
  // columns or filters differ, and a choice left over from the old one would
  // hide every row with no filter drawn to clear it (Codex review, 2026-10-23).
  const offered = new Set((section.filters ?? []).map(filter => filter.column));
  const several = new Set((section.filters ?? []).filter(filter => filter.multiple).map(filter => filter.column));
  // A named choice stands for its values (My area for the operator's
  // locations): the row matches when its value, or any of them, is one.
  const namedValues = (column: number, value: string) =>
    section.filters?.find(filter => filter.column === column)?.named?.find(choice => choice.label === value)?.values;
  // An up-to choice: a row matches when its cell is a number no greater.
  const bound = (column: number, value: string) =>
    section.filters?.find(filter => filter.column === column)?.upTo?.find(choice => choice.label === value)?.value;
  const active = Object.entries(chosen).filter(([column, value]) => value !== '' && offered.has(Number(column)));
  // Each group keeps its place in the table as sent (`at`), which its
  // contents link names: two groups may share a heading (Codex review).
  const placed = tableGroups(section).map((group, at) => ({ ...group, at }));
  if (active.length === 0) return placed;
  return placed
    .map(group => ({ ...group, rows: group.rows.filter(row => row.length === section.columns.length
      && active.every(([column, value]) => {
        const cell = row[Number(column)] ?? '';
        const most = bound(Number(column), value);
        if (most !== undefined) return isNumber(cell) && Number(cell) <= most;
        const values = several.has(Number(column)) ? valuesOf(cell) : [cell];
        const wanted = namedValues(Number(column), value);
        return wanted ? values.some(entry => wanted.includes(entry)) : values.includes(value);
      })) }))
    .filter(group => group.rows.length > 0);
}

// Where a table's filters start: each one's start, where it gives one.
export function startingChoices(section: Extract<Section, { shape: 'table' }>): Record<number, string> {
  return Object.fromEntries((section.filters ?? []).flatMap(filter => (filter.start !== undefined ? [[filter.column, filter.start]] : [])));
}

// A sort the operator chose by clicking a heading (version 6).
export interface TableSort { readonly column: number; readonly direction: 'ascending' | 'descending' }

// A cell that is a number and nothing else: "14.062", not "20m".
const isNumber = (cell: string) => cell.trim() !== '' && Number.isFinite(Number(cell));
const words = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

// Each group's rows in the chosen order. A column a filter offers options for
// sorts in their order (ADIF's bands, lowest first, rather than "10m" before
// "160m"); a column of numbers sorts as numbers; any other as text, with the
// numbers in it compared as numbers. Equal rows keep the extension's order,
// and a row that spans its columns stays at the end of its group.
export function sortedGroups<G extends { readonly rows: readonly (readonly string[])[] }>(
  section: Extract<Section, { shape: 'table' }>, groups: readonly G[], sort: TableSort | undefined
): readonly G[] {
  if (!sort) return groups;
  // The column the extension sent the rows in order of is sorted by that
  // order: as sent one way, turned round the other.
  const sent = section.sortedBy;
  if (sent && sent.column === sort.column) {
    return sort.direction === sent.direction ? groups : groups.map(group => ({
      ...group,
      rows: [...group.rows.filter(row => row.length === section.columns.length).reverse(), ...group.rows.filter(row => row.length !== section.columns.length)]
    }));
  }
  const options = section.filters?.find(filter => filter.column === sort.column)?.options;
  const sign = sort.direction === 'ascending' ? 1 : -1;
  return groups.map(group => {
    const full = group.rows.filter(row => row.length === section.columns.length);
    const spanning = group.rows.filter(row => row.length !== section.columns.length);
    const cells = full.map(row => row[sort.column] ?? '');
    // The options' order only when every cell is one of them: a filter that
    // offers some values (Parks Near Me's "fewer than 10") must not tie every
    // other one (KI7MT, 2026-10-23: activations would not sort).
    const rank = options && cells.every(cell => options.includes(cell)) ? new Map(options.map((option, at) => [option, at])) : undefined;
    // A column of numbers with a few words in it ("none", "—") sorts the
    // numbers as numbers, the words before them.
    const numeric = cells.some(isNumber);
    const compare = (a: readonly string[], b: readonly string[]) => {
      const x = a[sort.column] ?? '';
      const y = b[sort.column] ?? '';
      if (rank) return ((rank.get(x) ?? Infinity) - (rank.get(y) ?? Infinity) || 0) * sign;
      if (numeric) {
        const xn = isNumber(x);
        const yn = isNumber(y);
        if (xn && yn) return (Number(x) - Number(y)) * sign;
        if (xn !== yn) return (xn ? 1 : -1) * sign;
      }
      return words.compare(x, y) * sign;
    };
    const ordered = full.map((row, at) => ({ row, at })).sort((a, b) => compare(a.row, b.row) || a.at - b.at).map(entry => entry.row);
    return { ...group, rows: [...ordered, ...spanning] };
  });
}

// A table's rows as groups: an ungrouped table is one group with no heading.
export function tableGroups(section: Extract<Section, { shape: 'table' }>): readonly { readonly heading?: string; readonly rows: readonly (readonly string[])[] }[] {
  return 'groups' in section ? section.groups : [{ rows: section.rows }];
}

export type PageShown =
  | { readonly state: 'waiting' }
  | { readonly state: 'ready'; readonly observedAt: string; readonly sections: readonly Section[] }
  // The extension answered that it has nothing to show, or the core could not
  // reach it: either way, words, on this page alone (QGD-HOM-0006).
  | { readonly state: 'failed'; readonly reason: string };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// A time as ham radio says it: UTC, hours and minutes, with the date in front
// whenever it is not today (UTC), so yesterday's 18:00 never reads as today's.
export function utc(iso: string, now: number = Date.now()): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const time = `${String(at.getUTCHours()).padStart(2, '0')}:${String(at.getUTCMinutes()).padStart(2, '0')} UTC`;
  const today = new Date(now);
  const sameDay = at.getUTCFullYear() === today.getUTCFullYear() && at.getUTCMonth() === today.getUTCMonth() && at.getUTCDate() === today.getUTCDate();
  return sameDay ? time : `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]} ${time}`;
}
