// SPDX-License-Identifier: GPL-3.0-only
// The WSJT-X adapter's work (QGD-INT-0022): datagrams in, events out, and
// the one reply. No context here, so all of it runs under unit tests.
//
// Each copy of WSJT-X is a source of its own, by its Id (QGD-INT-0011). The
// first time one is heard, from a sender, it is asked for the decodes already
// in its window (Replay), so the Monitor is not empty when it opens; asked
// once, and again only after it closes or is heard from somewhere else.
import type { IntegrationEvent } from '../../../packages/extension-api/integration-events.js';
import { readMessage, replayMessage, type Message } from './protocol.js';

export interface Received {
  readonly from: string;
  readonly bytes: Uint8Array;
}

export interface Outcome {
  readonly events: IntegrationEvent[];
  // Replays to send: to the sender, the bytes.
  readonly replies: { readonly to: string; readonly bytes: Uint8Array }[];
  // Datagrams that were not WSJT-X's messages, read exactly (QGD-INT-0008).
  readonly malformed: number;
}

// A field present only when it says something.
const some = <K extends string>(key: K, value: string | undefined): Partial<Record<K, string>> =>
  value ? { [key]: value } as Record<K, string> : {};

export function toEvent(message: Message): IntegrationEvent | undefined {
  const source = message.id;
  switch (message.type) {
    case 'heartbeat':
      return { type: 'heartbeat', source, ...some('version', message.version), ...some('revision', message.revision) };
    case 'status':
      return {
        type: 'status', source, dialHz: message.dialHz, mode: message.mode, transmitting: message.transmitting,
        decoding: message.decoding, txEnabled: message.txEnabled, ...some('txMode', message.txMode), ...some('subMode', message.subMode),
        ...some('deCall', message.deCall), ...some('deGrid', message.deGrid), ...some('dxCall', message.dxCall), ...some('dxGrid', message.dxGrid)
      };
    case 'decode':
      return {
        type: 'decode', source, isNew: message.isNew, time: message.time, snr: message.snr, dt: message.dt, df: message.df,
        mode: message.mode, message: message.message, lowConfidence: message.lowConfidence, offAir: message.offAir
      };
    case 'wspr':
      return {
        type: 'wspr', source, isNew: message.isNew, time: message.time, snr: message.snr, dt: message.dt, frequencyHz: message.frequencyHz,
        drift: message.drift, callsign: message.callsign, grid: message.grid, power: message.power, offAir: message.offAir
      };
    case 'clear':
      return { type: 'clear', source, window: message.window };
    case 'close':
      return { type: 'close', source };
  }
}

export function createAdapter() {
  // Each instance heard, by its Id, and the sender it was asked from.
  const asked = new Map<string, string>();

  return {
    receive(datagrams: readonly Received[]): Outcome {
      const events: IntegrationEvent[] = [];
      const replies: { to: string; bytes: Uint8Array }[] = [];
      let malformed = 0;
      for (const datagram of datagrams) {
        const read = readMessage(datagram.bytes);
        if (read.outcome === 'malformed') { malformed += 1; continue; }
        if (read.outcome === 'ignored') continue;
        const { message } = read;
        if (message.type === 'close') {
          asked.delete(message.id);
        } else if (asked.get(message.id) !== datagram.from) {
          // New, or heard from a different sender: asked for what it has.
          asked.set(message.id, datagram.from);
          replies.push({ to: datagram.from, bytes: replayMessage(message.id) });
        }
        const event = toEvent(message);
        if (event) events.push(event);
      }
      return { events, replies, malformed };
    },
    // Turned off: what it knew goes with it, and on again it asks afresh.
    reset(): void { asked.clear(); }
  };
}
