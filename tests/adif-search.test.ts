// SPDX-License-Identifier: GPL-3.0-only
// ADIF Lookup's search (KI7MT, 2026-10-22): ADIF's own fields and
// enumeration values, ranked as a ham would look for them, shown as ADIF has
// them and nothing added. The rows here are written for the test, shaped as
// ADIF's are; nothing of ADIF's files is copied.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { searchAdif, ADIF_RESULTS } from '../packages/storage/adif-search.js';
import { enumeration, enumerationValue, field, referenceSchema } from '../packages/storage/reference-schema.js';
import { openStore } from '../packages/storage/sqlite.js';

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'qg-adif-search-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

async function reference() {
  const store = openStore(join(root, 'reference.sqlite'), { schema: referenceSchema });
  const ddl = readFileSync('drizzle/reference/0000_reference.sql', 'utf8');
  for (const statement of ddl.split('--> statement-breakpoint')) store.connection.exec(statement);
  await store.unit(async (db) => {
    await db.insert(enumeration).values([
      { name: 'Band', header: ['Band', 'Lower Freq (MHz)', 'Upper Freq (MHz)'], valueColumn: 'Band', rowCount: 2 },
      { name: 'Mode', header: ['Mode', 'Submodes', 'Description'], valueColumn: 'Mode', rowCount: 2 }
    ]).run();
    await db.insert(enumerationValue).values([
      { enumeration: 'Band', key: '20m', value: { Band: '20m', 'Lower Freq (MHz)': '14.0', 'Upper Freq (MHz)': '14.35' } },
      { enumeration: 'Band', key: '2m', value: { Band: '2m', 'Lower Freq (MHz)': '144', 'Upper Freq (MHz)': '148' } },
      { enumeration: 'Mode', key: 'MFSK', value: { Mode: 'MFSK', Submodes: 'FT4, JS8', Description: '' } },
      { enumeration: 'Mode', key: 'FT8', value: { Mode: 'FT8', Submodes: '', Description: 'Weak signal on 20m and elsewhere' } }
    ]).run();
    await db.insert(field).values([
      { name: 'BAND', dataType: 'Enumeration', dataTypes: ['Enumeration'], enumerationName: 'Band', description: 'QSO band' }
    ]).run();
  });
  return store;
}

describe('ADIF Lookup\'s search', () => {
  it('puts an exact key first, then keys that begin with it, then text that holds it', async () => {
    const store = await reference();
    try {
      const found = await searchAdif(store, '20m');
      expect(found.map(entry => `${entry.list}:${entry.key}`)).toEqual(['Band:20m', 'Mode:FT8']);
      expect((await searchAdif(store, '2m')).map(entry => entry.key)[0]).toBe('2m');
    } finally { store.close(); }
  });

  it('shows ADIF\'s own columns in ADIF\'s order, and leaves an empty one out rather than filling it', async () => {
    const store = await reference();
    try {
      const [ft8] = await searchAdif(store, 'FT8');
      expect(ft8.columns).toEqual([{ name: 'Mode', value: 'FT8' }, { name: 'Description', value: 'Weak signal on 20m and elsewhere' }]);
      // A submode is found by the text of its mode's row.
      expect((await searchAdif(store, 'FT4')).map(entry => entry.key)).toEqual(['MFSK']);
      const [band] = await searchAdif(store, 'band');
      expect(band).toMatchObject({ list: 'Field', key: 'BAND' });
    } finally { store.close(); }
  });

  it('looks for a typed % or _ as itself, and finds nothing for nothing', async () => {
    const store = await reference();
    try {
      expect(await searchAdif(store, '%')).toEqual([]);
      expect(await searchAdif(store, '   ')).toEqual([]);
      expect(await searchAdif(store, 'x'.repeat(65))).toEqual([]);
      expect((await searchAdif(store, 'm')).length).toBeLessThanOrEqual(ADIF_RESULTS);
    } finally { store.close(); }
  });
});
