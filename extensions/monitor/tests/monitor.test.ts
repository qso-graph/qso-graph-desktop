// SPDX-License-Identifier: GPL-3.0-only
// The Monitor (QGD-INT-0023): its window, and its page as the core checks it.
import { describe, expect, it } from 'vitest';
import { createWindow, placeTime, MAX_CYCLES } from '../src/window.js';
import { ALL, cyclesShown, megahertz, monitorPage, shown } from '../src/page.js';
import { validatePageAnswer, type PageData, type Section } from '../../../packages/extension-api/pages.js';
import type { DeliveredEvent, IntegrationEvent } from '../../../packages/extension-api/integration-events.js';

const NOW = Date.parse('2026-10-29T18:43:00Z');
const at = (hms: string) => { const [h, m, s] = hms.split(':').map(Number); return ((h * 60 + m) * 60 + s) * 1000; };
const stamp = (events: IntegrationEvent[], adapter = 'wsjtx'): DeliveredEvent[] => events.map(event => ({ ...event, adapter }));
const decode = (time: string, message: string, extra: Partial<Extract<IntegrationEvent, { type: 'decode' }>> = {}): IntegrationEvent =>
  ({ type: 'decode', source: 'WSJT-X', isNew: true, time: at(time), snr: -12, dt: 0.2, df: 1234, mode: '~', message, lowConfidence: false, offAir: false, ...extra });
const status = (source = 'WSJT-X'): IntegrationEvent =>
  ({ type: 'status', source, dialHz: 14_074_000, mode: 'FT8', transmitting: false, decoding: false, txEnabled: false });

// The page, through the core's own check: what the Monitor answers is what
// the core will draw, or it fails here.
function validated(answer: ReturnType<typeof monitorPage>): PageData {
  const checked = validatePageAnswer(answer);
  if (!checked.ok) throw new Error(checked.reason);
  return checked.data;
}
function page(window: ReturnType<typeof createWindow>, view?: string): PageData {
  const answer = validatePageAnswer(monitorPage(window, view, NOW));
  if (!answer.ok) throw new Error(answer.reason);
  return answer.data;
}
const table = (data: PageData) => data.sections.find((section): section is Extract<Section, { shape: 'table' }> => section.shape === 'table');

describe('the Monitor\'s window', () => {
  it('places a time of day on today, or on yesterday when it is later than now', () => {
    expect(new Date(placeTime(at('18:42:45'), NOW)).toISOString()).toBe('2026-10-29T18:42:45.000Z');
    expect(new Date(placeTime(at('23:59:45'), NOW)).toISOString()).toBe('2026-10-28T23:59:45.000Z');
  });

  it('keeps a bounded window of cycles, newest first, and a Replay of one it has once', () => {
    const window = createWindow();
    const events: IntegrationEvent[] = [];
    for (let n = 0; n < MAX_CYCLES + 10; n += 1) events.push(decode(new Date(NOW - (n + 1) * 15_000).toISOString().slice(11, 19), `CQ K${n}ABC DN13`));
    window.take(stamp(events), NOW);
    window.take(stamp([{ ...decode(new Date(NOW - 15_000).toISOString().slice(11, 19), 'CQ K0ABC DN13'), isNew: false }]), NOW);
    const [source] = window.sources();
    expect(new Set(source.decodes.map(entry => entry.cycle)).size).toBe(MAX_CYCLES);
    expect(source.decodes[0].message).toBe('CQ K0ABC DN13');
    expect(source.decodes.filter(entry => entry.message === 'CQ K0ABC DN13')).toHaveLength(1);
  });

  it('empties a source WSJT-X cleared, and says one closed', () => {
    const window = createWindow();
    window.take(stamp([decode('18:42:45', 'CQ K7ABC DN13')]), NOW);
    window.take(stamp([{ type: 'clear', source: 'WSJT-X', window: 0 }, { type: 'close', source: 'WSJT-X' }]), NOW);
    expect(window.sources()[0]).toMatchObject({ decodes: [], closed: true });
  });
});

describe('the Monitor\'s page', () => {
  it('says what to do when nothing has been heard', () => {
    const data = page(createWindow());
    expect(data.views).toEqual([{ id: ALL, label: 'All' }]);
    expect(data.sections[0]).toMatchObject({ shape: 'text' });
  });

  it('has a view per source, each with its own status line, and All marks each row with its source', () => {
    const window = createWindow();
    window.take(stamp([status('WSJT-X - IC-7300'), status('WSJT-X - FTDX10'),
      { ...decode('18:42:45', 'CQ K7ABC DN13'), source: 'WSJT-X - IC-7300' },
      { ...decode('18:42:45', 'JA1XYZ W1AW -15'), source: 'WSJT-X - FTDX10' }]), NOW);
    const all = page(window);
    expect(all.views!.map(view => view.label)).toEqual(['All', 'WSJT-X - IC-7300', 'WSJT-X - FTDX10']);
    expect(all.sections.filter(section => section.shape === 'figures')).toHaveLength(2);
    const merged = table(all)!;
    expect(merged.columns.at(-1)).toBe('Source');
    const one = page(window, all.views![2].id);
    expect(one.view).toBe(all.views![2].id);
    expect(one.sections.filter(section => section.shape === 'figures').map(section => section.heading)).toEqual(['WSJT-X - FTDX10']);
    expect(table(one)!.columns).not.toContain('Source');
    // A view it no longer has is All.
    expect(page(window, 'source-99').view).toBe(ALL);
  });

  it('marks low-confidence and off-air decodes, and draws a hashed call without markup', () => {
    const window = createWindow();
    window.take(stamp([decode('18:42:45', 'CQ <PJ4/K1ABC>', { lowConfidence: true }), decode('18:42:45', 'CQ K7ABC DN13', { offAir: true })]), NOW);
    const decodes = table(page(window))!;
    const rows = 'groups' in decodes ? decodes.groups.flatMap(group => group.rows) : [];
    expect(rows.map(cells => cells[5]).sort()).toEqual(['low confidence', 'off air']);
    expect(rows.map(cells => cells[4])).toContain('CQ ‹PJ4/K1ABC›');
    expect(shown('a <b> c')).toBe('a ‹b› c');
  });

  it('shows as many cycles as its Settings tab says, and its default for a choice it does not offer', () => {
    const window = createWindow();
    const events: IntegrationEvent[] = [];
    for (let n = 0; n < 30; n += 1) events.push(decode(new Date(NOW - (n + 1) * 15_000).toISOString().slice(11, 19), `CQ K${n}ABC DN13`));
    window.take(stamp(events), NOW);
    const groups = (cycles: number) => { const shown = table(validated(monitorPage(window, undefined, NOW, cycles)))!; return 'groups' in shown ? shown.groups.length : 0; };
    expect(groups(cyclesShown('10'))).toBe(10);
    expect(groups(cyclesShown('20'))).toBe(20);
    expect(groups(cyclesShown('40'))).toBe(30);
    expect(cyclesShown('7')).toBe(20);
    expect(cyclesShown(undefined)).toBe(20);
  });

  it('writes a dial frequency as WSJT-X does, in megahertz', () => {
    expect(megahertz(14_074_000)).toBe('14.074');
    expect(megahertz(7_074_500)).toBe('7.0745');
    expect(megahertz(14_097_050)).toBe('14.09705');
  });
});
