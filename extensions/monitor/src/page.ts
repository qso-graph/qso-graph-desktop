// SPDX-License-Identifier: GPL-3.0-only
// The Monitor's page (QGD-INT-0023): All, then one view per source, which
// the core draws as tabs (pages.ts views). Each shows its source's status
// line above its decodes, grouped by cycle, newest first; low-confidence and
// off-air decodes are marked. Read-only: nothing here sends anything.
import type { PageAnswer, Section, TableGroup, ViewTab } from '../../../packages/extension-api/pages.js';
import { MAX_CYCLES, type Decode, type MonitorWindow, type Source } from './window.js';

export const ALL = 'all';
const viewOf = (source: Source) => `source-${source.order}`;

// Times are UTC (QGD-INV-0013), as WSJT-X shows them.
const clock = (ms: number) => new Date(ms).toISOString().slice(11, 19);

// A frequency in megahertz, to the hertz and no further than it says.
export function megahertz(hz: number): string {
  const text = (hz / 1e6).toFixed(6);
  return text.replace(/0{1,3}$/, '');
}

// WSJT-X writes a hashed callsign in angle brackets (<PJ4/K1ABC>). A page
// draws no markup, so they are drawn as the guillemets that look like them;
// the event keeps WSJT-X's text as it was.
export function shown(message: string): string {
  return message.replace(/</g, '‹').replace(/>/g, '›');
}

function note(decode: Decode): string {
  const marks = [decode.wspr ? 'WSPR' : '', decode.lowConfidence ? 'low confidence' : '', decode.offAir ? 'off air' : ''].filter(Boolean);
  return marks.length > 0 ? marks.join(', ') : '—';
}

function row(decode: Decode, source?: Source): string[] {
  const cells = [
    clock(decode.cycle), String(decode.snr), decode.dt.toFixed(1),
    decode.wspr && decode.frequencyHz !== undefined ? megahertz(decode.frequencyHz) : String(decode.df),
    shown(decode.message) || '—', note(decode)
  ];
  return source ? [...cells, source.name] : cells;
}

function statusLine(source: Source): Section {
  const state = source.closed ? 'Closed'
    : !source.status ? 'Heard'
      : source.status.transmitting ? 'Transmitting' : source.status.decoding ? 'Decoding' : 'Receiving';
  return {
    shape: 'figures', heading: source.name.slice(0, 60),
    figures: [
      ...(source.status ? [
        { label: 'Dial', value: megahertz(source.status.dialHz), unit: 'MHz' },
        { label: 'Mode', value: source.status.mode.slice(0, 32) || '—' }
      ] : []),
      { label: 'Now', value: state },
      { label: 'Last heard', value: clock(source.heardAt), unit: 'UTC' }
    ]
  };
}

// Decodes grouped by cycle, newest first: one source's, or every source's
// together, each row saying whose.
function decodes(entries: readonly { decode: Decode; source: Source }[], merged: boolean, cycles: number): Section | undefined {
  if (entries.length === 0) return undefined;
  const byCycle = new Map<number, { decode: Decode; source: Source }[]>();
  for (const entry of [...entries].sort((a, b) => b.decode.cycle - a.decode.cycle)) {
    byCycle.set(entry.decode.cycle, [...(byCycle.get(entry.decode.cycle) ?? []), entry]);
  }
  const groups: TableGroup[] = [];
  let rows = 0;
  for (const [cycle, held] of byCycle) {
    if (groups.length >= cycles || rows >= 500) break;
    const taken = held.slice(0, 500 - rows);
    rows += taken.length;
    groups.push({
      heading: `${clock(cycle)} UTC · ${held.length} ${held.length === 1 ? 'decode' : 'decodes'}`,
      rows: taken.map(entry => row(entry.decode, merged ? entry.source : undefined))
    });
  }
  const columns = ['UTC', 'dB', 'DT', 'Freq', 'Message', 'Note', ...(merged ? ['Source'] : [])];
  return { shape: 'table', heading: 'Decodes', contents: false, columns, groups };
}

// How many cycles the grid shows, from its Settings tab (manifest.ts
// settings): one of its choices, else its default. Never more than it keeps.
export function cyclesShown(setting: string | undefined): number {
  const value = Number(setting);
  return [10, 20, 40].includes(value) ? value : 20;
}

export function monitorPage(window: MonitorWindow, view: string | undefined, now: number, cycles = 20): PageAnswer {
  const sources = window.sources();
  const views: ViewTab[] = [{ id: ALL, label: 'All' }, ...sources.map(source => ({ id: viewOf(source), label: source.name.slice(0, 40) }))];
  // A view it no longer has, or none asked for, is All.
  const chosen = sources.find(source => viewOf(source) === view);
  const observedAt = new Date(sources.reduce((latest, source) => Math.max(latest, source.heardAt), 0) || now).toISOString();
  if (sources.length === 0) {
    return { ok: true, data: { version: 7, observedAt, views, view: ALL, sections: [{ shape: 'text', text:
      'Nothing heard yet. Turn on the WSJT-X adapter in Settings, Extensions, and in WSJT-X set File, Settings, Reporting, UDP Server to this computer and the port on the Integrations page.' }] } };
  }
  const shownSources = chosen ? [chosen] : sources;
  const sections: Section[] = shownSources.map(source => statusLine(source));
  const table = decodes(shownSources.flatMap(source => source.decodes.map(decode => ({ decode, source }))), !chosen && sources.length > 1, Math.min(cycles, MAX_CYCLES));
  sections.push(table ?? { shape: 'text', text: 'No decodes yet. They appear here as WSJT-X decodes them, cycle by cycle.' });
  return { ok: true, data: { version: 7, observedAt, views, view: chosen ? viewOf(chosen) : ALL, sections } };
}
