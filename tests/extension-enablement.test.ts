// SPDX-License-Identifier: GPL-3.0-only
// P8-built-in (QGD-HOM-0007): an extension turned off stays off across a
// restart, is stopped, and offers no cards; turned on, its cards come back to
// the pins they held.
import { describe, expect, it, vi } from 'vitest';
import { createEnablement } from '../packages/main/extension-enablement.js';
import { createCardScheduler, keepHidden, type CardView, type CatalogueCard } from '../packages/main/home-cards.js';
import { readSettings, validateSettingsCommand } from '../packages/main/settings-contract.js';
import { isExtensionsReply, validateExtensionsCommand } from '../packages/main/extensions-contract.js';

function harness(options: { off?: string[]; write?: boolean } = {}) {
  let off = options.off ?? [];
  const writes: string[][] = [];
  const calls: [string, boolean][] = [];
  const enablement = createEnablement({
    loaded: () => ['on-the-air', 'other'],
    readOff: () => off,
    writeOff: next => { writes.push([...next]); if (options.write === false) return false; off = [...next]; return true; },
    supervisor: { setEnabled: (id, enabled) => { calls.push([id, enabled]); return Promise.resolve(); } }
  });
  return { enablement, writes, calls, off: () => off };
}

describe('P8-built-in: turning an extension off and on (QGD-HOM-0007)', () => {
  it('is on by default, as a new profile has it', () => {
    expect(harness().enablement.isOn('on-the-air')).toBe(true);
    expect(readSettings({}).extensionsOff).toEqual([]);
  });

  it('records off, stops the extension, and says so; on undoes all three', async () => {
    const { enablement, calls, off } = harness();
    const heard = vi.fn();
    enablement.onChange(heard);
    expect(await enablement.set('on-the-air', false)).toEqual({ ok: true });
    expect(off()).toEqual(['on-the-air']);
    expect(calls).toEqual([['on-the-air', false]]);
    expect(enablement.isOn('on-the-air')).toBe(false);
    expect(await enablement.set('on-the-air', true)).toEqual({ ok: true });
    expect(off()).toEqual([]);
    expect(calls.at(-1)).toEqual(['on-the-air', true]);
    expect(heard).toHaveBeenCalledTimes(2);
  });

  it('refuses an extension that did not load, and writes nothing', async () => {
    const { enablement, writes, calls } = harness();
    expect(await enablement.set('nobody', false)).toEqual({ ok: false, error: 'There is no such extension.' });
    expect(writes).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('does not stop the extension when the choice could not be saved', async () => {
    const { enablement, calls } = harness({ write: false });
    expect((await enablement.set('on-the-air', false)).ok).toBe(false);
    expect(calls).toEqual([]);
  });

  it('applies what the file says at start, for extensions that loaded', async () => {
    const { enablement, calls } = harness({ off: ['on-the-air', 'gone'] });
    await enablement.start();
    expect(calls).toEqual([['on-the-air', false]]);
  });

  it('takes changes one at a time, so off, on, off ends off', async () => {
    const { enablement, off, calls } = harness();
    await Promise.all([enablement.set('on-the-air', false), enablement.set('on-the-air', true), enablement.set('on-the-air', false)]);
    expect(off()).toEqual(['on-the-air']);
    expect(calls.map(([, enabled]) => enabled)).toEqual([false, true, false]);
  });

  it('cannot be changed through the settings channel, only the extensions channel', () => {
    expect(validateSettingsCommand({ type: 'write', key: 'extensionsOff', value: ['on-the-air'] })).toBe(false);
    expect(validateExtensionsCommand({ type: 'set-enabled', id: 'on-the-air', enabled: false })).toBe(true);
    expect(validateExtensionsCommand({ type: 'set-enabled', id: 'On The Air', enabled: false })).toBe(false);
    expect(validateExtensionsCommand({ type: 'set-enabled', id: 'on-the-air', enabled: 'no' })).toBe(false);
    expect(validateExtensionsCommand({ type: 'set-enabled', id: 'on-the-air', enabled: false, extra: 1 })).toBe(false);
  });

  it('reads a bad list in the file as none off, never as a crash', () => {
    expect(readSettings({ extensionsOff: ['on-the-air'] }).extensionsOff).toEqual(['on-the-air']);
    expect(readSettings({ extensionsOff: 'on-the-air' }).extensionsOff).toEqual([]);
    expect(readSettings({ extensionsOff: ['on-the-air', 'on-the-air'] }).extensionsOff).toEqual([]);
    expect(readSettings({ extensionsOff: ['<b>'] }).extensionsOff).toEqual([]);
  });

  it('the window refuses a reply it cannot show', () => {
    const entry = { id: 'on-the-air', name: 'On the Air', tier: 'official', version: '0.1.0', pages: ['Conditions'], enabled: true, grants: [] };
    expect(isExtensionsReply({ ok: true, inventory: { extensions: [entry], refused: [] } })).toBe(true);
    expect(isExtensionsReply({ ok: true, inventory: { extensions: [{ ...entry, enabled: 'yes' }], refused: [] } })).toBe(false);
    expect(isExtensionsReply({ ok: true, inventory: { extensions: [{ ...entry, name: '<img>' }], refused: [] } })).toBe(false);
  });
});

describe('P8-built-in: Home follows the switch (QGD-HOM-0007)', () => {
  const card = (key: string): CatalogueCard => {
    const [extension, id] = key.split('/');
    return { key, extension, extensionName: extension, card: id, name: id, description: 'A page.', refreshSeconds: 60, icon: 'extension', rail: false };
  };

  it('drops an off extension\'s card, cancelling what it had in flight, and offers it again when on', async () => {
    let on = true;
    const signals: AbortSignal[] = [];
    const published: CardView[] = [];
    const scheduler = createCardScheduler({
      catalogue: () => (on ? [card('on-the-air/conditions')] : []),
      pins: () => ['on-the-air/conditions'],
      card: (_extension, _card, signal) => { signals.push(signal); return new Promise(() => undefined); },
      publish: view => published.push(view),
      now: () => Date.now()
    });
    scheduler.setVisible(true);
    expect(scheduler.shown().map(entry => entry.key)).toEqual(['on-the-air/conditions']);
    on = false;
    scheduler.changed();
    expect(signals[0].aborted).toBe(true);
    expect(scheduler.shown()).toEqual([]);
    expect(scheduler.views()).toEqual([]);
    on = true;
    scheduler.changed();
    expect(scheduler.shown().map(entry => entry.key)).toEqual(['on-the-air/conditions']);
    scheduler.stop();
  });

  it('keeps an off extension\'s pins in their places when the operator saves the others', () => {
    const offered = [card('mine/a'), card('mine/b')];
    // Saved unchanged: nothing moves.
    expect(keepHidden(['mine/a'], ['on-the-air/conditions', 'mine/a'], offered)).toEqual(['on-the-air/conditions', 'mine/a']);
    // Reordered: the visible ones swap places around the hidden one.
    expect(keepHidden(['mine/b', 'mine/a'], ['mine/a', 'on-the-air/conditions', 'mine/b'], offered)).toEqual(['mine/b', 'on-the-air/conditions', 'mine/a']);
    // One more chosen: it follows.
    expect(keepHidden(['mine/a', 'mine/b'], ['on-the-air/conditions', 'mine/a'], offered)).toEqual(['on-the-air/conditions', 'mine/a', 'mine/b']);
    // One unpinned: the hidden one keeps its place relative to the rest.
    expect(keepHidden(['mine/b'], ['mine/a', 'on-the-air/conditions', 'mine/b'], offered)).toEqual(['mine/b', 'on-the-air/conditions']);
  });

  it('refuses rather than drops a kept pin when there is no room', () => {
    const eight = ['x/a', 'x/b', 'x/c', 'x/d', 'x/e', 'x/f', 'x/g', 'x/h'];
    expect(keepHidden(eight, ['on-the-air/conditions'], eight.map(card))).toBeUndefined();
    expect(keepHidden(eight.slice(0, 7), ['on-the-air/conditions'], eight.map(card))).toEqual(['on-the-air/conditions', ...eight.slice(0, 7)]);
  });

  it('shows what a card last said when its extension comes back on, without asking early', async () => {
    let on = true;
    let asked = 0;
    const scheduler = createCardScheduler({
      catalogue: () => (on ? [{ ...card('on-the-air/conditions'), refreshSeconds: 900 }] : []),
      pins: () => ['on-the-air/conditions'],
      card: () => { asked++; return Promise.resolve({ outcome: 'completed', answer: { ok: true, data: { version: 1, observedAt: '2026-10-11T18:00:00Z', sections: [] } } }); },
      publish: () => undefined,
      now: () => Date.now()
    });
    scheduler.setVisible(true);
    for (let i = 0; i < 4; i++) await Promise.resolve();
    expect(scheduler.views()[0].state).toBe('ready');
    on = false; scheduler.changed();
    on = true; scheduler.changed();
    expect(scheduler.views()[0].state).toBe('ready');
    expect(asked).toBe(1);
    // A callsign change drops it.
    scheduler.setVisible(false);
    on = false; scheduler.changed();
    scheduler.callsignsChanged();
    on = true; scheduler.changed();
    expect(scheduler.views()[0].state).toBe('waiting');
    scheduler.stop();
  });
});
