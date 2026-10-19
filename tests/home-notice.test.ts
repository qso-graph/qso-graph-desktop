// SPDX-License-Identifier: GPL-3.0-only
// P8-supervision, the screen (QGD-APP-0022, QGD-APP-0013): when the extension
// host stops, Home names the extensions it affected until dismissed.
import { describe, expect, it } from 'vitest';
import { dismiss, hostNotice, type HostStopStatus } from '../packages/main/home-notice.js';
import { noticeText } from '../packages/renderer/host-notice.js';
import { isHostNotice, validateHomeCommand } from '../packages/main/home-contract.js';
import { createHomeStore } from '../packages/renderer/home-store.js';

const NAMES: Record<string, string> = { 'on-the-air': 'On the Air', other: 'Contest Clock', third: 'DX Spots' };
const nameOf = (id: string) => NAMES[id] ?? id;
const status = (over: Partial<HostStopStatus>): HostStopStatus => ({ host: 'running', affected: [], stops: 0, ...over });
const words = (over: Partial<HostStopStatus>) => noticeText(hostNotice(status(over), nameOf, 0)!);

describe('P8-supervision: Home names what a stopped host affected', () => {
  it('says nothing while the host has never stopped', () => {
    expect(hostNotice(status({}), nameOf, 0)).toBeNull();
  });

  it('names every affected extension by its name, and says it was restarted', () => {
    expect(words({ stops: 1, stoppedAt: '2026-10-19T18:04:30Z', affected: ['on-the-air', 'other', 'third'] }))
      .toBe('The extension host stopped at 18:04 UTC and was restarted. It affected On the Air, Contest Clock and DX Spots.');
  });

  it('says it is being restarted while it is', () => {
    expect(words({ host: 'restarting', stops: 1, affected: ['on-the-air'] }))
      .toBe('The extension host stopped and is being restarted. It affected On the Air.');
  });

  it('says it was not restarted when the budget is spent, and what to do', () => {
    expect(words({ host: 'stopped', stops: 3, affected: ['on-the-air'] }))
      .toMatch(/stopped repeatedly and was not restarted\. It affected On the Air\. Restart QSO Graph Desktop/);
  });

  it('never names a cause: the extensions are affected, not blamed', () => {
    expect(words({ stops: 1, affected: ['on-the-air'] })).not.toMatch(/caused|because|crashed/i);
  });

  it('is hidden once that stop is dismissed, and shows again for a later one', () => {
    expect(hostNotice(status({ stops: 2, affected: ['on-the-air'] }), nameOf, 2)).toBeNull();
    expect(hostNotice(status({ stops: 3, affected: ['on-the-air'] }), nameOf, 2)!.id).toBe(3);
  });

  it('refuses to dismiss a stop that has not happened, rather than taking it for the latest', () => {
    expect(dismiss(0, 1, 1)).toBe(1);
    expect(dismiss(0, 999, 1)).toBeUndefined();
    expect(dismiss(0, 0, 1)).toBeUndefined();
    expect(dismiss(3, 2, 3)).toBe(3);
  });

  it('passes the window\'s contract however many extensions, with the longest names a manifest allows', () => {
    const long = Array.from({ length: 64 }, (_, at) => `${'N'.repeat(62)}${String(at).padStart(2, '0')}`);
    for (const host of ['running', 'restarting', 'stopped'] as const) {
      const notice = hostNotice(status({ host, stops: 1, stoppedAt: '2026-10-19T18:04:30Z', affected: long }), id => id, 0);
      expect(isHostNotice(notice), host).toBe(true);
      expect(noticeText(notice!)).toContain(long.at(-1));
    }
  });
});

describe('the notice at the window boundary (QGD-SEC-0006)', () => {
  it('accepts a dismiss naming a stop, and nothing else', () => {
    expect(validateHomeCommand({ type: 'dismiss', id: 1 })).toBe(true);
    for (const bad of [{ type: 'dismiss' }, { type: 'dismiss', id: 0 }, { type: 'dismiss', id: 1.5 }, { type: 'dismiss', id: '1' }, { type: 'dismiss', id: 1, extra: true }]) {
      expect(validateHomeCommand(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it('refuses a notice with markup, or off its shape', () => {
    expect(isHostNotice(null)).toBe(true);
    expect(isHostNotice({ id: 1, kind: 'restarted', affected: ['On the Air'] })).toBe(true);
    expect(isHostNotice({ id: 1, kind: 'restarted', affected: ['<img src=x>'] })).toBe(false);
    expect(isHostNotice({ id: 1, kind: 'exploded', affected: [] })).toBe(false);
    expect(isHostNotice({ id: 0, kind: 'restarted', affected: [] })).toBe(false);
    expect(isHostNotice({ id: 1, kind: 'restarted', affected: [], text: 'x' })).toBe(false);
    expect(isHostNotice({ id: 1, kind: 'restarted', affected: new Array(2) })).toBe(false);
  });
});

describe('the store keeps the newest notice', () => {
  const STATE = { available: [], pins: [], cards: [] };
  const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

  it('shows a pushed notice and ignores one off the contract', async () => {
    let push: (notice: unknown) => void = () => {};
    const store = createHomeStore({
      request: () => Promise.resolve({ ok: true, state: { ...STATE, notice: null } }),
      onCard: () => () => undefined,
      onNotice: listener => { push = listener; return () => undefined; }
    });
    store.start();
    await flush();
    push({ id: 1, kind: 'restarted', affected: ['On the Air'] });
    expect(store.get().notice?.id).toBe(1);
    push({ id: 2, kind: 'restarted', affected: ['<script>'] });
    expect(store.get().notice?.id).toBe(1);
  });

  it('never lets a reply composed before a newer stop hide it', async () => {
    let push: (notice: unknown) => void = () => {};
    let answer: (reply: unknown) => void = () => {};
    const store = createHomeStore({
      request: command => (command as { type: string }).type === 'dismiss'
        ? new Promise(settle => { answer = settle; })
        : Promise.resolve({ ok: true, state: { ...STATE, notice: null } }),
      onCard: () => () => undefined,
      onNotice: listener => { push = listener; return () => undefined; }
    });
    store.start();
    await flush();
    push({ id: 1, kind: 'restarted', affected: ['On the Air'] });
    store.dismissNotice(1);
    // Stop 2 arrives while the dismiss of stop 1 is in flight; its reply,
    // composed before stop 2, says there is no notice.
    push({ id: 2, kind: 'restarted', affected: ['On the Air'] });
    answer({ ok: true, state: { ...STATE, notice: null } });
    await flush();
    expect(store.get().notice?.id).toBe(2);
  });
});
