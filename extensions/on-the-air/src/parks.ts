// SPDX-License-Identifier: GPL-3.0-only
// Parks On the Air (QGD-HOM-0011): who is activating a POTA park now, from
// POTA's own spot list. The activator, the park with its name, the frequency,
// its band, the mode, and when they were last spotted, newest first, with
// the band and the mode to narrow it by (KI7MT, 2026-10-23).
//
// A spot's band is ADIF's: the band whose edges, as ADIF gives them, hold its
// frequency. The mode is POTA's, as POTA spells it.
//
// Pure: POTA's response in, a page answer out. Nothing here fetches. A spot
// that is not what POTA sends is left out rather than drawn as a guess, and
// anything a page cannot hold (markup, too long) is made safe here, because
// the core refuses the whole page over one bad cell.
import type { AdifBand } from '../../../packages/extension-api/api-contract.js';
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
  return (spot.kHz / 1000).toFixed(3);
}

// The ADIF band a frequency is in, or none.
export function bandOf(kHz: number, bands: readonly AdifBand[]): string | undefined {
  const mhz = kHz / 1000;
  return bands.find(band => mhz >= band.lowerMHz && mhz <= band.upperMHz)?.band;
}

// Without ADIF's bands, or for a frequency in none of them, the band is said
// to be unknown rather than guessed.
const NO_BAND = '—';
const NO_MODE = '—';
export const SHOWN = 200;

export function parksPage(spots: readonly Spot[], now: Date, bands: readonly AdifBand[] = []): PageAnswer {
  const newest = [...spots].sort((a, b) => b.at.getTime() - a.at.getTime());
  const observedAt = new Date(Math.floor((newest[0]?.at ?? now).getTime() / 60_000) * 60_000).toISOString().replace('.000Z', 'Z');
  if (newest.length === 0) {
    return { ok: true, data: { version: 6, observedAt, sections: [
      { shape: 'alert', level: 'info', text: 'No one is spotted activating a POTA park just now.' }
    ] } };
  }
  const shown = newest.slice(0, SHOWN);
  const parks = new Set(newest.map(spot => spot.reference)).size;
  const rows = shown.map(spot => [
    spot.activator,
    (spot.park ? `${spot.reference} ${spot.park}` : spot.reference).slice(0, 80),
    frequencyText(spot),
    bandOf(spot.kHz, bands) ?? NO_BAND,
    spot.mode ?? NO_MODE,
    `${two(spot.at.getUTCHours())}:${two(spot.at.getUTCMinutes())}`
  ]);
  // The bands on the air, in ADIF's order, lowest first; the modes on the
  // air, alphabetically. Only what is there is offered.
  const present = (column: number) => new Set(rows.map(row => row[column]!));
  const onBands = present(3);
  const bandOptions = [...bands.map(band => band.band).filter(band => onBands.has(band)), ...(onBands.has(NO_BAND) ? [NO_BAND] : [])].slice(0, 40);
  const modeOptions = [...present(4)].sort((a, b) => a.localeCompare(b)).slice(0, 40);
  const sections: Section[] = [
    { shape: 'figures', figures: [
      { label: 'Activators', value: String(newest.length) },
      { label: 'Parks', value: String(parks) }
    ] },
    // Sortable by any column; the band sorts in ADIF's order (the filter's).
    { shape: 'table', columns: ['Activator', 'Park', 'MHz', 'Band', 'Mode', 'UTC'], rows, sortable: true, filters: [
      // No band to choose without ADIF's bands: every spot's would be "—".
      ...(bands.length > 0 ? [{ column: 3, label: 'Band', options: bandOptions }] : []),
      { column: 4, label: 'Mode', options: modeOptions }
    ] }
  ];
  if (bands.length === 0) {
    sections.splice(1, 0, { shape: 'alert', level: 'info', text: 'Bands are named from ADIF\'s definitions. Download them in Setup, Reference Data, to choose a band.' });
  }
  if (newest.length > shown.length) {
    sections.push({ shape: 'alert', level: 'info', text: `The newest ${SHOWN} of ${newest.length} spots are shown.` });
  }
  return { ok: true, data: { version: 6, observedAt, sections } };
}
