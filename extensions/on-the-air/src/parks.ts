// SPDX-License-Identifier: GPL-3.0-only
// Parks On the Air (QGD-HOM-0011): who is activating a POTA park now, from
// POTA's own spot list. The activator, the park with its name, the frequency
// and mode, and when they were last spotted, newest first.
//
// Pure: POTA's response in, a page answer out. Nothing here fetches. A spot
// that is not what POTA sends is left out rather than drawn as a guess, and
// anything a page cannot hold (markup, too long) is made safe here, because
// the core refuses the whole page over one bad cell.
import type { PageAnswer, Section } from '../../../packages/extension-api/pages.js';

export interface Spot {
  readonly activator: string;
  readonly reference: string;
  readonly park?: string;
  // In kHz, as POTA sends it.
  readonly kHz: number;
  readonly mode?: string;
  readonly at: Date;
}

const CALL = /^[A-Z0-9]{1,8}(\/[A-Z0-9]{1,8}){0,2}$/;
const REFERENCE = /^[A-Z0-9]{1,4}-\d{4,5}$/;
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;

// Text from POTA, as a page can hold it: no markup, one line, within bounds.
function plain(value: unknown, limit: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
  if (text === '') return undefined;
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

export function parseSpots(body: string): Spot[] | undefined {
  let data: unknown;
  try { data = JSON.parse(body); } catch { return undefined; }
  if (!Array.isArray(data)) return undefined;
  const spots: Spot[] = [];
  for (const entry of data) {
    if (typeof entry !== 'object' || entry === null) continue;
    const row = entry as Record<string, unknown>;
    if (row.invalid) continue;
    const activator = typeof row.activator === 'string' ? row.activator.trim().toUpperCase() : '';
    const reference = typeof row.reference === 'string' ? row.reference.trim().toUpperCase() : '';
    const kHz = typeof row.frequency === 'string' || typeof row.frequency === 'number' ? Number(row.frequency) : NaN;
    // POTA's times carry no zone and are UTC.
    const at = typeof row.spotTime === 'string' && TIME.test(row.spotTime) ? new Date(`${row.spotTime}Z`) : undefined;
    if (!CALL.test(activator) || !REFERENCE.test(reference) || !Number.isFinite(kHz) || kHz <= 0 || !at || Number.isNaN(at.getTime())) continue;
    const park = plain(row.name, 60);
    const mode = plain(row.mode, 10);
    spots.push({ activator, reference, kHz, at, ...(park ? { park } : {}), ...(mode ? { mode } : {}) });
  }
  return spots;
}

const two = (n: number) => String(n).padStart(2, '0');

// 14062 kHz as 14.062 MHz: how a ham reads a frequency off a spot.
export function frequencyText(spot: Spot): string {
  const mhz = (spot.kHz / 1000).toFixed(3);
  return spot.mode ? `${mhz} ${spot.mode}` : mhz;
}

export function parksPage(spots: readonly Spot[], now: Date): PageAnswer {
  const newest = [...spots].sort((a, b) => b.at.getTime() - a.at.getTime());
  const observedAt = new Date(Math.floor((newest[0]?.at ?? now).getTime() / 60_000) * 60_000).toISOString().replace('.000Z', 'Z');
  if (newest.length === 0) {
    return { ok: true, data: { version: 6, observedAt, sections: [
      { shape: 'alert', level: 'info', text: 'No one is spotted activating a POTA park just now.' }
    ] } };
  }
  const shown = newest.slice(0, 60);
  const parks = new Set(newest.map(spot => spot.reference)).size;
  const sections: Section[] = [
    { shape: 'figures', figures: [
      { label: 'Activators', value: String(newest.length) },
      { label: 'Parks', value: String(parks) }
    ] },
    { shape: 'table', columns: ['Activator', 'Park', 'Frequency', 'UTC'], rows: shown.map(spot => [
      spot.activator,
      (spot.park ? `${spot.reference} ${spot.park}` : spot.reference).slice(0, 80),
      frequencyText(spot),
      `${two(spot.at.getUTCHours())}:${two(spot.at.getUTCMinutes())}`
    ]) }
  ];
  if (newest.length > shown.length) {
    sections.push({ shape: 'alert', level: 'info', text: `The newest 60 of ${newest.length} spots are shown.` });
  }
  return { ok: true, data: { version: 6, observedAt, sections } };
}
