// SPDX-License-Identifier: GPL-3.0-only
// Conditions (QGD-HOM-0008): solar flux, the planetary K and A indices, NOAA's
// space weather scales and the band outlook, from NOAA SWPC.
//
// solar-mcp is the specification for this page's behaviour. The parsing and
// the band table below follow its SolarClient.conditions() and
// _band_outlook() (solar-mcp 0.3.0), and tests/conditions.test.ts holds both
// to the same recorded NOAA responses. NOAA sends a scale as a bare digit;
// both prefix every level, so a storm reads "G2" as a quiet day reads "G0"
// (solar-mcp did so from 0.3.0; before that it left a non-zero level bare).
//
// Pure: three response bodies in, a page answer out. Nothing here fetches.
import type { PageAnswer, Section } from '../../../packages/extension-api/pages.js';

export interface NoaaBodies {
  readonly flux: string;
  readonly kp: string;
  readonly scales: string;
}

export interface Conditions {
  // Either may be missing when NOAA's feed for it had no usable value; like
  // solar-mcp, what worked is kept, and the outlook needs both.
  readonly sfi?: number;
  readonly kp?: number;
  // The running A index, from the same row as the K index (solar-mcp's
  // a_running), so it costs no request.
  readonly a?: number;
  readonly scales: { readonly R: string; readonly S: string; readonly G: string };
  readonly scaleText: { readonly R: string; readonly S: string; readonly G: string };
  // The newest of the times below: when the page last changed.
  readonly observedAt: string;
  // Each reading's own time (KI7MT, 2026-10-22): NOAA measures the flux once
  // a day, at 20:00 UTC, and the K index every three hours, so one time for
  // both would make one of them look a day old or a day new.
  readonly sfiAt?: string;
  readonly kpAt?: string;
  // The scales' own time, from NOAA's DateStamp and TimeStamp (#57).
  readonly scalesAt?: string;
  readonly bands?: Readonly<Record<string, string>>;
}

// As solar-mcp's _to_float: NOAA's missing-data flag, -9999, is no value.
function toNumber(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isFinite(number) && number !== -9999 ? number : undefined;
}

// NOAA's times carry no zone and are UTC.
function isoUtc(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const plain = value.trim().replace(' ', 'T').replace(/\.\d+$/, '');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(plain)) return undefined;
  const parsed = Date.parse(`${plain}Z`);
  if (Number.isNaN(parsed)) return undefined;
  const written = new Date(parsed).toISOString().replace('.000Z', 'Z');
  // A date that does not exist (30 February) rolls over in Date.parse;
  // written back and compared, it is refused rather than invented.
  return written === `${plain}Z` ? written : undefined;
}

// The flux: an array whose last entry holds it, or an object (solar-mcp reads
// both). A value of zero or below is not a reading.
function parseFlux(data: unknown): { sfi: number; at?: string } | undefined {
  const entry = Array.isArray(data) ? data.at(-1) : data;
  if (typeof entry !== 'object' || entry === null) return undefined;
  const record = entry as Record<string, unknown>;
  const value = toNumber(record.Flux ?? record.flux);
  if (value === undefined || value <= 0) return undefined;
  // A reading the page cannot date is not shown: Home says how old its data
  // is, and an undated value would borrow another feed's time.
  const at = isoUtc(record.TimeStamp ?? record.timeStamp ?? record.time_tag);
  return at ? { sfi: Math.trunc(value), at } : undefined;
}

// The latest Kp and A: the last row, as an object or as a [time, Kp,
// Kp_fraction, a_running, …] list under a header row. Like solar-mcp, a list
// of one row (a header alone) has none, and a row with no usable A still
// gives its Kp.
function parseKp(data: unknown): { kp: number; a?: number; at?: string } | undefined {
  if (!Array.isArray(data) || data.length <= 1) return undefined;
  const latest: unknown = data.at(-1);
  if (Array.isArray(latest) && latest.length >= 2) {
    const kp = toNumber(latest[1]);
    const at = isoUtc(latest[0]);
    const a = latest.length >= 4 ? toNumber(latest[3]) : undefined;
    return kp === undefined || !at ? undefined : { kp, at, ...(a === undefined ? {} : { a }) };
  }
  if (typeof latest === 'object' && latest !== null) {
    const record = latest as Record<string, unknown>;
    const kp = toNumber(record.Kp ?? record.kp);
    const at = isoUtc(record.time_tag ?? record.timeStamp);
    const a = toNumber(record.a_running);
    return kp === undefined || !at ? undefined : { kp, at, ...(a === undefined ? {} : { a }) };
  }
  return undefined;
}

function level(raw: unknown, letter: 'R' | 'S' | 'G'): string {
  if (typeof raw !== 'string') return 'unknown';
  if (/^\d$/.test(raw)) return `${letter}${raw}`;
  // A prefixed level must carry its own letter: "S3" under R is not R3.
  return raw.length === 2 && raw[0] === letter && /^\d$/.test(raw[1]) ? raw : 'unknown';
}

function parseScales(data: unknown): Pick<Conditions, 'scales' | 'scaleText' | 'scalesAt'> {
  const current = (typeof data === 'object' && data !== null ? (data as Record<string, unknown>)['0'] : undefined) as
    Record<string, { Scale?: unknown; Text?: unknown } | undefined> | undefined;
  // When NOAA observed them, as each other reading is dated (#57, found by
  // Turing: the scales had no time, and the page's took no account of them).
  const stamp = current as Record<string, unknown> | undefined;
  const scalesAt = typeof stamp?.DateStamp === 'string' && typeof stamp.TimeStamp === 'string'
    ? isoUtc(`${stamp.DateStamp}T${stamp.TimeStamp}`) : undefined;
  const read = (letter: 'R' | 'S' | 'G') => level(current?.[letter]?.Scale, letter);
  const text = (letter: 'R' | 'S' | 'G') => (typeof current?.[letter]?.Text === 'string' ? current[letter]!.Text as string : '');
  return { scales: { R: read('R'), S: read('S'), G: read('G') }, scaleText: { R: text('R'), S: text('S'), G: text('G') }, ...(scalesAt ? { scalesAt } : {}) };
}

// solar-mcp's _band_outlook, word for word.
export function bandOutlook(sfi: number, kp: number): Record<string, string> {
  const storm = kp >= 5;
  const disturbed = kp >= 4;
  const active = kp >= 3;
  const bands: Record<string, string> = {};
  bands['160m'] = storm ? 'Poor — storm absorption' : active ? 'Fair — some noise' : 'Good — quiet night conditions';
  bands['80m'] = storm ? 'Poor — D-layer absorption and noise' : disturbed ? 'Fair — elevated absorption' : 'Good — reliable night band';
  bands['40m'] = storm ? 'Fair — reduced DX' : 'Good — workhorse band, day and night';
  bands['30m'] = 'Good — transition band, usually open';
  bands['20m'] = sfi >= 150 ? 'Excellent — strong F-layer, long openings' : sfi >= 100 ? 'Good — reliable daytime DX' : 'Fair — shorter openings at low solar flux';
  bands['17m'] = sfi >= 120 ? 'Good — DX openings likely' : sfi >= 90 ? 'Fair — marginal openings' : 'Poor — insufficient ionization';
  bands['15m'] = sfi >= 140 ? 'Excellent — wide open DX' : sfi >= 100 ? 'Good — daytime openings' : sfi >= 80 ? 'Fair — sporadic openings' : 'Poor — band likely closed';
  bands['12m'] = sfi >= 150 ? 'Good — DX openings around midday' : sfi >= 120 ? 'Fair — brief openings possible' : 'Poor — band likely closed';
  bands['10m'] = sfi >= 160 ? 'Excellent — worldwide DX' : sfi >= 130 ? 'Good — daytime DX openings' : sfi >= 100 ? 'Fair — short openings or sporadic-E' : 'Poor — closed except sporadic-E';
  bands['6m'] = 'Sporadic — watch for Es openings';
  if (storm) {
    for (const band of ['20m', '17m', '15m', '12m', '10m']) bands[band] = `${bands[band].split(' — ')[0]} — degraded by geomagnetic storm`;
  }
  return bands;
}

// The scale every band is graded on, defined in BAND-OUTLOOK.md (KI7MT,
// 2026-10-22). A status is always one of these.
export const BAND_STATUSES = ['Excellent', 'Good', 'Fair', 'Poor', 'Sporadic'] as const;
export type BandStatus = (typeof BAND_STATUSES)[number];

export interface BandRow {
  band: string;
  status: BandStatus;
  comment: string;
}

// solar-mcp's "Good — reliable daytime DX" as a status and a comment. A
// status that is not on the scale is not drawn as if it were: the band is left
// out, which a test would catch.
export function outlookRows(bands: Record<string, string>): BandRow[] {
  return Object.entries(bands).flatMap(([band, outlook]) => {
    const [status, ...rest] = outlook.split(' — ');
    const comment = rest.join(' — ');
    if (!(BAND_STATUSES as readonly string[]).includes(status) || !comment) return [];
    return [{ band, status: status as BandStatus, comment: comment[0].toUpperCase() + comment.slice(1) }];
  });
}

// As solar-mcp's _get_json: NOAA's file servers sometimes pad a response
// with NUL bytes, which are stripped before it is read.
function parse(body: string): unknown {
  try { return JSON.parse(body.replace(/^\0+|\0+$/g, '').trim()); } catch { return undefined; }
}

// What NOAA's feeds hold, keeping what worked as solar-mcp does. Nothing at
// all, from either the flux or the K index, is no conditions.
export function parseConditions(bodies: NoaaBodies): Conditions | undefined {
  const sfi = parseFlux(parse(bodies.flux));
  const k = parseKp(parse(bodies.kp));
  if (!sfi && !k) return undefined;
  // Each reading carries its own time, so the page's is the newest: a stale
  // K index still says how old it is, on its own figure.
  const scales = parseScales(parse(bodies.scales));
  const times = [sfi?.at, k?.at, scales.scalesAt].filter((at): at is string => at !== undefined).sort();
  const observedAt = times.at(-1);
  if (!observedAt) return undefined;
  return {
    ...(sfi ? { sfi: sfi.sfi, sfiAt: sfi.at } : {}),
    ...(k ? { kp: k.kp, kpAt: k.at } : {}),
    ...(k?.a !== undefined ? { a: k.a } : {}),
    ...scales,
    observedAt,
    ...(sfi && k ? { bands: bandOutlook(sfi.sfi, k.kp) } : {})
  };
}

const KIND = { R: 'radio blackout', S: 'solar radiation storm', G: 'geomagnetic storm' } as const;

function at(time: string | undefined): { observedAt?: string } {
  return time ? { observedAt: time } : {};
}

// The page. An alert first when any scale is above 0: warning for levels 1
// and 2, severe from 3 (NOAA's own "strong").
export function conditionsPage(conditions: Conditions): PageAnswer {
  const sections: Section[] = [];
  const raised = (['R', 'S', 'G'] as const)
    .map(letter => ({ letter, scale: conditions.scales[letter], n: Number(conditions.scales[letter].slice(1)) }))
    .filter(entry => Number.isInteger(entry.n) && entry.n > 0);
  if (raised.length > 0) {
    const worst = Math.max(...raised.map(entry => entry.n));
    const text = raised.map(entry => {
      const words = conditions.scaleText[entry.letter];
      return `${entry.scale} ${KIND[entry.letter]}${words ? ` (${words})` : ''}`;
    }).join('; ');
    sections.push({ shape: 'alert', level: worst >= 3 ? 'severe' : 'warning', text: `${text}.` });
  }
  sections.push({ shape: 'figures', figures: [
    // No unit after the flux: hams read the number alone (KI7MT, 2026-10-22).
    conditions.sfi !== undefined ? { label: 'Solar flux', value: String(conditions.sfi), ...at(conditions.sfiAt) } : { label: 'Solar flux', value: 'not read' },
    conditions.kp !== undefined ? { label: 'K index', value: String(conditions.kp), ...at(conditions.kpAt) } : { label: 'K index', value: 'not read' },
    // The A index is from the K index's row, so it has the K index's time.
    conditions.a !== undefined ? { label: 'A index', value: String(conditions.a), ...at(conditions.kpAt) } : { label: 'A index', value: 'not read' },
    { label: 'NOAA scales', value: `${conditions.scales.R} ${conditions.scales.S} ${conditions.scales.G}`, ...at(conditions.scalesAt) }
  ] });
  // What the three letters are, said once under the figures (KI7MT,
  // 2026-10-24: "I'm not sure what R0 S0 G0 is").
  sections.push({ shape: 'text', text: 'NOAA scales, 0 (none) to 5 (extreme): R radio blackouts, fading HF by day; S solar radiation storms, absorbing HF at the poles; G geomagnetic storms, disturbing HF and bringing aurora.' });
  // Band | Status | Comment, the status on the scale in BAND-OUTLOOK.md
  // (KI7MT, 2026-10-22). A table, so page data version 2.
  if (conditions.bands) {
    sections.push({ shape: 'table', columns: ['Band', 'Status', 'Comment'],
      rows: outlookRows(conditions.bands).map(row => [row.band, row.status, row.comment]) });
  }
  return { ok: true, data: { version: 6, observedAt: conditions.observedAt, sections } };
}
