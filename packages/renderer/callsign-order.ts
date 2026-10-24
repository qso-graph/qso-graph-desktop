// SPDX-License-Identifier: GPL-3.0-only
// The order the Callsigns page lists them in (#70, KI7MT 2026-10-24): the
// active callsign first, then the rest by start date, newest first, so an
// earlier call falls to the bottom; a tie, or a callsign with no start date,
// by call. The core keeps them by their random ids, so left alone the list
// was in no order anyone could see.
export interface Listed { id: string; call: string; start?: string | null; end?: string | null }

// A callsign is in use until the end of its end date, when it has one.
export function isExpired(callsign: Listed, today: string): boolean {
  return typeof callsign.end === 'string' && callsign.end !== '' && callsign.end < today;
}

export function orderCallsigns<T extends Listed>(callsigns: readonly T[], active: string | null): T[] {
  const first = (callsign: T): number => (callsign.id === active ? 0 : 1);
  const start = (callsign: T): string => callsign.start ?? '';
  return [...callsigns].sort((a, b) => first(a) - first(b) || start(b).localeCompare(start(a))
    || a.call.localeCompare(b.call) || a.id.localeCompare(b.id));
}

// "From 2026-01-01", "2001-05-01 to 2010-12-31", as the dates were entered.
export function callsignDates(start?: string | null, end?: string | null): string {
  if (start && end) return `${start} to ${end}`;
  if (start) return `From ${start}`;
  if (end) return `Until ${end}`;
  return '';
}
