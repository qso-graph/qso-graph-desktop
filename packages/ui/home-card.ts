// SPDX-License-Identifier: GPL-3.0-only
// The shapes a Home card is drawn from (QGD-HOM-0002), as the ui package sees
// them. Declared here rather than imported: ui depends on nothing
// (QGD-REP-0006), and these are checked against the extension API's own
// types where the renderer hands them over.
export interface Figure { readonly label: string; readonly value: string; readonly unit?: string }
export interface Item { readonly title: string; readonly detail?: string }
export type Section =
  | { readonly shape: 'figures'; readonly figures: readonly Figure[] }
  | { readonly shape: 'items'; readonly items: readonly Item[] }
  | { readonly shape: 'alert'; readonly level: 'info' | 'warning' | 'severe'; readonly text: string };

export type CardShown =
  | { readonly state: 'waiting' }
  | { readonly state: 'ready'; readonly observedAt: string; readonly sections: readonly Section[] }
  // The extension answered that it has nothing to show, or the core could not
  // reach it: either way, words, on this card alone (QGD-HOM-0006).
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
