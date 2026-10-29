// SPDX-License-Identifier: GPL-3.0-only
// WSJT-X's UDP protocol, as `Network/NetworkMessage.hpp` defines it
// (QGD-INT-0022): schema 3, big-endian QDataStream.
//
//   header   quint32 magic 0xadbccbda, quint32 schema, quint32 type, utf8 Id
//   utf8     quint32 length then that many bytes; 0xffffffff is a null string
//   QTime    quint32 milliseconds since midnight (UTC, as WSJT-X stamps it)
//   bool     one byte; float is serialized as a double
//
// What this reads is Heartbeat (0), Status (1), Decode (2), Clear (3),
// Close (6) and WSPRDecode (10). Any other type is ignored, as the protocol
// requires of a server, and so are fields past the ones read here: a later
// WSJT-X may add them. Anything else that does not read exactly is
// malformed, dropped and counted, never shown and never guessed at
// (QGD-INT-0008). The one message written is Replay (7), WSJT-X's own way to
// ask for the decodes already in its window.

export const MAGIC = 0xadbccbda;
export const SCHEMA = 3;

export const TYPE = { heartbeat: 0, status: 1, decode: 2, clear: 3, close: 6, replay: 7, wsprDecode: 10 } as const;

// The longest string read from any field. Every field here is short; a
// length beyond this is a datagram that is not WSJT-X's.
const STRING_MAX = 512;

export type Message =
  | { readonly type: 'heartbeat'; readonly id: string; readonly maxSchema?: number; readonly version?: string; readonly revision?: string }
  | {
      readonly type: 'status'; readonly id: string; readonly dialHz: number; readonly mode: string; readonly dxCall: string;
      readonly report: string; readonly txMode: string; readonly txEnabled: boolean; readonly transmitting: boolean;
      readonly decoding: boolean; readonly deCall?: string; readonly deGrid?: string; readonly dxGrid?: string;
      readonly subMode?: string; readonly configuration?: string;
    }
  | {
      readonly type: 'decode'; readonly id: string; readonly isNew: boolean; readonly time: number; readonly snr: number;
      readonly dt: number; readonly df: number; readonly mode: string; readonly message: string;
      readonly lowConfidence: boolean; readonly offAir: boolean;
    }
  | {
      readonly type: 'wspr'; readonly id: string; readonly isNew: boolean; readonly time: number; readonly snr: number;
      readonly dt: number; readonly frequencyHz: number; readonly drift: number; readonly callsign: string;
      readonly grid: string; readonly power: number; readonly offAir: boolean;
    }
  | { readonly type: 'clear'; readonly id: string; readonly window: 0 | 1 | 2 }
  | { readonly type: 'close'; readonly id: string };

// What reading a datagram came to.
export type Read =
  | { readonly outcome: 'message'; readonly message: Message }
  // WSJT-X's, of a type this does not read.
  | { readonly outcome: 'ignored'; readonly type: number }
  | { readonly outcome: 'malformed' };

class Short extends Error {}

const utf8 = new TextDecoder('utf-8', { fatal: true });

class Reader {
  private at = 0;
  private readonly view: DataView;
  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  private need(n: number): void { if (this.at + n > this.bytes.byteLength) throw new Short(); }
  get left(): number { return this.bytes.byteLength - this.at; }
  u8(): number { this.need(1); return this.view.getUint8(this.at++); }
  bool(): boolean {
    const value = this.u8();
    // QDataStream writes a bool as 0 or 1; anything else is not one.
    if (value > 1) throw new Short();
    return value === 1;
  }
  u32(): number { this.need(4); const value = this.view.getUint32(this.at); this.at += 4; return value; }
  i32(): number { this.need(4); const value = this.view.getInt32(this.at); this.at += 4; return value; }
  u64(): number {
    this.need(8);
    const value = this.view.getBigUint64(this.at);
    this.at += 8;
    // A dial frequency in hertz: anything past what a number holds exactly is not one.
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Short();
    return Number(value);
  }
  f64(): number { this.need(8); const value = this.view.getFloat64(this.at); this.at += 8; return value; }
  // A null string reads as undefined, an empty one as ''.
  text(): string | undefined {
    const length = this.u32();
    if (length === 0xffffffff) return undefined;
    if (length > STRING_MAX) throw new Short();
    this.need(length);
    const slice = this.bytes.subarray(this.at, this.at + length);
    this.at += length;
    // Not UTF-8 is not WSJT-X's (fatal: true throws).
    return utf8.decode(slice);
  }
  // Absent and null are one thing to a reader that shows text.
  string(): string { return this.text() ?? ''; }
  time(): number {
    const ms = this.u32();
    // A null QTime is 0xffffffff; a decode with no time is malformed here.
    if (ms >= 86_400_000) throw new Short();
    return ms;
  }
}

export function readMessage(bytes: Uint8Array): Read {
  try {
    const reader = new Reader(bytes);
    if (reader.u32() !== MAGIC) return { outcome: 'malformed' };
    const schema = reader.u32();
    // Schema 1 was Qt's broken format, and a schema from the future is not
    // one this can promise to read; 2 and 3 read the same for these types.
    if (schema < 2 || schema > SCHEMA) return { outcome: 'malformed' };
    const type = reader.u32();
    const id = reader.text();
    if (id === undefined || id === '') return { outcome: 'malformed' };
    switch (type) {
      case TYPE.heartbeat: {
        // The maximum schema arrived with schema 3; older clients end here.
        if (reader.left === 0) return { outcome: 'message', message: { type: 'heartbeat', id } };
        const maxSchema = reader.u32();
        const version = reader.left > 0 ? reader.text() : undefined;
        const revision = reader.left > 0 ? reader.text() : undefined;
        return { outcome: 'message', message: { type: 'heartbeat', id, maxSchema, ...(version ? { version } : {}), ...(revision !== undefined ? { revision } : {}) } };
      }
      case TYPE.status: {
        const dialHz = reader.u64();
        const mode = reader.string();
        const dxCall = reader.string();
        const report = reader.string();
        const txMode = reader.string();
        const txEnabled = reader.bool();
        const transmitting = reader.bool();
        const decoding = reader.bool();
        const message: { -readonly [K in keyof Extract<Message, { type: 'status' }>]: Extract<Message, { type: 'status' }>[K] } =
          { type: 'status', id, dialHz, mode, dxCall, report, txMode, txEnabled, transmitting, decoding };
        // The rest arrived over the protocol's life: read while present.
        if (reader.left > 0) {
          reader.u32(); reader.u32(); // Rx DF, Tx DF
          message.deCall = reader.string();
          message.deGrid = reader.string();
          message.dxGrid = reader.string();
          if (reader.left > 0) {
            reader.bool(); // Tx watchdog
            message.subMode = reader.string();
            reader.bool(); // fast mode
            if (reader.left > 0) {
              reader.u8(); // special operation mode
              reader.u32(); reader.u32(); // frequency tolerance, T/R period
              message.configuration = reader.string();
            }
          }
        }
        return { outcome: 'message', message };
      }
      case TYPE.decode: {
        const isNew = reader.bool();
        const time = reader.time();
        const snr = reader.i32();
        const dt = reader.f64();
        const df = reader.u32();
        const mode = reader.string();
        const message = reader.string();
        const lowConfidence = reader.bool();
        const offAir = reader.bool();
        if (!Number.isFinite(dt)) return { outcome: 'malformed' };
        return { outcome: 'message', message: { type: 'decode', id, isNew, time, snr, dt, df, mode, message, lowConfidence, offAir } };
      }
      case TYPE.wsprDecode: {
        const isNew = reader.bool();
        const time = reader.time();
        const snr = reader.i32();
        const dt = reader.f64();
        const frequencyHz = reader.u64();
        const drift = reader.i32();
        const callsign = reader.string();
        const grid = reader.string();
        const power = reader.i32();
        const offAir = reader.bool();
        if (!Number.isFinite(dt)) return { outcome: 'malformed' };
        return { outcome: 'message', message: { type: 'wspr', id, isNew, time, snr, dt, frequencyHz, drift, callsign, grid, power, offAir } };
      }
      case TYPE.clear: {
        // The window is In only: WSJT-X sends Clear without it.
        const window = reader.left > 0 ? reader.u8() : 0;
        if (window > 2) return { outcome: 'malformed' };
        return { outcome: 'message', message: { type: 'clear', id, window: window as 0 | 1 | 2 } };
      }
      case TYPE.close:
        return { outcome: 'message', message: { type: 'close', id } };
      default:
        return { outcome: 'ignored', type };
    }
  } catch {
    // Short, not UTF-8, or a field out of what its type holds.
    return { outcome: 'malformed' };
  }
}

// Replay, to the instance named `id`: the decodes already in its window,
// then a Status (NetworkMessage.hpp, Replay).
export function replayMessage(id: string): Uint8Array {
  const name = new TextEncoder().encode(id);
  const bytes = new Uint8Array(16 + name.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, MAGIC);
  view.setUint32(4, SCHEMA);
  view.setUint32(8, TYPE.replay);
  view.setUint32(12, name.length);
  bytes.set(name, 16);
  return bytes;
}
