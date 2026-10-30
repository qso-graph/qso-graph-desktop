// SPDX-License-Identifier: GPL-3.0-only
// What an adapter tells the core it decoded, and what a consumer receives
// (QGD-INT-0008, QGD-INT-0021).
//
// The events are the core's, not a program's: an adapter turns its
// program's messages into these and nothing else, the core checks every one
// field by field before any consumer sees it, and a consumer never sees a
// byte (QGD-INT-0021). They are shaped by what the programs that talk this
// way say — WSJT-X first, whose Heartbeat, Status, Decode, WSPRDecode, Clear
// and Close they follow — and are added to, never changed, as the extension
// API's other shapes are (QGD-APP-0019).
//
// No dependencies: this package depends on nothing (QGD-REP-0006).

// Each event names its source, the program's own instance name
// (QGD-INT-0011): two copies of WSJT-X on two rigs are two sources.
export type IntegrationEvent =
  // The program is there. WSJT-X sends one every 15 seconds.
  | { readonly type: 'heartbeat'; readonly source: string; readonly version?: string; readonly revision?: string }
  // What the program is doing: the rig's dial frequency in hertz, the mode,
  // and whether it is transmitting and decoding.
  | {
      readonly type: 'status'; readonly source: string; readonly dialHz: number; readonly mode: string;
      readonly transmitting: boolean; readonly decoding: boolean; readonly txEnabled: boolean;
      readonly txMode?: string; readonly subMode?: string; readonly deCall?: string; readonly deGrid?: string;
      readonly dxCall?: string; readonly dxGrid?: string; readonly configuration?: string;
    }
  // One decode. `time` is milliseconds since midnight UTC (QGD-INV-0013),
  // as the program stamps it; `df` the audio offset in hertz; `isNew` false
  // for one the program already had (a Replay); `offAir` for one decoded
  // from a recording rather than the air.
  | {
      readonly type: 'decode'; readonly source: string; readonly isNew: boolean; readonly time: number;
      readonly snr: number; readonly dt: number; readonly df: number; readonly mode: string; readonly message: string;
      readonly lowConfidence: boolean; readonly offAir: boolean;
    }
  // One WSPR spot: the station heard, its grid and power in dBm, on
  // `frequencyHz`.
  | {
      readonly type: 'wspr'; readonly source: string; readonly isNew: boolean; readonly time: number;
      readonly snr: number; readonly dt: number; readonly frequencyHz: number; readonly drift: number;
      readonly callsign: string; readonly grid: string; readonly power: number; readonly offAir: boolean;
    }
  // The program cleared its window of decodes: the band activity (0), the
  // Rx frequency (1) or both (2).
  | { readonly type: 'clear'; readonly source: string; readonly window: 0 | 1 | 2 }
  // The program is closing.
  | { readonly type: 'close'; readonly source: string };

export type IntegrationEventType = IntegrationEvent['type'];

// As a consumer receives it: with the adapter it came from, which the core
// writes, never the adapter (QGD-INT-0021).
export type DeliveredEvent = IntegrationEvent & { readonly adapter: string };

// The most events in one batch, and the most an adapter may say it dropped
// in one.
export const MAX_EVENTS = 512;
export const MAX_MALFORMED = 100_000;

export class EventError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Printable ASCII and nothing else, at most `max`: what these programs send
// in these fields, and all the core will draw (QGD-INV-0007). A message with
// a character outside it is refused, not cleaned.
function plain(value: unknown, max: number, empty = false): value is string {
  if (typeof value !== 'string' || value.length > max || (!empty && value.length === 0)) return false;
  for (let at = 0; at < value.length; at += 1) {
    const code = value.charCodeAt(at);
    if (code < 0x20 || code > 0x7e) return false;
  }
  return true;
}

const whole = (value: unknown, low: number, high: number): value is number =>
  Number.isSafeInteger(value) && (value as number) >= low && (value as number) <= high;
const finite = (value: unknown, low: number, high: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= low && value <= high;
const flag = (value: unknown): value is boolean => typeof value === 'boolean';

// The longest of each kind of text.
const SOURCE = 64;
const MODE = 16;
const TEXT = 64;
const CALL = 16;
const GRID = 8;
const DAY_MS = 86_400_000;

// Each type's fields: those it must have, and those it may.
const REQUIRED: Readonly<Record<IntegrationEventType, readonly string[]>> = {
  heartbeat: ['type', 'source'],
  status: ['type', 'source', 'dialHz', 'mode', 'transmitting', 'decoding', 'txEnabled'],
  decode: ['type', 'source', 'isNew', 'time', 'snr', 'dt', 'df', 'mode', 'message', 'lowConfidence', 'offAir'],
  wspr: ['type', 'source', 'isNew', 'time', 'snr', 'dt', 'frequencyHz', 'drift', 'callsign', 'grid', 'power', 'offAir'],
  clear: ['type', 'source', 'window'],
  close: ['type', 'source']
};
const OPTIONAL: Readonly<Record<IntegrationEventType, readonly string[]>> = {
  heartbeat: ['version', 'revision'],
  status: ['txMode', 'subMode', 'deCall', 'deGrid', 'dxCall', 'dxGrid', 'configuration'],
  decode: [], wspr: [], clear: [], close: []
};

function check(value: Record<string, unknown>): boolean {
  switch (value.type) {
    case 'heartbeat':
      return (value.version === undefined || plain(value.version, MODE * 2))
        && (value.revision === undefined || plain(value.revision, MODE * 2, true));
    case 'status':
      return whole(value.dialHz, 0, 1e12) && plain(value.mode, MODE, true) && flag(value.transmitting) && flag(value.decoding) && flag(value.txEnabled)
        && (value.txMode === undefined || plain(value.txMode, MODE, true)) && (value.subMode === undefined || plain(value.subMode, MODE, true))
        && (value.deCall === undefined || plain(value.deCall, CALL, true)) && (value.deGrid === undefined || plain(value.deGrid, GRID, true))
        && (value.dxCall === undefined || plain(value.dxCall, CALL, true)) && (value.dxGrid === undefined || plain(value.dxGrid, GRID, true))
        && (value.configuration === undefined || plain(value.configuration, TEXT, true));
    case 'decode':
      return flag(value.isNew) && whole(value.time, 0, DAY_MS - 1) && whole(value.snr, -100, 100) && finite(value.dt, -60, 60)
        && whole(value.df, 0, 10_000) && plain(value.mode, MODE, true) && plain(value.message, TEXT, true)
        && flag(value.lowConfidence) && flag(value.offAir);
    case 'wspr':
      return flag(value.isNew) && whole(value.time, 0, DAY_MS - 1) && whole(value.snr, -100, 100) && finite(value.dt, -60, 60)
        && whole(value.frequencyHz, 0, 1e12) && whole(value.drift, -100, 100) && plain(value.callsign, CALL) && plain(value.grid, GRID, true)
        && whole(value.power, -30, 90) && flag(value.offAir);
    case 'clear':
      return value.window === 0 || value.window === 1 || value.window === 2;
    case 'close':
      return true;
    default:
      return false;
  }
}

// One event, as an adapter sent it, or an EventError saying why not.
export function validateEvent(value: unknown): IntegrationEvent {
  if (!isRecord(value) || typeof value.type !== 'string' || !Object.hasOwn(REQUIRED, value.type)) {
    throw new EventError('An event is not one of the kinds this product knows.');
  }
  const type = value.type as IntegrationEventType;
  const allowed = [...REQUIRED[type], ...OPTIONAL[type]];
  const extra = Object.keys(value).find(key => !allowed.includes(key));
  if (extra !== undefined) throw new EventError(`A ${type} event has no "${extra}".`);
  const missing = REQUIRED[type].find(key => !Object.hasOwn(value, key));
  if (missing !== undefined) throw new EventError(`A ${type} event has no "${missing}".`);
  // A source is a name the core draws on a tab and on Integrations' page,
  // where markup is refused (pages.ts), so it may hold none.
  if (!plain(value.source, SOURCE) || /[<>]/.test(value.source)) throw new EventError(`A ${type} event does not name its source in plain text.`);
  if (!check(value)) throw new EventError(`A ${type} event has a field out of its bounds.`);
  return { ...value } as IntegrationEvent;
}

export function validateEvents(value: unknown): IntegrationEvent[] {
  if (!Array.isArray(value) || value.length > MAX_EVENTS) throw new EventError(`Events come as a list of at most ${MAX_EVENTS}.`);
  return value.map(validateEvent);
}

// A delivered event, checked again where a consumer receives it: the core
// is trusted to have checked it, and the consumer checks anyway, since what
// crosses a boundary is checked on each side (QGD-INV-0007).
export function validateDelivered(value: unknown): DeliveredEvent {
  if (!isRecord(value) || typeof value.adapter !== 'string' || !/^[a-z][a-z0-9-]{1,30}$/.test(value.adapter)) {
    throw new EventError('A delivered event does not name its adapter.');
  }
  const { adapter, ...event } = value;
  return { ...validateEvent(event), adapter };
}
