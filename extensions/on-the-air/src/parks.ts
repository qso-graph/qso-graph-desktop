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
import type { AdifBand, PotaPlace } from '../../../packages/extension-api/api-contract.js';
import type { PageAnswer, Section } from '../../../packages/extension-api/pages.js';
import { placeCells, placesBy, withPlaces } from './places.js';

export interface Spot {
  readonly activator: string;
  readonly reference: string;
  readonly park?: string;
  // POTA's location or locations for the park: US-ID, or JP-CH, JP-IB.
  readonly location?: string;
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

// A frequency in kHz as POTA writes one: digits, perhaps a decimal part.
// Number() alone takes 0x36ee and 1e4 as frequencies (Codex review,
// 2026-10-23); checked part by part, as the security lint asks of a pattern.
const DIGITS = /^\d{1,9}$/;
function frequencyOf(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  if (typeof value !== 'string') return NaN;
  const parts = value.trim().split('.');
  if (parts.length > 2 || !parts.every(part => DIGITS.test(part))) return NaN;
  return Number(parts.join('.'));
}

// A time that exists. Date rolls 30 February over to 2 March, so the time
// is written back out and compared with what was sent (Codex review).
function timeOf(value: unknown): Date | undefined {
  if (typeof value !== 'string' || !TIME.test(value)) return undefined;
  const at = new Date(`${value}Z`);
  return !Number.isNaN(at.getTime()) && at.toISOString().slice(0, 19) === value ? at : undefined;
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
    const kHz = frequencyOf(row.frequency);
    // POTA's times carry no zone and are UTC.
    const at = timeOf(row.spotTime);
    if (!CALL.test(activator) || !REFERENCE.test(reference) || !Number.isFinite(kHz) || kHz <= 0 || !at || Number.isNaN(at.getTime())) continue;
    // Whole, as POTA names them (KI7MT, 2026-10-23: "Contreforts
    // septentrionaux du Causse d'Aumelas Biological R…" was cut short); the
    // bound is only a bound, far past any name POTA gives.
    const park = plain(row.name, 300);
    const location = plain(typeof row.locationDesc === 'string' ? row.locationDesc.split(',').map(part => part.trim()).filter(Boolean).join(', ') : undefined, 300);
    const mode = plain(row.mode, 10);
    spots.push({ activator, reference, kHz, at, ...(park ? { park } : {}), ...(location ? { location } : {}), ...(mode ? { mode } : {}) });
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
const NO_NAME = '—';
export const SHOWN = 200;

// `places` names each location's program and entity (pota.places), for the
// Program and Entity filters; without POTA's lists there are none.
export function parksPage(spots: readonly Spot[], now: Date, bands: readonly AdifBand[] = [], area: readonly string[] = [], places: readonly PotaPlace[] = []): PageAnswer {
  const newest = [...spots].sort((a, b) => b.at.getTime() - a.at.getTime());
  const observedAt = new Date(Math.floor((newest[0]?.at ?? now).getTime() / 60_000) * 60_000).toISOString().replace('.000Z', 'Z');
  if (newest.length === 0) {
    return { ok: true, data: { version: 6, observedAt, sections: [
      { shape: 'alert', level: 'info', text: 'No one is spotted activating a POTA park just now.' }
    ] } };
  }
  const shown = newest.slice(0, SHOWN);
  const parks = new Set(newest.map(spot => spot.reference)).size;
  const byPlace = placesBy(places);
  const drawn = shown.map(spot => [
    spot.activator,
    // The reference and the park's name apart, which reads more easily
    // (KI7MT, 2026-10-23).
    spot.reference,
    spot.park ?? NO_NAME,
    spot.location ?? NO_NAME,
    frequencyText(spot),
    bandOf(spot.kHz, bands) ?? NO_BAND,
    spot.mode ?? NO_MODE,
    `${two(spot.at.getUTCHours())}:${two(spot.at.getUTCMinutes())}`
  ]);
  // Program and Entity, not drawn: for their filters alone (places.ts).
  const located = withPlaces(drawn, byPlace.size === 0 ? [] : shown.map(spot =>
    placeCells((spot.location ?? '').split(',').map(value => value.trim()).filter(Boolean), byPlace)));
  const rows = located.rows;
  // The bands on the air, in ADIF's order, lowest first; the modes on the
  // air, alphabetically. Only what is there is offered.
  const present = (column: number) => new Set(rows.map(row => row[column]!));
  const onBands = present(5);
  const bandOptions = [...bands.map(band => band.band).filter(band => onBands.has(band)), ...(onBands.has(NO_BAND) ? [NO_BAND] : [])].slice(0, 100);
  const modeOptions = [...present(6)].sort((a, b) => a.localeCompare(b)).slice(0, 100);
  // The locations on the air, alphabetically: "show me Idaho" (KI7MT, 2026-10-23).
  // Each location on its own, so a park in several is found under each.
  const locationOptions = [...new Set(rows.flatMap(row => row[3]!.split(',').map(value => value.trim()).filter(Boolean)))]
    .sort((a, b) => a.localeCompare(b)).slice(0, 100);
  const sections: Section[] = [
    { shape: 'figures', figures: [
      { label: 'Activators', value: String(newest.length) },
      { label: 'Parks', value: String(parks) }
    ] },
    // Sortable by any column; the band sorts in ADIF's order (the filter's).
    { shape: 'table', columns: ['Activator', 'Park', 'Name', 'Location', 'MHz', 'Band', 'Mode', 'UTC', ...located.columns], rows, sortable: true,
      ...(located.hidden ? { hidden: located.hidden } : {}),
      // Sent newest first by when spotted, which the core shows as the sort
      // and keeps right across midnight UTC (KI7MT, 2026-10-23).
      sortedBy: { column: 7, direction: 'descending' }, filters: [
      // Program and Entity first, as POTA's own park list starts (KI7MT,
      // 2026-10-23); then what a chaser narrows by.
      ...located.filters,
      // No band to choose without ADIF's bands: every spot's would be "—".
      ...(bands.length > 0 ? [{ column: 5, label: 'Band', options: bandOptions }] : []),
      { column: 6, label: 'Mode', options: modeOptions },
      // My area offered first when the operator has one, one choice away;
      // the page starts on All (KI7MT, 2026-10-23).
      { column: 3, label: 'Location', options: locationOptions, multiple: true,
        ...(area.length > 0 ? { named: [{ label: 'My area', values: [...area] }] } : {}) }
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
