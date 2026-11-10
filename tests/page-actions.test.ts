// SPDX-License-Identifier: GPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { validateManifest } from '../packages/extension-api/manifest.js';
import { isPageActionEvent, isPageActionAnswer, MAX_ACTIONS, MAX_ROW_ACTIONS, permitsPageAction, pageRowKeys } from '../packages/extension-api/actions.js';
import { validatePageAnswer, type PageAnswer } from '../packages/extension-api/pages.js';
import { validateHomeCommand } from '../packages/main/home-contract.js';
import { createPageActions } from '../packages/main/page-actions.js';
import { filteredGroups, sortedGroups, rowKey } from '../packages/ui/page-shapes.js';

const raw = JSON.parse(readFileSync(join('extensions', 'lotw', 'manifest.json'), 'utf8'));
const known = new Set(['lotw:read', 'lotw:manage', 'lotw:sign', 'lotw:upload']);
const manifest = (page: object) => validateManifest({ ...raw, contributes: { pages: [{ ...raw.contributes.pages[0], ...page }] } }, known);
const answer = (rows: unknown[], version = 8): unknown => ({ ok: true, data: { version, observedAt: '2026-11-09T12:00:00Z', sections: [{ shape: 'table', columns: ['Call', 'Key'], rows }] } });
const shown = validatePageAnswer(answer([{ key: 'opaque-issued-id', cells: ['QG0TEST', 'installed'] }, ['QG1TEST', 'not installed']]));
const declaration = raw.contributes.pages[0];
const event = { page: 'certificates', action: 'delete', row: 'opaque-issued-id' };

describe('page action declarations (QGD-HOM-0018)', () => {
  it('accepts plain actions and row actions with optional hints', () => {
    expect(manifest({}).contributes.pages[0].actions).toEqual(declaration.actions);
    expect(manifest({}).contributes.pages[0].rowActions).toEqual(declaration.rowActions);
  });
  for (const [field, max] of [['actions', MAX_ACTIONS], ['rowActions', MAX_ROW_ACTIONS]] as const) {
    it(`refuses malformed ${field}, including a planted unknown field`, () => {
      for (const list of [null, {}, [null], new Array(1), [{ id: '../bad', label: 'Load' }], [{ id: 'x', label: 'Load' }],
        [{ id: 'load', label: '<b>Load</b>' }], [{ id: 'load', label: 'x'.repeat(33) }], [{ id: 'load', label: '  ' }],
        [{ id: 'load', label: 'Load\nnow' }], [{ id: 'load', label: 'Load', extra: true }], [{ id: 'load', label: 'Load', hint: '<b>hint</b>' }],
        [{ id: 'load', label: 'Load', hint: 'x'.repeat(81) }],
        [{ id: 'same', label: 'One' }, { id: 'same', label: 'Two' }],
        Array.from({ length: max + 1 }, (_, i) => ({ id: 'button-' + i, label: 'Button' }))]) {
        expect(() => manifest({ actions: [], rowActions: [], [field]: list })).toThrow();
      }
    });
  }
  it('refuses an id repeated across the two action lists', () => {
    expect(() => manifest({ actions: [{ id: 'same', label: 'Page' }], rowActions: [{ id: 'same', label: 'Row' }] })).toThrow();
  });
});

describe('versioned row keys and operator events (QGD-HOM-0019/0020)', () => {
  it('refuses C1 controls in action status', () => {
    expect(isPageActionAnswer({ ok: true, status: 'Completed\u0085Try again' })).toBe(false);
  });
  it('refuses C1 controls in opaque row keys', () => {
    expect(isPageActionEvent({ ...event, row: 'opaque\u009bid' })).toBe(false);
  });
  it('keeps old rows and accepts keyed rows only in version 8, with page-wide unique keys', () => {
    for (let version = 2; version <= 8; version++) expect(validatePageAnswer(answer([['QG0TEST', 'installed']], version)).ok).toBe(true);
    for (let version = 2; version < 8; version++) expect(() => validatePageAnswer(answer([{ key: 'opaque-issued-id', cells: ['QG0TEST', 'installed'] }], version))).toThrow();
    expect(pageRowKeys(shown)).toEqual(new Set(['opaque-issued-id']));
    for (const row of [{ key: '', cells: ['a', 'b'] }, { key: '<b>key</b>', cells: ['a', 'b'] }, { key: 'a\n', cells: ['a', 'b'] },
      { key: 'x'.repeat(161), cells: ['a', 'b'] }, { key: undefined, cells: ['a', 'b'] }, { key: 'id', cells: ['a'] }, { key: 'id', cells: ['a', 'b'], extra: true }]) expect(() => validatePageAnswer(answer([row]))).toThrow();
    expect(() => validatePageAnswer(answer([{ key: 'same', cells: ['a', 'b'] }, { key: 'same', cells: ['a', 'b'] }]))).toThrow(/repeats/);
    expect(validatePageAnswer(answer([{ cells: ['a', 'b'] }])).ok).toBe(true);
  });
  it('checks exact event envelopes and only declared actions with currently issued keys', () => {
    expect(isPageActionEvent(event)).toBe(true);
    expect(permitsPageAction(declaration, event, shown)).toBe(true);
    expect(permitsPageAction(declaration, { page: 'certificates', action: 'load' }, undefined)).toBe(true);
    for (const bad of [{ ...event, row: 'unissued' }, { ...event, action: 'undeclared' }, { ...event, action: 'load' }, { page: 'certificates', action: 'delete' }]) expect(permitsPageAction(declaration, bad, shown)).toBe(false);
    for (const bad of [null, { ...event, extra: true }, { ...event, row: undefined }, { ...event, row: '<key>' }, { ...event, action: '../delete' }]) expect(isPageActionEvent(bad)).toBe(false);
    const command = { type: 'page.action', key: 'lotw/certificates', event };
    expect(validateHomeCommand(command)).toBe(true);
    expect(validateHomeCommand({ ...command, confirmed: true })).toBe(false);
    expect(validateHomeCommand({ ...command, event: { ...event, confirmed: true } })).toBe(false);
    expect(isPageActionAnswer({ ok: true })).toBe(true);
    expect(isPageActionAnswer({ ok: true, status: 'Deleted.' })).toBe(true);
    for (const bad of [{ ok: true, status: '<b>deleted</b>' }, { ok: true, status: 'x'.repeat(241) }, { ok: true, status: 'Deleted.', extra: true }]) expect(isPageActionAnswer(bad)).toBe(false);
  });
  it('preserves identities through filtering, grouping and sorting', () => {
    const table = { shape: 'table' as const, columns: ['Call', 'Key'], rows: [{ key: 'first', cells: ['QG2TEST', 'installed'] }, { key: 'second', cells: ['QG1TEST', 'installed'] }], filters: [{ column: 1, label: 'Key' }] };
    const groups = sortedGroups(table, filteredGroups(table, { 1: 'installed' }), { column: 0, direction: 'ascending' });
    expect(groups[0].rows.map(rowKey)).toEqual(['second', 'first']);
  });
  it('refuses closed pages, extra fields and unissued keys, serializes presses, and refreshes once', async () => {
    let finish!: (value: { ok: true; status: string }) => void;
    let current: { key: string; page: typeof declaration; answer: PageAnswer } | undefined = { key: 'lotw/certificates', page: declaration, answer: shown };
    const run = vi.fn(() => new Promise<{ ok: true; status: string }>(resolve => { finish = resolve; }));
    const refresh = vi.fn();
    const actions = createPageActions({ current: () => current, run, refresh });
    for (const bad of [{ ...event, row: 'unissued' }, { ...event, action: 'undeclared' }, { ...event, page: 'roots' }, { ...event, extra: true }]) expect((await actions.press('lotw/certificates', bad)).ok).toBe(false);
    current = undefined;
    expect((await actions.press('lotw/certificates', event)).ok).toBe(false);
    expect(run).not.toHaveBeenCalled();
    current = { key: 'lotw/certificates', page: declaration, answer: shown };
    const first = actions.press('lotw/certificates', event);
    expect(actions.state('lotw/certificates')?.running).toBe(true);
    expect((await actions.press('lotw/certificates', event)).ok).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
    finish({ ok: true, status: 'Deleted.' });
    expect(await first).toEqual({ ok: true, status: 'Deleted.' });
    expect(refresh).toHaveBeenCalledExactlyOnceWith('lotw/certificates');
    expect(actions.state('lotw/certificates')).toEqual({ key: 'lotw/certificates', running: false, status: 'Deleted.' });
  });
  it('refreshes failures and rejects an old key after its answer is replaced', async () => {
    let currentAnswer = shown;
    const refresh = vi.fn(); const run = vi.fn(async () => { throw new Error('private test exception'); });
    const actions = createPageActions({ current: () => ({ key: 'lotw/certificates', page: declaration, answer: currentAnswer }), run, refresh });
    expect(await actions.press('lotw/certificates', event)).toMatchObject({ ok: false, error: expect.not.stringContaining('private test exception') });
    expect(refresh).toHaveBeenCalledTimes(1);
    currentAnswer = validatePageAnswer(answer([]));
    expect((await actions.press('lotw/certificates', event)).ok).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('the host independently checks every action boundary', () => {
  it('refuses closed pages, extra fields, undeclared actions, stale keys and overlapping handlers', async () => {
    const { createHostRuntime } = await import('../packages/extension-host/runtime.js');
    let receive!: (message: unknown) => void;
    const sent: { type: string; cid?: number; answer?: unknown; ok?: boolean }[] = [];
    const lifecycle: { type: string; ok?: boolean }[] = [];
    let finish!: () => void;
    const handler = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    let data = shown;
    let removeProvider!: () => void;
    const runtime = createHostRuntime({
      importModule: async () => ({ activate: (context: import('../packages/extension-api/context.js').ExtensionContext) => {
        const provider = context.pages.register('certificates', () => data);
        removeProvider = () => provider.dispose();
        context.pages.onAction('certificates', handler);
      } }),
      toBroker: message => lifecycle.push(message)
    });
    runtime.receive({ type: 'load', id: 'test-extension', entry: join('test-only', 'main.js'), pages: ['certificates'], pageActions: { certificates: { actions: declaration.actions, rowActions: declaration.rowActions } } }, {
      post: message => { sent.push(message as typeof sent[number]); }, onMessage: listener => { receive = listener; }, close: () => {}
    });
    runtime.receive({ type: 'activate', id: 'test-extension', seq: 1 });
    await vi.waitFor(() => expect(lifecycle).toContainEqual({ type: 'activated', id: 'test-extension', seq: 1, ok: true }));
    receive({ type: 'page.action', cid: 1, event });
    expect(handler).not.toHaveBeenCalled();
    receive({ type: 'page', cid: 2, pageId: 'certificates', inputs: {} });
    await vi.waitFor(() => expect(sent.some(message => message.type === 'page-answer')).toBe(true));
    for (const acknowledgement of [
      { type: 'page-settled', cid: 2, accepted: 'true' },
      { type: 'page-settled', cid: 2, accepted: true, extra: true },
      { type: 'page-settled', cid: 200, accepted: true }
    ]) receive(acknowledgement);
    receive({ type: 'page.action', cid: 20, event });
    expect(handler).not.toHaveBeenCalled();
    receive({ type: 'page-settled', cid: 2, accepted: true });
    for (const message of [
      { type: 'page.action', cid: 3, event: { ...event, extra: true } },
      { type: 'page.action', cid: 4, event, extra: true },
      { type: 'page.action', cid: 5, event: { ...event, action: 'undeclared' } },
      { type: 'page.action', cid: 6, event: { ...event, row: 'unissued' } }
    ]) receive(message);
    expect(handler).not.toHaveBeenCalled();
    receive({ type: 'page.action', cid: 7, event });
    expect(handler).toHaveBeenCalledExactlyOnceWith(event);
    receive({ type: 'page.action', cid: 8, event });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(sent).toContainEqual({ type: 'page-action-answer', cid: 8, answer: { ok: false, error: 'That action is not available on the open page.' } });
    finish();
    await vi.waitFor(() => expect(sent).toContainEqual({ type: 'page-action-answer', cid: 7, answer: { ok: true } }));
    data = validatePageAnswer(answer([]));
    receive({ type: 'page', cid: 9, pageId: 'certificates', inputs: {} });
    await vi.waitFor(() => expect(sent.some(message => message.type === 'page-answer' && message.cid === 9)).toBe(true));
    receive({ type: 'page-settled', cid: 9, accepted: true });
    receive({ type: 'page.action', cid: 10, event });
    receive({ type: 'page-close', page: 'certificates' });
    receive({ type: 'page.action', cid: 11, event: { page: 'certificates', action: 'load' } });
    expect(handler).toHaveBeenCalledTimes(1);
    data = shown;
    receive({ type: 'page', cid: 12, pageId: 'certificates', inputs: {} });
    await vi.waitFor(() => expect(sent.some(message => message.type === 'page-answer' && message.cid === 12)).toBe(true));
    receive({ type: 'page-settled', cid: 12, accepted: true });
    removeProvider();
    receive({ type: 'page', cid: 13, pageId: 'certificates', inputs: {} });
    expect(sent).toContainEqual({ type: 'page-answer', cid: 13, answer: { ok: false, reason: 'This page has no provider.' } });
    receive({ type: 'page-settled', cid: 13, accepted: true });
    receive({ type: 'page.action', cid: 14, event });
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
