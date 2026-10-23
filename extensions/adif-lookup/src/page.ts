// SPDX-License-Identifier: GPL-3.0-only
// ADIF Lookup's page (KI7MT, 2026-10-22: the fourth launch pin): ADIF's own
// definitions, searched. Every field, and every value of every enumeration,
// as the ADIF Development Group publishes them and the core loaded them.
//
// ADIF is ADIF: what is shown is ADIF's text under ADIF's own column names,
// nothing added and nothing reworded; an empty column is left out rather than
// filled. Pure: what the core answered in, a page answer out.
import type { AdifEntry } from '../../../packages/extension-api/api-contract.js';
import type { PageAnswer, Section } from '../../../packages/extension-api/pages.js';

// The most the core answers with (adif-entry.ts ADIF_RESULTS).
const MOST = 40;
const plain = (text: string, limit: number) => text.replace(/[<>]/g, '').slice(0, limit);

// Each match as a group of its own, headed by its name, with a row for each
// of ADIF's columns: the list, ADIF's name for the column, and its value
// whole (KI7MT, 2026-10-23). Nothing is joined, reworded or cut.
export function adifRows(entry: AdifEntry): string[][] {
  const list = plain(entry.list, 1000) || '—';
  if (entry.columns.length === 0) return [[list, '—', '—']];
  return entry.columns.map(column => [list, plain(column.name, 1000) || '—', plain(column.value, 1000) || '—']);
}

export function lookupPage(query: string | undefined, found: readonly AdifEntry[] | string, now: Date): PageAnswer {
  const observedAt = new Date(Math.floor(now.getTime() / 60_000) * 60_000).toISOString().replace('.000Z', 'Z');
  const page = (sections: Section[]): PageAnswer => ({ ok: true, data: { version: 6, observedAt, sections } });
  if (query === undefined) {
    return page([{ shape: 'text', text: 'Search ADIF\'s own definitions: every field, and every value of every enumeration, as the ADIF Development Group publishes them.' }]);
  }
  // The core could not search: ADIF's definitions are not downloaded, most
  // likely. Its words, which say what to do.
  if (typeof found === 'string') return page([{ shape: 'alert', level: 'info', text: plain(found, 200) }]);
  if (found.length === 0) return page([{ shape: 'text', text: plain(`Nothing in ADIF's definitions matches ${query}.`, 200) }]);
  // Fields first, then each enumeration by name, as ADIF lists them.
  const lists = [...new Set(found.map(entry => entry.list))].sort((a, b) => (a === 'Field' ? -1 : b === 'Field' ? 1 : a.localeCompare(b)));
  const sections: Section[] = [{
    shape: 'table', heading: `${found.length} found in ADIF's definitions`, contents: false,
    columns: ['List', 'ADIF column', 'Value'],
    groups: found.map(entry => ({ heading: plain(entry.key, 60) || '—', rows: adifRows(entry) })),
    filters: [{ column: 0, label: 'List', options: lists.map(list => plain(list, 80)).filter(Boolean).slice(0, 100) }]
  }];
  if (found.length >= MOST) sections.push({ shape: 'text', text: `The first ${MOST} matches are shown. A longer search narrows them.` });
  return page(sections);
}
