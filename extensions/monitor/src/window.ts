// SPDX-License-Identifier: GPL-3.0-only
// What the Monitor holds (QGD-INT-0023): for each source, what its program
// last said it was doing, and its decodes grouped by cycle, in a window of
// bounded length. No context here, so it runs under unit tests with time the
// test gives it.
//
// A cycle is the time the program stamped on its decodes: WSJT-X stamps
// every decode of one cycle with that cycle's start, in UTC (QGD-INV-0013).
// The stamp is a time of day; it is placed on today's UTC date, or
// yesterday's when it is later than now, so a window that crosses midnight
// still runs newest first.
import type { DeliveredEvent } from '../../../packages/extension-api/integration-events.js';

// The most cycles kept per source, and decodes in all: within what a page
// may draw (pages.ts PAGE_LIMITS: 40 groups, 500 rows).
export const MAX_CYCLES = 40;
export const MAX_DECODES = 500;
// Sources held at once. More than a station runs; the one unheard longest
// goes first.
export const MAX_SOURCES = 10;

const DAY_MS = 86_400_000;

export interface Status {
  readonly dialHz: number;
  readonly mode: string;
  readonly transmitting: boolean;
  readonly decoding: boolean;
}

export interface Decode {
  // When the cycle began, in milliseconds since the epoch, UTC.
  readonly cycle: number;
  readonly snr: number;
  readonly dt: number;
  // Audio offset in hertz, or for WSPR the frequency.
  readonly df: number;
  readonly frequencyHz?: number;
  readonly message: string;
  readonly lowConfidence: boolean;
  readonly offAir: boolean;
  readonly wspr: boolean;
}

export interface Source {
  // The adapter and the program's own name for this copy (QGD-INT-0011).
  readonly key: string;
  readonly adapter: string;
  readonly name: string;
  // In the order first heard, for its tab's place and id.
  readonly order: number;
  status?: Status;
  heardAt: number;
  closed: boolean;
  decodes: Decode[];
}

// A time of day, placed on the UTC date that makes it no later than now.
export function placeTime(msOfDay: number, now: number): number {
  const midnight = Math.floor(now / DAY_MS) * DAY_MS;
  const today = midnight + msOfDay;
  // Up to a minute ahead is the clocks disagreeing, not yesterday.
  return today > now + 60_000 ? today - DAY_MS : today;
}

export function createWindow() {
  const sources = new Map<string, Source>();
  let next = 0;

  function sourceOf(event: DeliveredEvent, now: number): Source {
    const key = `${event.adapter}\u0000${event.source}`;
    let source = sources.get(key);
    if (!source) {
      source = { key, adapter: event.adapter, name: event.source, order: next++, heardAt: now, closed: false, decodes: [] };
      sources.set(key, source);
      while (sources.size > MAX_SOURCES) {
        const oldest = [...sources.values()].sort((a, b) => a.heardAt - b.heardAt)[0];
        sources.delete(oldest.key);
      }
    }
    source.heardAt = now;
    source.closed = false;
    return source;
  }

  function keep(source: Source): void {
    // Newest first; a decode already held (a Replay of one we had) is not
    // held twice.
    source.decodes.sort((a, b) => b.cycle - a.cycle);
    const cycles: number[] = [];
    source.decodes = source.decodes.filter(decode => {
      if (!cycles.includes(decode.cycle)) cycles.push(decode.cycle);
      return cycles.length <= MAX_CYCLES;
    }).slice(0, MAX_DECODES);
  }

  const same = (a: Decode, b: Decode) => a.cycle === b.cycle && a.message === b.message && a.df === b.df && a.wspr === b.wspr;

  return {
    // The events an adapter sent; says whether anything shown changed.
    take(events: readonly DeliveredEvent[], now: number): boolean {
      const touched = new Set<Source>();
      for (const event of events) {
        const source = sourceOf(event, now);
        switch (event.type) {
          case 'heartbeat':
            break;
          case 'status':
            source.status = { dialHz: event.dialHz, mode: event.mode, transmitting: event.transmitting, decoding: event.decoding };
            break;
          case 'decode':
          case 'wspr': {
            const decode: Decode = event.type === 'decode'
              ? { cycle: placeTime(event.time, now), snr: event.snr, dt: event.dt, df: event.df, message: event.message,
                  lowConfidence: event.lowConfidence, offAir: event.offAir, wspr: false }
              : { cycle: placeTime(event.time, now), snr: event.snr, dt: event.dt, df: 0, frequencyHz: event.frequencyHz,
                  message: `${event.callsign} ${event.grid} ${event.power}`.trim(), lowConfidence: false, offAir: event.offAir, wspr: true };
            if (!source.decodes.some(held => same(held, decode))) source.decodes.push(decode);
            break;
          }
          case 'clear':
            // The band activity window, or both: what was in it goes.
            if (event.window !== 1) source.decodes = [];
            break;
          case 'close':
            source.closed = true;
            break;
        }
        touched.add(source);
      }
      for (const source of touched) keep(source);
      return touched.size > 0;
    },
    // Every source, in the order first heard.
    sources(): Source[] {
      return [...sources.values()].sort((a, b) => a.order - b.order);
    },
    clear(): void { sources.clear(); next = 0; }
  };
}

export type MonitorWindow = ReturnType<typeof createWindow>;
