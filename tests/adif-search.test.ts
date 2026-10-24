// SPDX-License-Identifier: GPL-3.0-only
// ADIF Lookup's search (KI7MT, 2026-10-22): ADIF's own fields and
// enumeration values, ranked as a ham would look for them, shown as ADIF has
// them and nothing added. The rows here are written for the test, shaped as
// ADIF's are; nothing of ADIF's files is copied.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { adifBands, adifList, searchAdif, ADIF_RESULTS } from '../packages/storage/adif-search.js';
import { enumeration, enumerationValue, field, referenceSchema } from '../packages/storage/reference-schema.js';
import { openStore } from '../packages/storage/sqlite.js';
import { isStorageReply } from '../packages/storage/storage-contract.js';

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
      { name: 'Mode', header: ['Mode', 'Submodes', 'Description'], valueColumn: 'Mode', rowCount: 2 },
      { name: 'DXCC_Entity_Code', header: ['Enumeration Name', 'Entity Code', 'Entity Name', 'Deleted', 'Import-only'], valueColumn: 'Entity Code', rowCount: 3 }
    ]).run();
    await db.insert(enumerationValue).values([
      { enumeration: 'Band', key: '20m', value: { Band: '20m', 'Lower Freq (MHz)': '14.0', 'Upper Freq (MHz)': '14.35' } },
      { enumeration: 'Band', key: '2m', value: { Band: '2m', 'Lower Freq (MHz)': '144', 'Upper Freq (MHz)': '148' } },
      { enumeration: 'Mode', key: 'MFSK', value: { Mode: 'MFSK', Submodes: 'FT4, JS8', Description: '' } },
      { enumeration: 'Mode', key: 'FT8', value: { Mode: 'FT8', Submodes: '', Description: 'Weak signal on 20m and elsewhere' } },
      { enumeration: 'DXCC_Entity_Code', key: '291', value: { 'Enumeration Name': 'DXCC_Entity_Code', 'Entity Code': '291', 'Entity Name': 'UNITED STATES OF AMERICA', Deleted: '', 'Import-only': '' } },
      { enumeration: 'DXCC_Entity_Code', key: '1', value: { 'Enumeration Name': 'DXCC_Entity_Code', 'Entity Code': '1', 'Entity Name': 'CANADA', Deleted: '', 'Import-only': '' } },
      { enumeration: 'DXCC_Entity_Code', key: '21', value: { 'Enumeration Name': 'DXCC_Entity_Code', 'Entity Code': '21', 'Entity Name': 'BALEARIC IS.', Deleted: 'Y', 'Import-only': '' } }
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

describe('ADIF\'s bands (adif.bands)', () => {
  it('gives each band with ADIF\'s own edges, lowest first, and leaves out a row with no edges', async () => {
    const store = await reference();
    try {
      await store.unit(async (db) => {
        await db.insert(enumerationValue).values([
          { enumeration: 'Band', key: '40m', value: { Band: '40m', 'Lower Freq (MHz)': '7.0', 'Upper Freq (MHz)': '7.3' } },
          { enumeration: 'Band', key: 'odd', value: { Band: 'odd', 'Lower Freq (MHz)': '', 'Upper Freq (MHz)': 'x' } }
        ]).run();
      });
      expect(await adifBands(store)).toEqual([
        { band: '40m', lowerMHz: 7, upperMHz: 7.3 },
        { band: '20m', lowerMHz: 14, upperMHz: 14.35 },
        { band: '2m', lowerMHz: 144, upperMHz: 148 }
      ]);
    } finally { store.close(); }
  });
});

// What QG Storage answers must pass the main process's check of its replies,
// or the main process refuses it and the extension gets nothing: both the
// search's and the bands' fields were missing from that check, and every
// test above passed (KI7MT, 2026-10-23: Parks On the Air showed no bands).
describe('QG Storage\'s ADIF replies pass the main process\'s check', () => {
  const status = { state: 'ready' };
  it('passes a real search and a real band list, end to end', async () => {
    const store = await reference();
    try {
      expect(isStorageReply({ ok: true, status, adif: await searchAdif(store, '20m') })).toBe(true);
      expect(isStorageReply({ ok: true, status, bands: await adifBands(store) })).toBe(true);
    } finally { store.close(); }
  });

  it('refuses a band list that is not one', () => {
    for (const bands of [[{ band: '20m', lowerMHz: 14 }], [{ band: '20m', lowerMHz: 14.35, upperMHz: 14 }], [{ band: 20, lowerMHz: 14, upperMHz: 14.35 }], [{ band: '20m', lowerMHz: 14, upperMHz: 14.35, x: 1 }], 'bands']) {
      expect(isStorageReply({ ok: true, status, bands }), JSON.stringify(bands)).toBe(false);
    }
    expect(isStorageReply({ ok: true, status, adif: [{ list: 'Band', key: '20m', columns: [{ name: 'Band', value: 'x'.repeat(1001) }] }] })).toBe(false);
  });
});

describe('an exact match is never cut by the search\'s own limit (Codex review, 2026-10-23)', () => {
  it('finds Mode AM first, though 161 other values mention AM and come before it', async () => {
    const store = await reference();
    try {
      await store.unit(async (db) => {
        await db.insert(enumerationValue).values(Array.from({ length: 161 }, (_, i) => (
          { enumeration: 'Mode', key: `X${i}`, value: { Mode: `X${i}`, Submodes: '', Description: 'Something AM-like' } }))).run();
        await db.insert(enumerationValue).values([{ enumeration: 'Mode', key: 'AM', value: { Mode: 'AM', Submodes: '', Description: '' } }]).run();
      });
      const [first] = await searchAdif(store, 'AM');
      expect(first).toMatchObject({ list: 'Mode', key: 'AM' });
    } finally { store.close(); }
  });
});

describe('a whole list by its name (#58)', () => {
  it('gives every value under ADIF\'s columns in ADIF\'s order, in any case, numbers in number order', async () => {
    const store = await reference();
    try {
      // The list's own name is its heading, and a column empty in every row is
      // left out (Import-only); one empty in some rows stays (Deleted).
      expect(await adifList(store, 'dxcc_entity_code')).toEqual({
        name: 'DXCC_Entity_Code', columns: ['Entity Code', 'Entity Name', 'Deleted'],
        rows: [['1', 'CANADA', ''], ['21', 'BALEARIC IS.', 'Y'], ['291', 'UNITED STATES OF AMERICA', '']]
      });
      expect((await adifList(store, 'Mode'))?.rows).toEqual([['FT8', '', 'Weak signal on 20m and elsewhere'], ['MFSK', 'FT4, JS8', '']]);
    } finally { store.close(); }
  });

  it('gives nothing for a name ADIF has no list of, and the window takes both answers', async () => {
    const store = await reference();
    const status = { state: 'ready' };
    try {
      expect(await adifList(store, 'FT8')).toBeUndefined();
      expect(await adifList(store, '')).toBeUndefined();
      expect(isStorageReply({ ok: true, status, adifList: await adifList(store, 'Band') })).toBe(true);
      expect(isStorageReply({ ok: true, status, adifList: null })).toBe(true);
      expect(isStorageReply({ ok: true, status, adifList: { name: 'Band', columns: ['Band'], rows: [['20m', 'extra']] } })).toBe(false);
    } finally { store.close(); }
  });
});
