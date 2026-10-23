// SPDX-License-Identifier: GPL-3.0-only
// One search over ADIF's own definitions (KI7MT, 2026-10-22: ADIF Lookup):
// its fields and every enumeration's values, as the ADIF Development Group
// publishes them in reference.sqlite. What comes back is ADIF's text, column
// by column, and nothing of ours: no description is added, and an empty
// column is left out rather than filled.
//
// Read-only, and bounded: at most ADIF_RESULTS entries, each with at most
// ADIF_COLUMNS of ADIF's columns, each value cut at ADIF_TEXT characters.
import { eq, or, sql } from 'drizzle-orm';
import { enumeration, enumerationValue, field, type referenceSchema } from './reference-schema.js';
import type { Store } from './sqlite.js';

import { ADIF_COLUMNS, ADIF_LIST_COLUMNS, ADIF_LIST_ROWS, ADIF_QUERY, ADIF_RESULTS, ADIF_TEXT, type AdifBand, type AdifEntry, type AdifList } from './adif-entry.js';
export { ADIF_COLUMNS, ADIF_QUERY, ADIF_RESULTS, ADIF_TEXT, type AdifBand, type AdifEntry, type AdifList };

const cut = (value: string) => (value.length > ADIF_TEXT ? `${value.slice(0, ADIF_TEXT - 1)}…` : value);

function columns(values: Record<string, unknown>): AdifEntry['columns'] {
  return Object.entries(values)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim() !== '')
    .slice(0, ADIF_COLUMNS)
    .map(([name, value]) => ({ name: cut(name), value: cut(value) }));
}

// Exact keys first, then keys that begin with the query, then entries whose
// text holds it: a ham typing 20M wants the band before every mode whose
// description mentions 20 metres.
export async function searchAdif(reference: Store<typeof referenceSchema>, query: string): Promise<AdifEntry[]> {
  const q = query.trim();
  if (q === '' || q.length > ADIF_QUERY) return [];
  // LIKE's own characters are escaped, so a % or _ typed is looked for, not
  // matched as a wildcard.
  const escaped = q.replace(/[\\%_]/g, character => `\\${character}`);
  const prefix = `${escaped}%`;
  const within = `%${escaped}%`;
  return reference.unit(async (db) => {
    // Ranked in the query, before its limit: an unordered limit could keep
    // 160 entries that only mention the search and drop the one whose name
    // it is (Codex review, 2026-10-23). Exact first, then by name, then the
    // rest; LIKE is case-insensitive for ASCII, as ADIF's names are.
    const exact = q.toUpperCase();
    const fields = await db.select().from(field)
      .where(or(sql`${field.name} LIKE ${prefix} ESCAPE '\\'`, sql`${field.description} LIKE ${within} ESCAPE '\\'`))
      .orderBy(sql`CASE WHEN upper(${field.name}) = ${exact} THEN 0 WHEN ${field.name} LIKE ${prefix} ESCAPE '\\' THEN 1 ELSE 2 END`, field.name)
      .limit(ADIF_RESULTS).all();
    const values = await db.select().from(enumerationValue)
      .where(or(
        sql`${enumerationValue.key} LIKE ${prefix} ESCAPE '\\'`,
        sql`${enumerationValue.value} LIKE ${within} ESCAPE '\\'`
      ))
      .orderBy(sql`CASE WHEN upper(${enumerationValue.key}) = ${exact} THEN 0 WHEN ${enumerationValue.key} LIKE ${prefix} ESCAPE '\\' THEN 1 ELSE 2 END`, enumerationValue.enumeration, enumerationValue.key)
      .limit(ADIF_RESULTS * 4).all();
    const upper = q.toUpperCase();
    const rank = (key: string) => (key.toUpperCase() === upper ? 0 : key.toUpperCase().startsWith(upper) ? 1 : 2);
    const entries: (AdifEntry & { rank: number })[] = [
      ...fields.map(row => ({
        list: 'Field', key: row.name, rank: rank(row.name),
        columns: columns({
          'Data Type': row.dataType, Enumeration: row.enumerationName ?? '', Description: row.description,
          'Minimum Value': row.minimumValue ?? '', 'Maximum Value': row.maximumValue ?? '', Comments: row.comments ?? ''
        })
      })),
      ...values.map(row => ({ list: row.enumeration, key: row.key, rank: rank(row.key), columns: columns(row.value) }))
    ];
    entries.sort((a, b) => a.rank - b.rank || a.list.localeCompare(b.list) || a.key.localeCompare(b.key));
    return entries.slice(0, ADIF_RESULTS).map(entry => ({ list: entry.list, key: entry.key, columns: entry.columns }));
  });
}


// ADIF's bands, lowest first, each with the edges ADIF gives it. A row whose
// edges are not numbers is left out rather than guessed at.
export async function adifBands(reference: Store<typeof referenceSchema>): Promise<AdifBand[]> {
  return reference.unit(async (db) => {
    const rows = await db.select().from(enumerationValue).where(eq(enumerationValue.enumeration, 'Band')).all();
    const bands: AdifBand[] = [];
    for (const row of rows) {
      const value = row.value as Record<string, unknown>;
      // Number('') is 0, so an empty edge is refused before it is read.
      const edge = (raw: unknown) => (typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN);
      const lowerMHz = edge(value['Lower Freq (MHz)']);
      const upperMHz = edge(value['Upper Freq (MHz)']);
      if (typeof value.Band !== 'string' || !Number.isFinite(lowerMHz) || !Number.isFinite(upperMHz) || upperMHz < lowerMHz) continue;
      bands.push({ band: value.Band, lowerMHz, upperMHz });
    }
    return bands.sort((a, b) => a.lowerMHz - b.lowerMHz);
  });
}

// A whole enumeration by its name, as ADIF spells it or in any case
// (DXCC_Entity_Code, dxcc_entity_code), or undefined when ADIF has no list of
// that name (#58). ADIF's text, whole: nothing added, nothing reworded.
export async function adifList(reference: Store<typeof referenceSchema>, name: string): Promise<AdifList | undefined> {
  const wanted = name.trim();
  if (wanted === '' || wanted.length > ADIF_QUERY) return undefined;
  return reference.unit(async (db) => {
    const list = await db.select().from(enumeration).where(sql`upper(${enumeration.name}) = ${wanted.toUpperCase()}`).get();
    if (!list) return undefined;
    const values = await db.select().from(enumerationValue).where(eq(enumerationValue.enumeration, list.name)).all();
    // ADIF's columns in its order; the list's own name is the heading, and a
    // column empty in every row is left out, as a search leaves one out.
    const columns = list.header.filter(column => column !== 'Enumeration Name'
      && values.some(row => typeof row.value[column] === 'string' && row.value[column]!.trim() !== '')).slice(0, ADIF_LIST_COLUMNS);
    const numeric = values.every(row => /^[0-9]+$/.test(row.key));
    const ordered = [...values].sort((a, b) => (numeric ? Number(a.key) - Number(b.key) : a.key.localeCompare(b.key)));
    return {
      name: list.name, columns,
      rows: ordered.slice(0, ADIF_LIST_ROWS).map(row => columns.map(column => cut(typeof row.value[column] === 'string' ? row.value[column]! : '')))
    };
  });
}
