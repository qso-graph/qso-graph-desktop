// SPDX-License-Identifier: GPL-3.0-only
// P8-built-in (QGD-HOM-0007): an extension turned off stays off across a
// restart, is stopped, and offers no pages; turned on, its pages come back to
// the pins they held.
import { describe, expect, it, vi } from 'vitest';
import { createEnablement } from '../packages/main/extension-enablement.js';
import { createPageScheduler, keepHidden, type PageView, type CataloguePage } from '../packages/main/page-scheduler.js';
import { readSettings, validateSettingsCommand } from '../packages/main/settings-contract.js';
import { isExtensionsReply, validateExtensionsCommand } from '../packages/main/extensions-contract.js';

function harness(options: { on?: string[]; write?: boolean } = {}) {
  let on = options.on ?? [];
  const writes: string[][] = [];
  const calls: [string, boolean][] = [];
  const turnedOn: string[] = [];
  const enablement = createEnablement({
    loaded: () => ['pota', 'other'],
    readOn: () => on,
    writeOn: next => { writes.push([...next]); if (options.write === false) return false; on = [...next]; return true; },
    supervisor: { setEnabled: (id, enabled) => { calls.push([id, enabled]); return Promise.resolve(); } },
    onTurnedOn: id => { turnedOn.push(id); }
  });
  return { enablement, writes, calls, on: () => on, turnedOn };
}

describe('P8-built-in: turning an extension on and off (QGD-HOM-0007)', () => {
  it('is off by default, as a new profile has it (KI7MT, 2026-10-23)', () => {
    expect(harness().enablement.isOn('pota')).toBe(false);
    expect(readSettings({}).extensionsOn).toEqual([]);
  });

  it('records on, starts the extension, pins it and says so; off undoes it', async () => {
    const { enablement, calls, on, turnedOn } = harness();
    const heard = vi.fn();
    enablement.onChange(heard);
    expect(await enablement.set('pota', true)).toEqual({ ok: true });
    expect(on()).toEqual(['pota']);
    expect(calls).toEqual([['pota', true]]);
    expect(turnedOn).toEqual(['pota']);
    expect(enablement.isOn('pota')).toBe(true);
    expect(await enablement.set('pota', false)).toEqual({ ok: true });
    expect(on()).toEqual([]);
    expect(calls.at(-1)).toEqual(['pota', false]);
    expect(turnedOn).toEqual(['pota']);
    expect(heard).toHaveBeenCalledTimes(2);
  });

  it('refuses an extension that did not load, and writes nothing', async () => {
    const { enablement, writes, calls } = harness();
    expect(await enablement.set('nobody', true)).toEqual({ ok: false, error: 'There is no such extension.' });
    expect(writes).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('does not start the extension when the choice could not be saved', async () => {
    const { enablement, calls, turnedOn } = harness({ write: false });
    expect((await enablement.set('pota', true)).ok).toBe(false);
    expect(calls).toEqual([]);
    expect(turnedOn).toEqual([]);
  });

  it('at start, tells the supervisor every loaded extension the file does not say is on is off', async () => {
    const { enablement, calls } = harness({ on: ['pota', 'gone'] });
    await enablement.start();
    expect(calls).toEqual([['other', false]]);
  });

  it('takes changes one at a time, so on, off, on ends on', async () => {
    const { enablement, on, calls } = harness();
    await Promise.all([enablement.set('pota', true), enablement.set('pota', false), enablement.set('pota', true)]);
    expect(on()).toEqual(['pota']);
    expect(calls.map(([, enabled]) => enabled)).toEqual([true, false, true]);
  });

  it('cannot be changed through the settings channel, only the extensions channel', () => {
    expect(validateSettingsCommand({ type: 'write', key: 'extensionsOn', value: ['on-the-air'] })).toBe(false);
    expect(validateExtensionsCommand({ type: 'set-enabled', id: 'on-the-air', enabled: false })).toBe(true);
    expect(validateExtensionsCommand({ type: 'set-enabled', id: 'On The Air', enabled: false })).toBe(false);
    expect(validateExtensionsCommand({ type: 'set-enabled', id: 'on-the-air', enabled: 'no' })).toBe(false);
    expect(validateExtensionsCommand({ type: 'set-enabled', id: 'on-the-air', enabled: false, extra: 1 })).toBe(false);
  });

  it('reads a bad list in the file as none on, never as a crash, and an old off list as nothing', () => {
    expect(readSettings({ extensionsOn: ['pota'] }).extensionsOn).toEqual(['pota']);
    expect(readSettings({ extensionsOn: 'pota' }).extensionsOn).toEqual([]);
    expect(readSettings({ extensionsOn: ['pota', 'pota'] }).extensionsOn).toEqual([]);
    expect(readSettings({ extensionsOn: ['<b>'] }).extensionsOn).toEqual([]);
    // An earlier build's file: its off list says nothing about what is on.
    expect(readSettings({ extensionsOff: [] }).extensionsOn).toEqual([]);
  });

  it('the window refuses a reply it cannot show', () => {
    const entry = { id: 'on-the-air', name: 'On the Air', tier: 'official', version: '0.1.0', pages: ['Conditions'], enabled: true, grants: [] };
    expect(isExtensionsReply({ ok: true, inventory: { extensions: [entry], refused: [] } })).toBe(true);
    expect(isExtensionsReply({ ok: true, inventory: { extensions: [{ ...entry, enabled: 'yes' }], refused: [] } })).toBe(false);
    // What did not load reaches Settings with its words, so it is not
    // silently missing (QGD-APP-0011; ADIF Lookup, 2026-10-23).
    expect(isExtensionsReply({ ok: true, inventory: { extensions: [entry], refused: [{ source: '/app/dist/extensions/adif-lookup/manifest.json', reason: 'The page has a field with no well-formed, unique id.' }] } })).toBe(true);
    expect(isExtensionsReply({ ok: true, inventory: { extensions: [entry], refused: [{ source: 'x', reason: '<b>x</b>' }] } })).toBe(false);
    expect(isExtensionsReply({ ok: true, inventory: { extensions: [entry], refused: 'none' } })).toBe(false);
    expect(isExtensionsReply({ ok: true, inventory: { extensions: [{ ...entry, name: '<img>' }], refused: [] } })).toBe(false);
  });
});

describe('P8-built-in: Home follows the switch (QGD-HOM-0007)', () => {
  const page = (key: string): CataloguePage => {
    const [extension, id] = key.split('/');
    return { key, extension, extensionName: extension, page: id, name: id, description: 'A page.', refreshSeconds: 60, icon: 'extension', rail: false, inputs: [], network: false };
  };

  it('drops an off extension\'s page, cancelling what it had in flight, and offers it again when on', async () => {
    let on = true;
    const signals: AbortSignal[] = [];
    const published: PageView[] = [];
    const scheduler = createPageScheduler({
      catalogue: () => (on ? [page('on-the-air/conditions')] : []),
      pins: () => ['on-the-air/conditions'],
      page: (_extension, _page, signal) => { signals.push(signal); return new Promise(() => undefined); },
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
    const offered = [page('mine/a'), page('mine/b')];
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
    expect(keepHidden(eight, ['on-the-air/conditions'], eight.map(page))).toBeUndefined();
    expect(keepHidden(eight.slice(0, 7), ['on-the-air/conditions'], eight.map(page))).toEqual(['on-the-air/conditions', ...eight.slice(0, 7)]);
  });

  it('shows what a page last said when its extension comes back on, without asking early', async () => {
    let on = true;
    let asked = 0;
    const scheduler = createPageScheduler({
      catalogue: () => (on ? [{ ...page('on-the-air/conditions'), refreshSeconds: 900 }] : []),
      pins: () => ['on-the-air/conditions'],
      page: () => { asked++; return Promise.resolve({ outcome: 'completed', answer: { ok: true, data: { version: 1, observedAt: '2026-10-11T18:00:00Z', sections: [] } } }); },
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

describe('a refusal that quotes markup (Codex review, 2026-10-23)', () => {
  it('does not cost Settings the whole inventory', async () => {
    const { buildInventory } = await import('../packages/main/extension-serve.js');
    const register = JSON.parse((await import('node:fs')).readFileSync('data/extension-grants.json', 'utf8'));
    const inventory = buildInventory({
      ports: { allowed: () => ({}) }, register, extensions: [],
      refused: [{ id: undefined, source: 'extensions/bad/manifest.json', reason: 'The manifest has a field the core does not know: "<bad>".' }]
    } as never);
    expect(isExtensionsReply({ ok: true, inventory })).toBe(true);
    expect(inventory.refused[0]?.reason).not.toMatch(/[<>]/);
  });
});
