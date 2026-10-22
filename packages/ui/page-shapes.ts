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
  | { readonly shape: 'table'; readonly columns: readonly string[]; readonly rows: readonly (readonly string[])[] }
  // In named groups, and a two-cell row across a wider table (version 5).
  | { readonly shape: 'table'; readonly columns: readonly string[]; readonly groups: readonly TableGroup[] }
  // The world with the night greyed out, and places marked (version 6).
  | { readonly shape: 'map'; readonly sun: Place; readonly moon?: Place; readonly twilight?: number; readonly marks: readonly Mark[] }
) & { readonly heading?: string };
export interface Place { readonly latitude: number; readonly longitude: number }
export interface Mark extends Place { readonly label: string }
export interface TableGroup { readonly heading: string; readonly rows: readonly (readonly string[])[] }

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
