// SPDX-License-Identifier: GPL-3.0-or-later
// The real LoTW extension, host channel, supervisor and grant-checked broker
// serving path. Credential core and dialogs are fakes; no credential store,
// file or connection is used (QGD-HOM-0018–0020, QGD-LTW-0002).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MessageChannel, type MessagePort } from 'node:worker_threads';
import { describe, expect, it, vi } from 'vitest';
import { activate, unreadable } from '../extensions/lotw/src/main.js';
import { validateGrantRegister } from '../packages/extension-api/grants.js';
import { pageRowKeys } from '../packages/extension-api/actions.js';
import { createHostRuntime } from '../packages/extension-host/runtime.js';
import type { Port } from '../packages/extension-host/protocol.js';
import { createSupervisor, type HostLink } from '../packages/main/extension-host-supervisor.js';
import { createServe, type ExtensionBrokerPorts } from '../packages/main/extension-serve.js';
import { loadExtensions } from '../packages/main/extension-runtime.js';
import { createLotwManage } from '../packages/main/lotw-manage.js';
import { createPageActions } from '../packages/main/page-actions.js';
import { createPageScheduler, type CataloguePage } from '../packages/main/page-scheduler.js';
import { parseLimits } from '../packages/main/extension-limits.js';
import type { NativeLotwCommand, NativeLotwPreview } from '../packages/callsign-core/native.js';
const token = '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b';
const certificate = { id: 'cert:' + token, call: 'QG0TEST', dxcc: 291, dxccName: null, serial: 'AB12', qsoFirst: '2020-01-01', qsoLast: '2030-01-01', validFrom: '2020-01-01T00:00:00Z', validTo: '2030-01-01T00:00:00Z', hasKey: true };
const entry = { call: certificate.call, serial: certificate.serial, disposition: 'delete' as const, reason: '', fileHasKey: false, keyPresent: true, needsPassword: false, dxcc: certificate.dxcc, qsoFirst: certificate.qsoFirst, qsoLast: certificate.qsoLast, validFrom: certificate.validFrom, validTo: certificate.validTo };
const preview: NativeLotwPreview = { token, needsPassword: false, certificates: [entry], roots: [], locations: [], signedQsos: 0, signedQsoBytes: 0 };
const adapt = (port: MessagePort): Port => ({ post: value => port.postMessage(value), onMessage: listener => { port.on('message', listener); }, close: () => port.close() });
const manifest = JSON.parse(readFileSync(join('extensions', 'lotw', 'manifest.json'), 'utf8'));
const register = validateGrantRegister(JSON.parse(readFileSync(join('data', 'extension-grants.json'), 'utf8')));
const limits = parseLimits(JSON.parse(readFileSync(join('data', 'extension-limits.json'), 'utf8')));

function harness(commitFailure?: Error | 'conflict') {
  let currentCertificate = certificate;
  let offset = 0;
  let hold = false;
  const held: (() => void)[] = [];
  const settled: { accepted: boolean }[] = [];
  let deleted = false;
  let confirm!: (answer: { accepted: boolean; locations: boolean }) => void;
  let allowed: Record<string, readonly string[]> = {};
  const dialogs = { choose: vi.fn(async () => join('test-only', 'input.p12')), password: vi.fn(), confirm: vi.fn(() => new Promise<{ accepted: boolean; locations: boolean }>(resolve => { confirm = resolve; })) };
  const nativeCore = (command: NativeLotwCommand) => {
    if (command.op === 'inspectDelete' || command.op === 'inspect') return structuredClone(preview);
    if (command.op === 'cancel') return null;
    if (command.op === 'commit' && commitFailure === 'conflict') return { status: 'conflict', certificates: [], roots: 0, signedQsos: 0, deleted: 0 };
    if (command.op === 'commit' && commitFailure) throw commitFailure;
    if (command.op === 'commit') { deleted = true; return { status: 'completed', certificates: [entry], roots: 0, signedQsos: 0, deleted: 1 }; }
    throw new Error('Unexpected credential-core command');
  };
  const core = vi.fn(async (command: NativeLotwCommand) => JSON.parse(JSON.stringify(nativeCore(command))));
  const manage = createLotwManage({ ...dialogs, core, existing: vi.fn(), check: vi.fn(), add: vi.fn() });
  const reads = vi.fn(async () => deleted ? [] : [currentCertificate]);
  const ports = { allowed: () => allowed, lotwCertificates: reads, lotwRoots: async () => [], lotwManage: manage } as unknown as ExtensionBrokerPorts;
  const loaded = loadExtensions([{ source: join('extensions', 'lotw', 'manifest.json'), value: manifest, shipped: true }], register, {});
  expect(loaded.refused).toEqual([]);
  const serve = createServe({ register, sources: {}, ports, extensions: loaded.loaded, refused: [], log: { warn: () => {} } });
  const requests: unknown[] = [];
  const hostPorts: MessagePort[] = [];
  let crashHost: () => void = () => {};
  const sup = createSupervisor({
    limits, log: { info: () => {}, warn: () => {} },
    describe: id => id === 'lotw' ? {
      entry: join('extensions', 'lotw', 'main.js'), pages: ['certificates', 'roots'],
      pageActions: Object.fromEntries(manifest.contributes.pages.map((page: { id: string; actions?: unknown; rowActions?: unknown }) => [page.id, { actions: page.actions ?? [], rowActions: page.rowActions ?? [] }]))
    } : undefined,
    serve: (id, request, signal) => { requests.push(request); return serve(id, request, signal); },
    channel: () => { const { port1, port2 } = new MessageChannel(); hostPorts.push(port2); const broker = adapt(port1); return { broker: { ...broker, post: value => { if ((value as { type?: string }).type === 'page-settled') settled.push(value as { accepted: boolean }); broker.post(value); } }, transfer: port2 }; },
    spawn: () => {
      const listeners: ((message: unknown) => void)[] = [];
      const runtime = createHostRuntime({ importModule: async () => ({ activate }), toBroker: message => queueMicrotask(() => listeners.forEach(listener => listener(message))) });
      return {
        post: (message, transfer) => queueMicrotask(() => {
          const port = transfer ? adapt(transfer as MessagePort) : undefined;
          runtime.receive(message, port ? { ...port, post: value => {
            if (hold && (value as { type?: string }).type === 'page-answer') held.push(() => port.post(value));
            else port.post(value);
          } } : undefined);
        }),
        onMessage: listener => { listeners.push(listener); }, onExit: listener => { crashHost = listener; }, kill: () => { for (const port of hostPorts) port.close(); }
      } satisfies HostLink;
    }
  });
  let open: string | null = 'lotw/certificates';
  const page: CataloguePage = { ...manifest.contributes.pages[0], key: 'lotw/certificates', extension: 'lotw', page: 'certificates', extensionName: 'LoTW', icon: 'extension', rail: true, inputs: [] };
  const scheduler = createPageScheduler({ catalogue: () => [page], pins: () => open ? [open] : [], page: (...args) => sup.page(...args), publish: () => {}, now: () => Date.now() + offset });
  const actions = createPageActions({
    current: () => {
      if (!open) return undefined;
      const view = scheduler.views()[0];
      return { key: open, page, answer: view?.state === 'ready' ? view.answer : undefined };
    },
    run: (id, event) => sup.action(id, event), refresh: key => scheduler.actionCompleted(key)
  });
  let stops = 0;
  sup.onChange(status => {
    if (status.host === 'running' && status.stops > stops) { stops = status.stops; scheduler.actionCompleted('lotw/certificates'); }
  });
  scheduler.setVisible(true);
  return { sup, scheduler, actions, held, settled,
    holdRefresh: () => { currentCertificate = { ...certificate, id: 'cert:4f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b' }; hold = true; offset += 10_001; expect(scheduler.refreshNow(page.key)).toBe(true); },
    deliver: () => { hold = false; for (const send of held.splice(0)) send(); }, crash: () => crashHost(), requests, core, dialogs, reads, confirm: (accepted: boolean) => confirm({ accepted, locations: false }),
    withdraw: () => { allowed = { lotw: ['lotw:read'] }; },
    close: () => { open = null; sup.closePage('lotw', 'certificates'); scheduler.changed(); },
    reopen: () => { open = 'lotw/certificates'; sup.showPage('lotw', 'certificates'); scheduler.changed(); },
    stop: () => { scheduler.stop(); sup.stop(); for (const port of hostPorts) port.close(); } };
}
const event = { page: 'certificates', action: 'delete', row: certificate.id };
const ready = async (h: ReturnType<typeof harness>) => vi.waitFor(() => expect(h.scheduler.views()[0]?.state).toBe('ready'));

describe('a LoTW row press through the real extension channel', () => {
  it('produces exactly one delete request, confirms in core, and refreshes inside the read interval', async () => {
    const h = harness();
    try {
      await ready(h);
      // A cached page remains actionable when reopened without another read.
      h.close();
      expect((await h.actions.press('lotw/certificates', event)).ok).toBe(false);
      expect((await h.sup.action('lotw', event)).ok).toBe(false);
      h.reopen();
      const pressed = h.actions.press('lotw/certificates', event);
      await vi.waitFor(() => expect(h.dialogs.confirm).toHaveBeenCalledTimes(1));
      expect(h.actions.state('lotw/certificates')?.running).toBe(true);
      expect((await h.actions.press('lotw/certificates', event)).ok).toBe(false);
      expect((await h.sup.action('lotw', event)).ok).toBe(false);
      expect(h.requests.filter(r => typeof r === 'object' && r !== null && 'kind' in r && r.kind === 'lotw.delete')).toEqual([{ kind: 'lotw.delete', certificate: certificate.id }]);
      expect(h.core).toHaveBeenCalledExactlyOnceWith({ op: 'inspectDelete', certificate: certificate.id });
      expect(h.dialogs.choose).not.toHaveBeenCalled(); expect(h.dialogs.password).not.toHaveBeenCalled();
      h.confirm(true);
      expect(await pressed).toEqual({ ok: true, status: 'Deleted 1 certificate(s).' });
      await vi.waitFor(() => expect(h.reads).toHaveBeenCalledTimes(2));
      await vi.waitFor(() => expect(h.scheduler.views()[0]).toMatchObject({ state: 'ready', answer: { ok: true, data: { sections: [{ shape: 'text', text: expect.stringContaining('No LoTW certificates') }] } } }));
      expect(h.core.mock.calls.map(([command]) => command.op)).toEqual(['inspectDelete', 'commit']);
      expect((await h.actions.press('lotw/certificates', event)).ok).toBe(false);
      expect(h.requests.filter(r => typeof r === 'object' && r !== null && 'kind' in r && r.kind === 'lotw.delete')).toHaveLength(1);
    } finally { h.stop(); }
  });
  it('can act on the first press after disable/enable and host recovery with fresh issued keys', async () => {
    const h = harness();
    try {
      await ready(h);
      h.close();
      await h.sup.setEnabled('lotw', false);
      h.scheduler.actionCompleted('lotw/certificates');
      await h.sup.setEnabled('lotw', true);
      h.reopen();
      await vi.waitFor(() => expect(h.reads).toHaveBeenCalledTimes(2));
      await ready(h);
      let pressed = h.actions.press('lotw/certificates', event);
      await vi.waitFor(() => expect(h.dialogs.confirm).toHaveBeenCalledTimes(1));
      h.confirm(false); expect((await pressed).ok).toBe(true);
      await vi.waitFor(() => expect(h.reads).toHaveBeenCalledTimes(3));
      const acknowledged = h.settled.length;
      h.crash();
      await vi.waitFor(() => expect(h.reads).toHaveBeenCalledTimes(4), { timeout: 5_000 });
      // A read starting is not an accepted answer. The cached view stays
      // ready during recovery, so wait for this generation's acknowledgment.
      await vi.waitFor(() => expect(h.settled.slice(acknowledged)).toContainEqual(expect.objectContaining({ accepted: true })));
      await ready(h);
      pressed = h.actions.press('lotw/certificates', event);
      await vi.waitFor(() => expect(h.dialogs.confirm).toHaveBeenCalledTimes(2));
      h.confirm(false); expect((await pressed).ok).toBe(true);
      expect(h.requests.filter(r => typeof r === 'object' && r !== null && 'kind' in r && r.kind === 'lotw.delete')).toHaveLength(2);
    } finally { h.stop(); }
  });
  it('cancels without committing, refreshes, and still enforces a withdrawn manage grant', async () => {
    const h = harness();
    try {
      await ready(h);
      expect((await h.sup.action('lotw', { ...event, row: 'unissued' })).ok).toBe(false);
      expect((await h.sup.action('lotw', { ...event, extra: true } as never)).ok).toBe(false);
      const pressed = h.actions.press('lotw/certificates', event);
      await vi.waitFor(() => expect(h.dialogs.confirm).toHaveBeenCalledTimes(1));
      h.confirm(false);
      expect(await pressed).toEqual({ ok: true, status: 'Cancelled. No changes were made.' });
      await vi.waitFor(() => expect(h.reads).toHaveBeenCalledTimes(2));
      expect(h.core.mock.calls.map(([command]) => command.op)).toEqual(['inspectDelete', 'cancel']);
      h.withdraw();
      expect(await h.actions.press('lotw/certificates', event)).toMatchObject({ ok: true, status: expect.stringContaining('refused') });
      expect(h.dialogs.confirm).toHaveBeenCalledTimes(1);
    } finally { h.stop(); }
  });
});

describe('LoTW pages that cannot be read (#200)', () => {
  it('names the grants only when a grant refused the request', () => {
    expect(unreadable('Trusted roots', { ok: false, error: 'Not granted.', refused: 'lotw:read' }))
      .toBe('Trusted roots could not be read. Check the LoTW grants in Settings and try again.');
    for (const reply of [{ ok: false, error: 'LoTW trusted roots could not be read.' }, { ok: true, kind: 'lotw.roots', roots: [{}] }, undefined]) {
      expect(unreadable('Trusted roots', reply)).toBe('Trusted roots could not be read. Try again; if it keeps happening, check the output.');
    }
  });
});

describe('LoTW action outcomes and displayed identities', () => {
  it.each([
    ['conflict', 'The LoTW store changed since you confirmed. Nothing was deleted. Look at the store again.', 'delete'],
    ['conflict', 'The LoTW store changed since inspection. Nothing was imported. Look at the store again.', 'load'],
    // Error text is never classified: the conflict sentence as an error is an unknown outcome.
    ['The LoTW store changed since you confirmed. Nothing was deleted. Look at the store again.', 'LoTW refused the operation or its outcome is unknown. Refresh and check the store before trying again.', 'delete'],
    ['Unrecognized native failure', 'LoTW refused the operation or its outcome is unknown. Refresh and check the store before trying again.', 'delete'],
    ['The LoTW outcome is unknown. Read the store before trying again.', 'LoTW refused the operation or its outcome is unknown. Refresh and check the store before trying again.', 'load']
  ])('reports a commit failure safely: %s', async (failure, status, action) => {
    const h = harness(failure === 'conflict' ? 'conflict' : new Error(failure));
    try {
      await ready(h);
      const pressed = h.actions.press('lotw/certificates', action === 'delete' ? event : { page: 'certificates', action });
      await vi.waitFor(() => expect(h.dialogs.confirm).toHaveBeenCalledTimes(1));
      h.confirm(true);
      expect(await pressed).toEqual({ ok: true, status });
      expect(h.actions.state('lotw/certificates')).toEqual({ key: 'lotw/certificates', running: false, status });
      await vi.waitFor(() => expect(h.reads).toHaveBeenCalledTimes(2));
    } finally { h.stop(); }
  });
  it('authorizes cached A after refreshed B is cancelled in transit, closed and reopened', async () => {
    const h = harness();
    try {
      await ready(h);
      h.holdRefresh();
      await vi.waitFor(() => expect(h.held).toHaveLength(1));
      h.close();
      h.deliver();
      // Drain the cancelled request before reopening inside the refresh interval.
      await vi.waitFor(() => expect(h.settled).toContainEqual(expect.objectContaining({ accepted: false })));
      h.reopen();
      await ready(h);
      expect(h.reads).toHaveBeenCalledTimes(2);
      const view = h.scheduler.views()[0];
      expect(pageRowKeys(view?.state === 'ready' ? view.answer : undefined)).toEqual(new Set([certificate.id]));
      expect((await h.sup.action('lotw', { ...event, row: 'cert:4f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b' })).ok).toBe(false);
      const pressed = h.actions.press('lotw/certificates', event);
      await vi.waitFor(() => expect(h.dialogs.confirm).toHaveBeenCalledTimes(1));
      h.confirm(false);
      expect(await pressed).toEqual({ ok: true, status: 'Cancelled. No changes were made.' });
    } finally { h.stop(); }
  });
});
