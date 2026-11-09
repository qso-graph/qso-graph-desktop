// SPDX-License-Identifier: GPL-3.0-or-later
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createSupervisor } from '../packages/main/extension-host-supervisor.js';
import type { ToExtension, FromHost } from '../packages/extension-host/protocol.js';

describe('supervisor action admission without a host runtime', () => {
  it('never posts a second action while the first is running', async () => {
    let hostMessage!: (message: FromHost) => void;
    let extensionMessage!: (message: unknown) => void;
    const post = vi.fn<(message: ToExtension) => void>();
    const sup = createSupervisor({
      limits: { operatorDeadlineMs: 600_000, requestDeadlineMs: 1_000, sourceFetchDeadlineMs: 130_000,
        activateDeadlineMs: 1_000, deactivateDeadlineMs: 500, messageBytes: 2_000, inFlight: 2,
        heartbeatMs: 10_000, heartbeatMisses: 2, restartBudget: 2, restartWindowMs: 600_000 },
      describe: () => ({ entry: join('test-only', 'main.js'), pages: ['certificates'],
        pageActions: { certificates: { rowActions: [{ id: 'delete', label: 'Delete' }] } } }),
      serve: vi.fn(), log: { info: () => {}, warn: () => {} },
      spawn: () => ({
        post: message => { if (message.type === 'activate') queueMicrotask(() => hostMessage({ type: 'activated', id: message.id, seq: message.seq, ok: true })); },
        onMessage: listener => { hostMessage = listener; }, onExit: () => {}, kill: () => {}
      }),
      channel: () => ({ broker: { post, onMessage: listener => { extensionMessage = listener; }, close: () => {} }, transfer: undefined })
    });
    try {
      const page = sup.page('test-extension', 'certificates');
      await vi.waitFor(() => expect(post.mock.calls.some(([message]) => message.type === 'page')).toBe(true));
      const question = post.mock.calls.map(([message]) => message).find(message => message.type === 'page')!;
      extensionMessage({ type: 'page-answer', cid: question.cid, answer: { ok: true, data: { version: 8,
        observedAt: '2026-11-09T12:00:00Z', sections: [{ shape: 'table', columns: ['Call'], rows: [{ key: 'issued', cells: ['QG0TEST'] }] }] } } });
      expect((await page).outcome).toBe('completed');
      const event = { page: 'certificates', action: 'delete', row: 'issued' };
      const first = sup.action('test-extension', event);
      const second = sup.action('test-extension', event);
      // Inspect transport admission before awaiting either result. A broken
      // guard must fail here even if the host would refuse the extra press.
      expect(post.mock.calls.filter(([message]) => message.type === 'page.action')).toHaveLength(1);
      expect(await second).toEqual({ ok: false, error: 'An action is already running on this page.' });
      const action = post.mock.calls.map(([message]) => message).find(message => message.type === 'page.action')!;
      extensionMessage({ type: 'page-action-answer', cid: action.cid, answer: { ok: true } });
      expect(await first).toEqual({ ok: true });
    } finally { sup.stop(); }
  });
});
