// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import type { ExtensionContext, PageActionHandler, PageProvider } from '../../../packages/extension-api/context.js';
import type { ExtensionReply, ExtensionRequest, LotwManageResult } from '../../../packages/extension-api/api-contract.js';
import { validatePageAnswer } from '../../../packages/extension-api/pages.js';
import { activate } from '../src/main.js';
const id = 'cert:3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b';
const certificate = { id, call: 'QG0TEST', dxcc: 291, dxccName: 'United States', serial: 'AB12', qsoFirst: '2020-01-01', qsoLast: '2030-01-01', validFrom: '2020-01-01T00:00:00Z', validTo: '2030-01-01T00:00:00Z', hasKey: true };
const result: LotwManageResult = { status: 'completed', certificates: [{ call: 'QG0TEST', serial: 'AB12', disposition: 'new', reason: '' }], roots: 0, signedQsos: 0, deleted: 0, locations: 0, skippedLocations: [] };
function harness(reply: (request: ExtensionRequest) => ExtensionReply) {
  const providers = new Map<string, PageProvider>(); const handlers = new Map<string, PageActionHandler>(); const asked: ExtensionRequest[] = [];
  const context = {
    extensionId: 'lotw', subscriptions: [], request: async (request: ExtensionRequest) => { asked.push(request); return reply(request); },
    pages: {
      register: (id: string, provider: PageProvider) => { providers.set(id, provider); return { dispose: () => providers.delete(id) }; },
      onAction: (id: string, handler: PageActionHandler) => { handlers.set(id, handler); return { dispose: () => handlers.delete(id) }; }
    }
  } as unknown as ExtensionContext;
  activate(context);
  return { context, asked, handlers, show: (pageId = 'certificates') => providers.get(pageId)!({ pageId, signal: new AbortController().signal, inputs: {}, settings: {} }) };
}
describe('LoTW through the extension API', () => {
  it('does nothing on activation, then draws public certificate details with opaque keys', async () => {
    const h = harness(() => ({ ok: true, kind: 'lotw.certificates', certificates: [certificate, { ...certificate, id: 'second-id', hasKey: false }] }));
    expect(h.asked).toEqual([]);
    const answer = validatePageAnswer(await h.show());
    expect(h.asked).toEqual([{ kind: 'lotw.certificates' }]);
    expect(answer).toMatchObject({ ok: true, data: { version: 8, sections: [{ shape: 'table', rows: [
      { key: id, cells: ['QG0TEST', '291 · United States', 'AB12', '2020-01-01 – 2030-01-01', '2020-01-01T00:00:00Z – 2030-01-01T00:00:00Z', 'Key: installed'] },
      { key: 'second-id', cells: expect.arrayContaining(['Key: not installed']) }
    ] }] } });
  });
  it('explains an empty store and reads trusted roots on their own tab', async () => {
    const h = harness(request => request.kind === 'lotw.roots' ? { ok: true, kind: 'lotw.roots', roots: [{ kind: 'root', subject: 'Test root', serial: 'A1', validFrom: '2020-01-01', validTo: '2030-01-01', fingerprint: 'public-fingerprint', source: 'test corpus', acceptedAt: null }] } : { ok: true, kind: 'lotw.certificates', certificates: [] });
    expect(await h.show()).toMatchObject({ ok: true, data: { sections: [{ text: expect.stringContaining('Load certificate…') }] } });
    expect(validatePageAnswer(await h.show('roots'))).toMatchObject({ ok: true, data: { sections: [{ shape: 'table', rows: [expect.arrayContaining(['Test root', 'Built in'])] }] } });
    expect(h.asked).toEqual([{ kind: 'lotw.certificates' }, { kind: 'lotw.roots' }]);
  });
  it('maps each press to exactly one matching request, including the delete id', async () => {
    const h = harness(request => ({ ok: true, kind: request.kind, result }) as ExtensionReply);
    for (const [action, request] of [['load', { kind: 'lotw.import' }], ['restore', { kind: 'lotw.restore' }], ['delete', { kind: 'lotw.delete', certificate: id }]] as const) {
      expect(await h.handlers.get('certificates')!({ page: 'certificates', action, ...(action === 'delete' ? { row: id } : {}) })).toMatch(/Imported 1|Deleted 0/);
      expect(h.asked.at(-1)).toEqual(request);
    }
    expect(h.asked).toHaveLength(3);
    await h.handlers.get('certificates')!({ page: 'certificates', action: 'undeclared' });
    await h.handlers.get('certificates')!({ page: 'certificates', action: 'delete' });
    expect(h.asked).toHaveLength(3);
  });
  it('says cancelled, refused and partial outcomes in words without echoing arbitrary content', async () => {
    for (const [reply, text] of [
      [{ ok: true, kind: 'lotw.import', result: { ...result, status: 'cancelled', certificates: [] } }, /Cancelled/],
      [{ ok: false, error: 'test-only-sensitive-detail' }, /refused/],
      [{ ok: true, kind: 'lotw.import', result: { ...result, certificates: [{ ...result.certificates[0], disposition: 'refused', reason: 'test-only-sensitive-detail' }], skippedLocations: [{ name: 'test-only-sensitive-detail', reason: 'test-only-sensitive-detail' }] } }, /1 refused/]
    ] as const) {
      const h = harness(() => reply as ExtensionReply);
      const status = await h.handlers.get('certificates')!({ page: 'certificates', action: 'load' });
      expect(status).toMatch(text); expect(status).not.toContain('test-only-sensitive-detail');
    }
  });
  it('refuses unexpected private fields instead of drawing them', async () => {
    const h = harness(() => ({ ok: true, kind: 'lotw.certificates', certificates: [{ ...certificate, password: 'test-only-sensitive-detail', bytes: 'test-only-sensitive-detail' }] }) as ExtensionReply);
    const answer = await h.show();
    expect(answer).toMatchObject({ ok: false });
    expect(JSON.stringify(answer)).not.toContain('test-only-sensitive-detail');
  });
});
