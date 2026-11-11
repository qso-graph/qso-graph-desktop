// SPDX-License-Identifier: GPL-3.0-or-later
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { beforeEach, afterEach, it, expect } from 'vitest';
import { layout, openState } from '../packages/storage/layout.js';
import { addLotwStations, saveStation, setActiveStation, setDefaultStation, viewStations } from '../packages/storage/stations.js';
let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'qgd-lotw-test-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });
const draft = (_: unknown, extra: Record<string, string>) => ({ place: { MY_GRIDSQUARE: 'DN13' }, name: 'Test location', ...extra });

it('QGD-LTW-0008, QGD-STN-0008: appends TQSL Locations preserving notes, defaults, active and existing rows', async () => {
  const state = await openState(layout(root), resolve('drizzle/state'), '0.0.0-test');
  try {
    const created = await saveStation(state, draft({}, { name: 'Test existing', notes: 'Test-only private note' }), 'not loaded');
    if (!created.ok) throw new Error('Station fixture was refused');
    const id = created.id;
    await setActiveStation(state, id);
    await setDefaultStation(state, '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6c', id);
    const before = await viewStations(state, true);
    const arriving = { id: '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b', name: 'Test existing (TQSL)', place: { MY_GRIDSQUARE: 'DN13' } };
    const backup = { stations: [arriving], defaults: {}, active: null };
    expect(await addLotwStations(state, backup, ['Test existing'], 'not loaded')).toBe(1);
    const after = await viewStations(state, true);
    expect(after.list.find(s => s.id === id)).toEqual(before.list[0]);
    expect(after.defaults).toEqual(before.defaults); expect(after.active).toBe(before.active);
    const snapshot = structuredClone(after);
    // A stale name set refuses the complete transaction; no row or note is rewritten.
    expect(await addLotwStations(state, { ...backup, stations: [{ ...arriving, id: '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6c', name: 'Test third' }] }, ['Test existing'], 'not loaded')).toHaveProperty('problem');
    expect(await viewStations(state, true)).toEqual(snapshot);
  } finally { state.close(); }
});

it('QGD-LTW-0008: a failing second insert rolls back every arriving Location', async () => {
  const state = await openState(layout(root), resolve('drizzle/state'), '0.0.0-test');
  try {
    const saved = await saveStation(state, draft({}, { name: 'Test existing' }), 'not loaded');
    if (!saved.ok) throw new Error('Fixture refused');
    const before = await viewStations(state, true);
    const backup = { stations: [
      { id: '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b', name: 'Test arriving', place: { MY_GRIDSQUARE: 'DN13' } },
      { id: saved.id, name: 'Test duplicate id', place: { MY_GRIDSQUARE: 'DN13' } }
    ], defaults: {}, active: null };
    await expect(addLotwStations(state, backup, ['Test existing'], 'not loaded')).rejects.toThrow();
    expect(await viewStations(state, true)).toEqual(before);
  } finally { state.close(); }
});

it('refuses a case-only collision with an existing Location', async () => {
  const state = await openState(layout(root), resolve('drizzle/state'), '0.0.0-test');
  try {
    const saved = await saveStation(state, draft({}, { name: 'Home' }), 'not loaded');
    if (!saved.ok) throw new Error('Fixture refused');
    const before = await viewStations(state, true);
    const arriving = { id: '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b', name: 'HOME', place: { MY_GRIDSQUARE: 'DN13' } };
    expect(await addLotwStations(state, { stations: [arriving], defaults: {}, active: null }, ['Home'], 'not loaded')).toHaveProperty('problem');
    expect(await viewStations(state, true)).toEqual(before);
  } finally { state.close(); }
});

it('QGD-STN-0013: selected Differs appends through Sync and preserves the existing Location byte for byte', async () => {
  const { createTqslSync } = await import('../packages/main/tqsl-sync.js');
  const { backupStations, checkBackup } = await import('../packages/storage/stations.js');
  const state = await openState(layout(root), resolve('drizzle/state'), '0.0.0-test');
  try {
    const created = await saveStation(state, draft({}, { name: 'Test clash', notes: 'Test-only existing note' }), 'not loaded');
    if (!created.ok) throw new Error('Fixture refused');
    await setActiveStation(state, created.id);
    await setDefaultStation(state, '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6c', created.id);
    const before = await backupStations(state);
    const run = createTqslSync({
      core: async () => ({ folder: '/test-only/tqsl', locations: [{ name:'Test clash', place:{MY_GRIDSQUARE:'EM18'},park:'',reason:'',status:'differs',differences:[{field:'MY_GRIDSQUARE',tqsl:'EM18',stored:'DN13'}] }] }),
      existing: () => backupStations(state), check: async b => checkBackup(b, 'not loaded'),
      add: async (b,names) => { const result = await addLotwStations(state,b,names,'not loaded'); return typeof result === 'number' ? result : result.problem; },
      confirm: async plan => { expect(plan.locations[0]).toMatchObject({checked:false,resultName:'Test clash (TQSL)'}); return [0]; }
    });
    expect((await run()).added).toBe(1);
    const after = await backupStations(state);
    expect(after.stations.find(s => s.id === created.id)).toEqual(before.stations[0]);
    expect(after.stations.find(s => s.id !== created.id)).toMatchObject({name:'Test clash (TQSL)',place:{MY_GRIDSQUARE:'EM18'}});
    expect(after.defaults).toEqual(before.defaults); expect(after.active).toBe(before.active);
  } finally { state.close(); }
});
