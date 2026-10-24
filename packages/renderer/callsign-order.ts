// SPDX-License-Identifier: GPL-3.0-only
// The order the Callsigns page lists them in (#70, KI7MT 2026-10-24): the
// active callsign first, then those in use, then those whose end date has
// passed, each group by call. The core keeps them by their random ids, so
// left alone the list was in no order anyone could see.
export interface Listed { id: string; call: string; end?: string | null }

// A callsign is in use until the end of its end date, when it has one.
export function isExpired(callsign: Listed, today: string): boolean {
  return typeof callsign.end === 'string' && callsign.end !== '' && callsign.end < today;
}

export function orderCallsigns<T extends Listed>(callsigns: readonly T[], active: string | null, today: string): T[] {
  const group = (callsign: T): number => (callsign.id === active ? 0 : isExpired(callsign, today) ? 2 : 1);
  return [...callsigns].sort((a, b) => group(a) - group(b) || a.call.localeCompare(b.call) || a.id.localeCompare(b.id));
}

// "From 2026-01-01", "2001-05-01 to 2010-12-31", as the dates were entered.
export function callsignDates(start?: string | null, end?: string | null): string {
  if (start && end) return `${start} to ${end}`;
  if (start) return `From ${start}`;
  if (end) return `Until ${end}`;
  return '';
}
