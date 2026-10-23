// SPDX-License-Identifier: GPL-3.0-only
// My Area's choices and default (KI7MT, 2026-10-23), from POTA's lists as
// QG Storage holds them. The rows are written for the test in POTA's shape;
// nothing of POTA's files is copied.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { areaChoices, areaDefault, areaLocations } from '../packages/storage/area.js';
import { areaKind } from '../packages/storage/area-entry.js';
import { potaLocation, potaPark, potaProgram, referenceSchema } from '../packages/storage/reference-schema.js';
import { openStore } from '../packages/storage/sqlite.js';
import { isStorageReply } from '../packages/storage/storage-contract.js';

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'qg-area-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

async function reference() {
  const store = openStore(join(root, 'reference.sqlite'), { schema: referenceSchema });
  for (const statement of readFileSync('drizzle/reference/0000_reference.sql', 'utf8').split('--> statement-breakpoint')) store.connection.exec(statement);
  await store.unit(async (db) => {
    await db.insert(potaProgram).values([
      { programId: 1, prefix: 'US', name: 'United States of America', active: true },
      { programId: 2, prefix: 'JP', name: 'Japan', active: true },
      { programId: 4, prefix: 'IT', name: 'Italy', active: true },
      { programId: 3, prefix: 'XX', name: 'Retired', active: false }
    ]).run();
    await db.insert(potaLocation).values([
      { locationId: 1, entityId: 291, entityName: 'United States of America', locationDesc: 'US-ID', locationName: 'Idaho' },
      { locationId: 2, entityId: 291, entityName: 'United States of America', locationDesc: 'US-MT', locationName: 'Montana' },
      { locationId: 5, entityId: 6, entityName: 'Alaska', locationDesc: 'US-AK', locationName: 'Alaska' },
      { locationId: 6, entityId: 248, entityName: 'Italy', locationDesc: 'IT-LZ', locationName: 'Lazio' },
      { locationId: 7, entityId: 248, entityName: 'Italy', locationDesc: 'IT-LM', locationName: 'Lombardia' },
      { locationId: 8, entityId: 0, entityName: 'None', locationDesc: 'None', locationName: 'None' },
      { locationId: 3, entityId: 339, entityName: 'Japan', locationDesc: 'JP-TK', locationName: 'Tokyo' },
      { locationId: 4, entityId: 999, locationDesc: 'XX-AA', locationName: 'Gone' }
    ]).run();
    await db.insert(potaPark).values([
      { reference: 'US-0001', name: 'Made-up Park', active: true, adifEntity: 291, locationDesc: 'US-ID', coordinatesUsable: true },
      { reference: 'JP-0001', name: 'Made-up Park', active: true, adifEntity: 339, locationDesc: 'JP-TK', coordinatesUsable: true }
    ]).run();
  });
  return store;
}

describe('My Area', () => {
  it('offers each active program with its entities and their locations, by name, as POTA narrows them', async () => {
    const store = await reference();
    try {
      expect(await areaChoices(store)).toEqual([
        { prefix: 'IT', name: 'Italy', entities: [{ id: '248', name: 'Italy', locations: [{ code: 'IT-LZ', name: 'Lazio' }, { code: 'IT-LM', name: 'Lombardia' }] }] },
        { prefix: 'JP', name: 'Japan', entities: [{ id: '339', name: 'Japan', locations: [{ code: 'JP-TK', name: 'Tokyo' }] }] },
        { prefix: 'US', name: 'United States of America', entities: [
          { id: '6', name: 'Alaska', locations: [{ code: 'US-AK', name: 'Alaska' }] },
          { id: '291', name: 'United States of America', locations: [{ code: 'US-ID', name: 'Idaho' }, { code: 'US-MT', name: 'Montana' }] }
        ] }
      ]);
    } finally { store.close(); }
  });

  it('starts from the Location\'s own, most precise first, and guesses nothing', async () => {
    const store = await reference();
    try {
      // Idaho: the location for its state.
      expect(await areaDefault(store, '291', 'ID')).toBe('US-ID');
      // Rome: ADIF's subdivision is the province, POTA's location the region,
      // so the entity; and the entity with no state at all.
      expect(await areaDefault(store, '248', 'RM')).toBe('248');
      expect(await areaDefault(store, '291', undefined)).toBe('291');
      // A state that is another entity's does not count.
      expect(await areaDefault(store, '6', 'ID')).toBe('6');
      expect(await areaDefault(store, undefined, 'ID')).toBeUndefined();
      expect(await areaDefault(store, '0', undefined)).toBeUndefined();
      expect(await areaDefault(store, '777', undefined)).toBeUndefined();
    } finally { store.close(); }
  });

  it('turns an area into the locations it covers', async () => {
    const store = await reference();
    try {
      expect(await areaLocations(store, ['US-ID'])).toEqual(['US-ID']);
      expect(await areaLocations(store, ['291'])).toEqual(['US-ID', 'US-MT']);
      expect(await areaLocations(store, ['US'])).toEqual(['US-AK', 'US-ID', 'US-MT']);
      expect(await areaLocations(store, ['IT', 'US-ID', '6'])).toEqual(['IT-LM', 'IT-LZ', 'US-AK', 'US-ID']);
      expect(await areaLocations(store, [])).toEqual([]);
    } finally { store.close(); }
  });

  it('writes each of POTA\'s levels so it can never be read as another', () => {
    expect(['US-ID', 'JP-FS', '9A-ZG'].map(areaKind)).toEqual(['location', 'location', 'location']);
    expect(['291', '6', '0'].map(areaKind)).toEqual(['entity', 'entity', 'entity']);
    expect(['US', 'IT', '9A', 'E7'].map(areaKind)).toEqual(['program', 'program', 'program', 'program']);
    // Nothing that could change a URL or a file name.
    for (const entry of ['us-id', 'US-ID/x', '../US', 'US-', 'US-ID?x=1', 'US-ID ', '1234', 'TOOLONG', '', 'US%2F']) expect(areaKind(entry), entry).toBeUndefined();
  });

  it('passes the main process\'s check of the store\'s replies', async () => {
    const store = await reference();
    const status = { state: 'ready' };
    try {
      expect(isStorageReply({ ok: true, status, areaChoices: await areaChoices(store) })).toBe(true);
      expect(isStorageReply({ ok: true, status, areaDefault: 'US-ID' })).toBe(true);
      expect(isStorageReply({ ok: true, status, areaDefault: '248' })).toBe(true);
      expect(isStorageReply({ ok: true, status, areaDefault: 'IT' })).toBe(true);
      expect(isStorageReply({ ok: true, status, areaLocations: ['US-ID', 'US-MT'] })).toBe(true);
      expect(isStorageReply({ ok: true, status, areaLocations: ['291'] })).toBe(false);
      expect(isStorageReply({ ok: true, status, areaDefault: null })).toBe(true);
      expect(isStorageReply({ ok: true, status, areaDefault: 'us-id' })).toBe(false);
      expect(isStorageReply({ ok: true, status, areaChoices: [{ prefix: 'US', name: '<b>', entities: [] }] })).toBe(false);
    } finally { store.close(); }
  });
});
