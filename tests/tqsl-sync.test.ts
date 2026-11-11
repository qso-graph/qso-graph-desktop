// SPDX-License-Identifier: GPL-3.0-or-later
import { it, expect, vi } from 'vitest';
import { createTqslSync, type TqslSyncPorts } from '../packages/main/tqsl-sync.js';
import { checkBackup } from '../packages/storage/stations.js';
import { definitionsOf } from '../packages/reference/adif.js';
import { rulesetOf } from '../packages/reference/validate.js';
import { readFileSync } from 'node:fs';
import { createLotwDialogGate } from '../packages/main/lotw-log.js';
import { isLotwCommand, isTqslPreview } from '../packages/callsigns/lotw-contract.js';
import type { NativeTqslPreview } from '../packages/callsign-core/native.js';
import type { StationsBackup } from '../packages/storage/station-contract.js';
const id = '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b';
function harness() {
  const here: StationsBackup = { stations: [{ id, name: 'Test home', place: { MY_GRIDSQUARE: 'EM17' }, notes: 'test-only note' }, { id: '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6c', name: 'Test home (TQSL)', place: { MY_GRIDSQUARE: 'EM17' } }], defaults: {}, active: id };
  const p: NativeTqslPreview = { folder: '/test-only/tqsl', locations: [
    { name: 'Test park', place: { MY_GRIDSQUARE: 'EM18' }, park: 'NP01', reason: '', status: 'new', differences: [] },
    { name: 'Test home', place: { MY_GRIDSQUARE: 'EM18' }, park: '', reason: '', status: 'differs', differences: [{ field: 'MY_GRIDSQUARE', tqsl: 'EM18', stored: 'EM17' }] },
    { name: 'Test same', place: { MY_GRIDSQUARE: 'EM18' }, park: '', reason: '', status: 'same', differences: [] },
    { name: 'Test refused', place: {}, park: '', reason: 'Correct the grid in TQSL.', status: 'refused', differences: [] }
  ] };
  const ports: TqslSyncPorts = { core: vi.fn(async () => structuredClone(p)), existing: vi.fn(async () => here), check: vi.fn(async () => undefined), add: vi.fn(async backup => backup.stations.length), confirm: vi.fn(async plan => plan.locations.flatMap((l,i) => l.offered && l.checked ? [i] : [])) };
  return { here, p, ports, run: createTqslSync(ports) };
}
it('stages all statuses with fields, differences and names; only New is checked by default', async () => {
  const h = harness(); const before = structuredClone(h.here);
  const result = await h.run();
  expect(result.added).toBe(1);
  expect(result.locations.map(l => [l.status, l.offered, l.checked])).toEqual([['new',true,true],['differs',true,false],['same',false,false],['refused',false,false]]);
  expect(result.locations[1]).toMatchObject({ resultName: 'Test home (TQSL) 2', differences: [{ field: 'MY_GRIDSQUARE', tqsl: 'EM18', stored: 'EM17' }] });
  expect(h.ports.confirm).toHaveBeenCalledWith({ folder: '/test-only/tqsl', locations: result.locations }, undefined);
  expect(h.ports.add).toHaveBeenCalledWith({ stations: [expect.objectContaining({ name: 'Test park', lotwPark: 'NP01', place: { MY_GRIDSQUARE: 'EM18' } })], defaults: {}, active: null }, ['Test home','Test home (TQSL)']);
  expect(h.here).toEqual(before);
  expect(h.ports.core).toHaveBeenCalledWith({ op: 'syncInspect', existing: before.stations.map(s => ({ name: s.name, place: s.place, park: '' })) });
});
it('a selected Differs creates a new identity and never overwrites the existing Location', async () => {
  const h = harness(); const before = structuredClone(h.here);
  h.ports.confirm = vi.fn(async () => [1]);
  expect((await h.run()).added).toBe(1);
  const saved = vi.mocked(h.ports.add).mock.calls[0][0].stations[0];
  expect(saved.id).not.toBe(id); expect(saved.name).toBe('Test home (TQSL) 2');
  expect(saved.place).toEqual({ MY_GRIDSQUARE: 'EM18' });
  expect(h.here).toEqual(before);
});
it('Cancel saves nothing', async () => {
  const h = harness(); h.ports.confirm = vi.fn(async () => undefined);
  expect((await h.run()).status).toBe('cancelled'); expect(h.ports.add).not.toHaveBeenCalled();
});
it('Desktop validation refuses candidates before confirmation', async () => {
  const h = harness(); h.ports.check = vi.fn(async () => 'test-only refusal');
  const result = await h.run();
  expect(result.locations.filter(l => l.offered)).toEqual([]);
  expect(result.locations[0].status).toBe('refused'); expect(h.ports.add).not.toHaveBeenCalled();
  expect(result.locations[0].reason).toBe('test-only refusal');
});
it.each([{}, { MY_GRIDSQUARE: 'INVALID' }])('preserves the missing-grid or invalid-ADIF refusal: %j', async place => {
  const h = harness();
  const register = JSON.parse(readFileSync('data/reference-sources.json', 'utf8'));
  const rules = rulesetOf(definitionsOf(JSON.parse(readFileSync(`vendor/adif/${register.adif.version}/${register.adif.source.definitions}`, 'utf8'))));
  h.p.locations = [{ ...h.p.locations[0], place }];
  h.ports.check = vi.fn(async b => checkBackup(b, rules));
  const result = await h.run();
  const checked = vi.mocked(h.ports.check).mock.results[0];
  expect(result.locations[0]).toMatchObject({ status: 'refused', offered: false, checked: false, reason: await checked.value });
  expect(result.locations[0].reason).not.toBe('The place fields do not pass Desktop Location checks.');
  expect(h.ports.add).not.toHaveBeenCalled();
});
it('only one dialog is open, including restore/sign via the shared gate', async () => {
  const h = harness(); let answer: (value: number[] | undefined) => void = () => {};
  h.ports.confirm = vi.fn(() => new Promise(resolve => { answer = resolve; }));
  const gate = createLotwDialogGate(); const pending = gate(() => h.run());
  await vi.waitFor(() => expect(h.ports.confirm).toHaveBeenCalledOnce());
  await expect(h.run()).rejects.toThrow('Finish'); await expect(gate(async () => 'restore')).rejects.toThrow('Finish');
  answer(undefined); await pending; expect(await gate(async () => 'restore')).toBe('restore');
});
it('abort cleans up a held confirmation and ignores late selected rows', async () => {
  const h = harness(); const controller = new AbortController(); let answer: (value: number[]) => void = () => {};
  h.ports.confirm = vi.fn(() => new Promise(resolve => { answer = resolve; }));
  const pending = h.run(controller.signal);
  await vi.waitFor(() => expect(h.ports.confirm).toHaveBeenCalledOnce());
  controller.abort(); expect((await pending).status).toBe('cancelled'); answer([0,1]); await Promise.resolve();
  expect(h.ports.add).not.toHaveBeenCalled(); h.ports.confirm = vi.fn(async () => []);
  expect((await h.run()).status).toBe('completed');
});
it('abort waits for a late inspection and offers or saves nothing', async () => {
  const h = harness(); const controller = new AbortController(); let answer: (value: NativeTqslPreview) => void = () => {};
  h.ports.core = vi.fn(() => new Promise(resolve => { answer = resolve; }));
  const pending = h.run(controller.signal);
  await vi.waitFor(() => expect(h.ports.core).toHaveBeenCalledOnce()); controller.abort(); answer(h.p);
  expect((await pending).status).toBe('cancelled'); expect(h.ports.confirm).not.toHaveBeenCalled(); expect(h.ports.add).not.toHaveBeenCalled();
});
it('refuses invalid selected indices, forged preview and storage failure', async () => {
  for (const selected of [[2], [3], [0,0], [-1], [99]]) {
    const h = harness(); h.ports.confirm = vi.fn(async () => selected);
    await expect(h.run()).rejects.toThrow(); expect(h.ports.add).not.toHaveBeenCalled();
  }
  const h = harness(); h.ports.core = vi.fn(async () => ({ ...h.p, bytes: 'test-only file contents' }));
  await expect(h.run()).rejects.toThrow(); expect(h.ports.confirm).not.toHaveBeenCalled();
  const stale = harness(); stale.ports.add = vi.fn(async () => 'names changed'); await expect(stale.run()).rejects.toThrow('Locations changed');
});
it('Sync core boundary accepts only bounded public Location fields and no folder override', () => {
  const h = harness(); expect(isTqslPreview(h.p)).toBe(true);
  expect(isLotwCommand({ op:'syncInspect', existing: [] })).toBe(true);
  for (const command of [{ op:'syncInspect', existing: [], path:'/test-only' }, { op:'syncInspect', existing: Array(501).fill({}) }, { op:'syncInspect', existing:[{name:'Test',place:{MY_STREET:'private'},park:''}] }]) expect(isLotwCommand(command)).toBe(false);
  for (const patch of [{ locations:[{...h.p.locations[0], place:{MY_STREET:'private'}}] }, { locations:[{...h.p.locations[0], status:'unexpected'}] }]) expect(isTqslPreview({...h.p,...patch})).toBe(false);
});
