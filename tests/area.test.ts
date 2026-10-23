// SPDX-License-Identifier: GPL-3.0-only
// My Area's choices and default (KI7MT, 2026-10-23), from POTA's lists as
// QG Storage holds them. The rows are written for the test in POTA's shape;
// nothing of POTA's files is copied.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { areaChoices, areaDefault } from '../packages/storage/area.js';
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
      { programId: 3, prefix: 'XX', name: 'Retired', active: false }
    ]).run();
    await db.insert(potaLocation).values([
      { locationId: 1, entityId: 291, locationDesc: 'US-ID', locationName: 'Idaho' },
      { locationId: 2, entityId: 291, locationDesc: 'US-MT', locationName: 'Montana' },
      { locationId: 3, entityId: 339, locationDesc: 'JP-TK', locationName: 'Tokyo' },
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
  it('offers each active program with its locations, by name', async () => {
    const store = await reference();
    try {
      expect(await areaChoices(store)).toEqual([
        { prefix: 'JP', name: 'Japan', locations: [{ code: 'JP-TK', name: 'Tokyo' }] },
        { prefix: 'US', name: 'United States of America', locations: [{ code: 'US-ID', name: 'Idaho' }, { code: 'US-MT', name: 'Montana' }] }
      ]);
    } finally { store.close(); }
  });

  it('starts from the Location\'s own: DXCC 291 in Idaho is US-ID, and nothing is guessed', async () => {
    const store = await reference();
    try {
      expect(await areaDefault(store, '291', 'ID')).toBe('US-ID');
      expect(await areaDefault(store, '291', 'ZZ')).toBeUndefined();
      expect(await areaDefault(store, undefined, 'ID')).toBeUndefined();
      expect(await areaDefault(store, '291', undefined)).toBeUndefined();
    } finally { store.close(); }
  });

  it('passes the main process\'s check of the store\'s replies', async () => {
    const store = await reference();
    const status = { state: 'ready' };
    try {
      expect(isStorageReply({ ok: true, status, areaChoices: await areaChoices(store) })).toBe(true);
      expect(isStorageReply({ ok: true, status, areaDefault: 'US-ID' })).toBe(true);
      expect(isStorageReply({ ok: true, status, areaDefault: null })).toBe(true);
      expect(isStorageReply({ ok: true, status, areaDefault: 'us-id' })).toBe(false);
      expect(isStorageReply({ ok: true, status, areaChoices: [{ prefix: 'US', name: '<b>', locations: [] }] })).toBe(false);
    } finally { store.close(); }
  });
});
