// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, it, expect, vi } from 'vitest';
import { createLotwManage, type LotwManagePorts } from '../packages/main/lotw-manage.js';
import { isLotwCommand, isLotwPreview, isLotwSummary } from '../packages/callsigns/lotw-contract.js';
import { validateServiceCommand, validateCommand } from '../packages/callsigns/callsign-contract.js';
import { isLotwManageReply, isLotwManageResult, validateRequest } from '../packages/extension-api/api-contract.js';
import { plainRequest } from '../packages/extension-api/plain.js';
import type { NativeLotwPreview } from '../packages/callsign-core/native.js';
import { validateRendererStorageCommand, validateStorageCommand } from '../packages/storage/storage-contract.js';
import { lotwLocations } from '../packages/main/lotw-locations.js';
const token = '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b';
const entry = { call: 'QG0TEST', serial: 'AB12', disposition: 'new' as const, reason: '', fileHasKey: true, keyPresent: false, needsPassword: false, dxcc: 291, qsoFirst: '2020-01-01', qsoLast: '2030-01-01', validFrom: '2020-01-01T00:00:00Z', validTo: '2030-01-01T00:00:00Z' };
const preview = (): NativeLotwPreview => ({ token, needsPassword: false, certificates: [{...entry}], roots: [], locations: [], signedQsos: 4, signedQsoBytes: 64 });
const location = { name: 'Test location', place: { MY_DXCC: '291', MY_GRIDSQUARE: 'DN13tp', MY_STATE: 'ID', MY_CNTY: 'ID,Ada' }, park: 'NP33', reason: '' };
function harness() {
  const p = preview();
  const ports: LotwManagePorts = {
    core: vi.fn(async c => {
      if (c.op === 'cancel') return null;
      if (c.op === 'commit') return { status: 'completed', certificates: p.certificates, roots: 0, signedQsos: 4, deleted: 0 };
      if (c.op === 'unlock') { p.needsPassword = false; p.certificates[c.index].needsPassword = false; }
      return structuredClone(p);
    }),
    choose: vi.fn(async () => '/test-only/input.tbk'), password: vi.fn(async () => 'test-only-password'),
    confirm: vi.fn(async () => ({ accepted: true, locations: true })),
    existing: vi.fn(async () => ({ stations: [], defaults: {}, active: null })), check: vi.fn(async () => undefined), add: vi.fn(async b => b.stations.length)
  };
  return { p, ports, run: createLotwManage(ports) };
}
describe('lotw:manage boundary (QGD-LTW-0002/0004/0005, QGD-INV-0001/0004/0017)', () => {
  it('takes a conflict only as the core\'s structured result, carrying nothing else, and validates it at each boundary', async () => {
    const conflict = { status: 'conflict', certificates: [], roots: 0, signedQsos: 0, deleted: 0 };
    expect(isLotwSummary(conflict)).toBe(true);
    for (const patch of [{ deleted: 1 }, { roots: 1 }, { signedQsos: 1 }, { certificates: [{}] }, { error: 'arbitrary' }, { status: 'refused' }]) {
      expect(isLotwSummary({ ...conflict, ...patch }), JSON.stringify(patch)).toBe(false);
    }
    const h = harness();
    const result = { ...await h.run({ kind: 'lotw.import' }), status: 'conflict', certificates: [], signedQsos: 0 };
    expect(isLotwManageResult(result)).toBe(true);
    expect(isLotwManageReply({ ok: true, kind: 'lotw.delete', result }, 'lotw.delete')).toBe(true);
    for (const patch of [{ status: 'unknown' }, { error: 'arbitrary' }, { deleted: 1 }, { locations: 1 }]) {
      expect(isLotwManageResult({ ...result, ...patch })).toBe(false);
      expect(isLotwManageReply({ ok: true, kind: 'lotw.delete', result: { ...result, ...patch } }, 'lotw.delete')).toBe(false);
    }
  });
  it('accepts only exact request fields, including through plain reconstruction', () => {
    for (const request of [{ kind: 'lotw.import' }, { kind: 'lotw.restore' }, { kind: 'lotw.delete', certificate: 'cert:' + token }]) {
      expect(validateRequest(request)).toEqual(request);
      expect(plainRequest(request as never)).toEqual(request);
      for (const field of ['path', 'bytes', 'password', 'confirmed', 'token']) {
        expect(() => validateRequest({ ...request, [field]: 'planted' })).toThrow();
        expect(() => plainRequest({ ...request, [field]: 'planted' } as never)).toThrow();
      }
    }
    for (const certificate of ['', 1, 'QG0TEST', '/test-only/file', null]) expect(() => validateRequest({ kind: 'lotw.delete', certificate })).toThrow();
  });
  it('keeps privileged commands out of renderer and checks all core commands exactly', () => {
    for (const command of [{ op: 'inspect', path: '/test-only/file.p12', format: 'certificate' }, { op: 'inspectDelete', certificate: 'cert:' + token }, { op: 'unlock', token, index: 0, password: '' }, { op: 'commit', token }, { op: 'cancel', token }]) {
      expect(isLotwCommand(command)).toBe(true);
      expect(isLotwCommand({ ...command, extra: true })).toBe(false);
      expect(validateServiceCommand({ type: 'lotw-manage', command }, new Set())).toBe(true);
      expect(validateCommand({ type: 'lotw-manage', command }, new Set())).toBe(false);
    }
    expect(isLotwCommand({ op: 'unlock', token, index: -1, password: '' })).toBe(false);
    expect(isLotwCommand({ op: 'unlock', token, index: 0, password: 'é'.repeat(513) })).toBe(false);
    expect(isLotwPreview({ ...preview(), key: 'planted' })).toBe(false);
  });
  it('QGD-LTW-0012: exact nested replies refuse secrets and file contents', async () => {
    const h = harness(); const result = await h.run({ kind: 'lotw.import' });
    expect(isLotwManageReply({ ok: true, kind: 'lotw.import', result }, 'lotw.import')).toBe(true);
    expect(isLotwManageReply({ ok: true, kind: 'lotw.import', result }, 'lotw.restore')).toBe(false);
    for (const key of ['key', 'password', 'email', 'bytes']) {
      expect(isLotwManageReply({ ok: true, kind: 'lotw.import', result: { ...result, [key]: 'planted' } }, 'lotw.import')).toBe(false);
      expect(isLotwManageReply({ ok: true, kind: 'lotw.import', result: { ...result, certificates: [{ ...result.certificates[0], [key]: 'planted' }] } }, 'lotw.import')).toBe(false);
    }
    const json = JSON.stringify(result);
    for (const secret of ['test-only-password', '/test-only', 'fileHasKey', 'needsPassword', 'token', 'email', 'PRIVATE KEY', 'bytes']) expect(json).not.toContain(secret);
  });
});
describe('operator-owned sequence (QGD-LTW-0003/0004/0005)', () => {
  it('cancels file selection without touching credential core', async () => {
    const h = harness(); h.ports.choose = vi.fn(async () => undefined);
    expect((await h.run({ kind: 'lotw.import' })).status).toBe('cancelled');
    expect(h.ports.core).not.toHaveBeenCalled();
  });
  it('drops the pending plan on confirmation cancellation and prompts once', async () => {
    const h = harness(); h.ports.confirm = vi.fn(async () => ({ accepted: false, locations: false }));
    expect((await h.run({ kind: 'lotw.restore' })).status).toBe('cancelled');
    expect(h.ports.core).toHaveBeenCalledWith({ op: 'cancel', token });
    expect(h.ports.core).not.toHaveBeenCalledWith({ op: 'commit', token });
    expect(h.ports.confirm).toHaveBeenCalledTimes(1);
    expect(h.ports.add).not.toHaveBeenCalled();
  });
  it('asks twice by call and serial for separately protected backup keys, skips installed keys', async () => {
    const h = harness(); h.p.certificates = [{ ...entry, needsPassword: true }, { ...entry, call: 'QG1TEST', serial: 'BB34', needsPassword: true }, { ...entry, disposition: 'present', keyPresent: true }];
    await h.run({ kind: 'lotw.restore' });
    expect(h.ports.password).toHaveBeenNthCalledWith(1, 'Unlock QG0TEST, serial AB12', undefined);
    expect(h.ports.password).toHaveBeenNthCalledWith(2, 'Unlock QG1TEST, serial BB34', undefined);
    expect(h.ports.password).toHaveBeenCalledTimes(2);
    expect(h.ports.confirm).toHaveBeenCalledTimes(1);
  });
  it('asks for a protected p12 before preview confirmation', async () => {
    const h = harness(); h.p.needsPassword = true;
    await h.run({ kind: 'lotw.import' });
    expect(h.ports.password).toHaveBeenCalledTimes(1);
    expect(h.ports.core).toHaveBeenCalledWith({ op: 'unlock', token, index: 0, password: 'test-only-password' });
    expect(vi.mocked(h.ports.password).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(h.ports.confirm).mock.invocationCallOrder[0]);
    expect(vi.mocked(h.ports.core).mock.invocationCallOrder[1]).toBeLessThan(vi.mocked(h.ports.confirm).mock.invocationCallOrder[0]);
  });
  it('refuses wrong passwords and drops the plan without confirming or committing', async () => {
    const h = harness(); h.p.certificates[0].needsPassword = true;
    const core = h.ports.core;
    h.ports.core = vi.fn(async c => { if (c.op === 'unlock') throw new Error('Refused'); return core(c); });
    await expect(h.run({ kind: 'lotw.restore' })).rejects.toThrow();
    expect(h.ports.confirm).not.toHaveBeenCalled();
    expect(h.ports.core).toHaveBeenCalledWith({ op: 'cancel', token });
    expect(h.ports.core).not.toHaveBeenCalledWith({ op: 'commit', token });
  });
  it('cancels a password prompt without committing', async () => {
    const h = harness(); h.p.certificates[0].needsPassword = true; h.ports.password = vi.fn(async () => undefined);
    expect((await h.run({ kind: 'lotw.restore' })).status).toBe('cancelled');
    expect(h.ports.core).toHaveBeenCalledWith({ op: 'cancel', token });
    expect(h.ports.confirm).not.toHaveBeenCalled();
  });
  it('inspects deletion by certificate id and commits only after confirmation', async () => {
    const h = harness(); await h.run({ kind: 'lotw.delete', certificate: 'cert:' + token });
    expect(h.ports.choose).not.toHaveBeenCalled();
    expect(h.ports.core).toHaveBeenNthCalledWith(1, { op: 'inspectDelete', certificate: 'cert:' + token });
    expect(h.ports.core).toHaveBeenLastCalledWith({ op: 'commit', token });
    expect(h.ports.confirm).toHaveBeenCalledWith('', expect.anything(), [], [], true, undefined);
    expect(vi.mocked(h.ports.confirm).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(h.ports.core).mock.invocationCallOrder[1]);
  });
});
describe('QGD-LTW-0008, QGD-STN-0008/0009: Desktop Locations', () => {
  it('maps TQSL fields and names collisions without changing existing Locations', () => {
    const existing = ['Test location', 'Test location (TQSL)', 'Test location (TQSL) 2'];
    const before = structuredClone(existing);
    const plan = lotwLocations([location], existing);
    expect(existing).toEqual(before);
    expect(plan.stations[0]).toMatchObject({ name: 'Test location (TQSL) 3', place: { MY_GRIDSQUARE: 'DN13tp', MY_DXCC: '291', MY_CNTY: 'ID,Ada', MY_STATE: 'ID' }, lotwPark: 'NP33' });
    expect(plan.stations[0].place).not.toHaveProperty('STATION_CALLSIGN');
  });
  it.each([true, false])('creates Locations only when operator accepts: %s', async selected => {
    const h = harness(); h.p.locations = [location]; h.ports.confirm = vi.fn(async () => ({ accepted: true, locations: selected }));
    const result = await h.run({ kind: 'lotw.restore' });
    expect(result.locations).toBe(selected ? 1 : 0);
    expect(h.ports.add).toHaveBeenCalledTimes(selected ? 1 : 0);
    expect(result.skippedLocations.length).toBe(selected ? 0 : 1);
  });
  it('shows final clash names in confirmation and reports storage failure after successful trust commit', async () => {
    const h = harness(); h.p.locations = [location]; h.ports.existing = async () => ({ stations: [{ id: token, name: location.name, place: { MY_GRIDSQUARE: 'DN13' } }], defaults: {}, active: null });
    h.ports.add = async () => { throw new Error('private database path'); };
    const result = await h.run({ kind: 'lotw.restore' });
    expect(h.ports.confirm).toHaveBeenCalledWith('input.tbk', expect.anything(), [expect.objectContaining({ name: 'Test location (TQSL)' })], [], false, undefined);
    expect(result).toMatchObject({ status: 'completed', signedQsos: 4, locations: 0, skippedLocations: [{ name: 'Test location (TQSL)' }] });
    expect(JSON.stringify(result)).not.toContain('private database path');
  });
});

it('QGD-LTW-0003: the window cannot bypass confirmation with the additive storage command', () => {
  const command = { type: 'stations-add-lotw', backup: { stations: [], defaults: {}, active: null }, expectedNames: [] };
  expect(validateStorageCommand(command)).toBe(true);
  expect(validateRendererStorageCommand(command)).toBe(false);
  expect(validateRendererStorageCommand({ type: 'stations-backup' })).toBe(true);
});


it('QGD-LTW-0003/0005: a failed inspection without a token queues discard before another request', async () => {
  const h = harness(); const calls: string[] = [];
  h.ports.core = async command => { calls.push(command.op); if (command.op === 'inspect') throw new Error('Test-only timeout'); return null; };
  await expect(h.run({ kind: 'lotw.import' })).rejects.toThrow();
  expect(calls).toEqual(['inspect', 'discard']);
  expect(h.ports.confirm).not.toHaveBeenCalled();
});
it('QGD-LTW-0003/0005: skips passwords for refused backup entries and confirms their refusal', async () => {
  const h = harness();
  h.p.certificates.push({ ...entry, call: 'QG1TEST', disposition: 'refused', reason: 'Certificate refused', needsPassword: true });
  const result = await h.run({ kind: 'lotw.restore' });
  expect(h.ports.password).not.toHaveBeenCalled();
  expect(result.certificates[1]).toEqual({ call: 'QG1TEST', serial: 'AB12', disposition: 'refused', reason: 'Certificate refused' });
  expect(h.ports.confirm).toHaveBeenCalledTimes(1);
});
it('QGD-LTW-0002: certificate IDs are the exact cert: IDs returned by QG Trust; tokens cannot name a certificate', () => {
  expect(() => validateRequest({ kind: 'lotw.delete', certificate: token })).toThrow();
  expect(isLotwCommand({ op: 'inspectDelete', certificate: token })).toBe(false);
  expect(validateRequest({ kind: 'lotw.delete', certificate: 'cert:' + token })).toEqual({ kind: 'lotw.delete', certificate: 'cert:' + token });
  expect(isLotwCommand({ op: 'inspectDelete', certificate: 'cert:' + token })).toBe(true);
  expect(isLotwCommand({ op: 'commit', token: 'cert:' + token })).toBe(false);
  expect(isLotwCommand({ op: 'discard' })).toBe(true);
  expect(isLotwCommand({ op: 'discard', token })).toBe(false);
});

it('refuses before committing when Location names changed during confirmation', async () => {
  const h = harness(); h.p.locations = [location];
  h.ports.existing = vi.fn().mockResolvedValueOnce({ stations: [], defaults: {}, active: null }).mockResolvedValue({ stations: [{ id: token, name: 'New', place: { MY_GRIDSQUARE: 'DN13' } }], defaults: {}, active: null });
  await expect(h.run({ kind: 'lotw.restore' })).rejects.toThrow();
  expect(h.ports.core).not.toHaveBeenCalledWith({ op: 'commit', token });
  expect(h.ports.core).toHaveBeenCalledWith({ op: 'cancel', token });
  expect(h.ports.add).not.toHaveBeenCalled();
});
it('suffixes Location names that collide regardless of case', () => {
  expect(lotwLocations([{ ...location, name: 'HOME' }], ['Home']).stations[0].name).toBe('HOME (TQSL)');
});

it.each(['choose', 'password', 'confirm'] as const)('aborting %s ignores a late answer, cancels any plan and releases main', async prompt => {
  const h = harness(); const stop = new AbortController();
  let finish: (value: any) => void = () => {};
  const held = vi.fn(() => new Promise<any>(resolve => { finish = resolve; }));
  if (prompt === 'password') h.p.needsPassword = true;
  const original = h.ports[prompt]; h.ports[prompt] = held;
  let result: unknown;
  const pending = h.run({ kind: 'lotw.import' }, stop.signal).then(value => { result = value; });
  await vi.waitFor(() => expect(held).toHaveBeenCalledOnce());
  stop.abort();
  await vi.waitFor(() => expect(result).toMatchObject({ status: 'cancelled' }));
  await pending;
  if (prompt !== 'choose') expect(h.ports.core).toHaveBeenCalledWith({ op: 'cancel', token });
  expect(h.ports.core).not.toHaveBeenCalledWith({ op: 'commit', token });
  finish(prompt === 'confirm' ? { accepted: true, locations: true } : prompt === 'choose' ? '/test-only/late.p12' : 'test-only-late-password');
  await Promise.resolve(); await Promise.resolve();
  expect(h.ports.core).not.toHaveBeenCalledWith({ op: 'commit', token });
  h.ports[prompt] = original;
  expect((await h.run({ kind: 'lotw.import' })).status).toBe('completed');
});

it('keeps confirmation closed until the password and unlock have completed', async () => {
  const h = harness(); h.p.needsPassword = true;
  let answer: (password: string) => void = () => {};
  h.ports.password = vi.fn(() => new Promise(resolve => { answer = resolve; }));
  const pending = h.run({ kind: 'lotw.import' });
  await vi.waitFor(() => expect(h.ports.password).toHaveBeenCalledOnce());
  expect(h.ports.confirm).not.toHaveBeenCalled();
  expect(h.ports.core).not.toHaveBeenCalledWith({ op: 'commit', token });
  answer('test-only-password');
  expect((await pending).status).toBe('completed');
  expect(h.ports.confirm).toHaveBeenCalledOnce();
});

it('delete waits for confirmation and cancellation reaches the core without committing', async () => {
  const h = harness();
  let answer: (decision: { accepted: boolean; locations: boolean }) => void = () => {};
  h.ports.confirm = vi.fn(() => new Promise(resolve => { answer = resolve; }));
  const pending = h.run({ kind: 'lotw.delete', certificate: 'cert:' + token });
  await vi.waitFor(() => expect(h.ports.confirm).toHaveBeenCalledOnce());
  expect(h.ports.core).not.toHaveBeenCalledWith({ op: 'commit', token });
  answer({ accepted: false, locations: false });
  expect((await pending).status).toBe('cancelled');
  expect(h.ports.core).toHaveBeenCalledWith({ op: 'cancel', token });
  expect(h.ports.core).not.toHaveBeenCalledWith({ op: 'commit', token });
});

it.each(['inspect', 'unlock'] as const)('aborting during %s cleans up its late plan before another operation starts', async operation => {
  const h = harness(); h.p.needsPassword = operation === 'unlock';
  const stop = new AbortController(); const core = h.ports.core;
  let finish: () => void = () => {};
  const held = new Promise<void>(resolve => { finish = resolve; });
  h.ports.core = vi.fn(async command => {
    if (command.op === operation) await held;
    return core(command);
  });
  const pending = h.run({ kind: 'lotw.import' }, stop.signal);
  await vi.waitFor(() => expect(h.ports.core).toHaveBeenCalledWith(expect.objectContaining({ op: operation })));
  stop.abort(); finish();
  expect((await pending).status).toBe('cancelled');
  expect(h.ports.confirm).not.toHaveBeenCalled();
  expect(h.ports.core).toHaveBeenLastCalledWith({ op: 'cancel', token });
  expect(h.ports.core).not.toHaveBeenCalledWith({ op: 'commit', token });
  expect((await h.run({ kind: 'lotw.import' })).status).toBe('completed');
});
