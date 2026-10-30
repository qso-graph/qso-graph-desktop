// SPDX-License-Identifier: GPL-3.0-only
// WSJT-X's protocol as this adapter reads it (QGD-INT-0008, QGD-INT-0022).
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { MAGIC, TYPE, readMessage, replayMessage } from '../src/protocol.js';
import { toEvent } from '../src/adapter.js';
import { validateEvent } from '../../../packages/extension-api/integration-events.js';

// A message written as WSJT-X writes one: QDataStream, big-endian.
class Writer {
  private parts: number[] = [];
  u8(value: number) { this.parts.push(value & 0xff); return this; }
  bool(value: boolean) { return this.u8(value ? 1 : 0); }
  u32(value: number) { const b = Buffer.alloc(4); b.writeUInt32BE(value >>> 0); this.parts.push(...b); return this; }
  i32(value: number) { const b = Buffer.alloc(4); b.writeInt32BE(value); this.parts.push(...b); return this; }
  u64(value: number) { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(value)); this.parts.push(...b); return this; }
  f64(value: number) { const b = Buffer.alloc(8); b.writeDoubleBE(value); this.parts.push(...b); return this; }
  text(value: string | null) {
    if (value === null) return this.u32(0xffffffff);
    const bytes = Buffer.from(value, 'utf8');
    this.u32(bytes.length); this.parts.push(...bytes); return this;
  }
  header(type: number, id = 'WSJT-X', schema = 3) { return this.u32(MAGIC).u32(schema).u32(type).text(id); }
  bytes() { return new Uint8Array(this.parts); }
}

const decode = (message = 'CQ K7ABC DN13', time = 67_365_000) => new Writer().header(TYPE.decode).bool(true).u32(time).i32(-12).f64(0.2).u32(1234)
  .text('~').text(message).bool(false).bool(false);

const status = () => new Writer().header(TYPE.status).u64(14_074_000).text('FT8').text('JA1XYZ').text('-15').text('FT8')
  .bool(true).bool(false).bool(true).u32(1500).u32(1500).text('KI7MT').text('DN13').text('PM95').bool(false).text('').bool(false)
  .u8(0).u32(0xffffffff).u32(0xffffffff).text('Default').text('');

describe('reading WSJT-X\'s messages', () => {
  it('reads a Decode field by field', () => {
    expect(readMessage(decode().bytes())).toEqual({ outcome: 'message', message: {
      type: 'decode', id: 'WSJT-X', isNew: true, time: 67_365_000, snr: -12, dt: 0.2, df: 1234, mode: '~', message: 'CQ K7ABC DN13', lowConfidence: false, offAir: false
    } });
  });

  it('reads a Status, the whole of schema 3 and the shorter one an older WSJT-X sends', () => {
    const read = readMessage(status().bytes());
    expect(read).toMatchObject({ outcome: 'message', message: { type: 'status', dialHz: 14_074_000, mode: 'FT8', transmitting: false, decoding: true,
      txEnabled: true, deCall: 'KI7MT', deGrid: 'DN13', dxCall: 'JA1XYZ', dxGrid: 'PM95', configuration: 'Default' } });
    const older = new Writer().header(TYPE.status).u64(7_074_000).text('FT8').text('').text('').text('FT8').bool(false).bool(false).bool(false);
    expect(readMessage(older.bytes())).toMatchObject({ outcome: 'message', message: { type: 'status', dialHz: 7_074_000 } });
  });

  it('reads Heartbeat, Clear, Close and WSPRDecode', () => {
    expect(readMessage(new Writer().header(TYPE.heartbeat).u32(3).text('2.7.0').text('abc123').bytes()))
      .toEqual({ outcome: 'message', message: { type: 'heartbeat', id: 'WSJT-X', maxSchema: 3, version: '2.7.0', revision: 'abc123' } });
    expect(readMessage(new Writer().header(TYPE.clear).bytes())).toEqual({ outcome: 'message', message: { type: 'clear', id: 'WSJT-X', window: 0 } });
    expect(readMessage(new Writer().header(TYPE.close).bytes())).toEqual({ outcome: 'message', message: { type: 'close', id: 'WSJT-X' } });
    const wspr = new Writer().header(TYPE.wsprDecode).bool(true).u32(3_600_000).i32(-24).f64(0.5).u64(14_097_050).i32(-1)
      .text('K1ABC').text('FN42').i32(37).bool(false);
    expect(readMessage(wspr.bytes())).toMatchObject({ outcome: 'message', message: { type: 'wspr', frequencyHz: 14_097_050, callsign: 'K1ABC', grid: 'FN42', power: 37 } });
  });

  it('ignores a type it does not read, and fields past the ones it knows', () => {
    expect(readMessage(new Writer().header(5).text('anything').bytes())).toEqual({ outcome: 'ignored', type: 5 });
    const later = decode().u32(42).text('a field a later WSJT-X adds');
    expect(readMessage(later.bytes())).toMatchObject({ outcome: 'message', message: { type: 'decode' } });
  });

  it('drops what is not WSJT-X\'s message read exactly', () => {
    const bad = [
      new Uint8Array(),
      new Writer().u32(0xdeadbeef).u32(3).u32(2).text('WSJT-X').bytes(),
      new Writer().header(TYPE.decode, 'WSJT-X', 1).bytes(),
      new Writer().header(TYPE.decode, 'WSJT-X', 4).bytes(),
      new Writer().header(TYPE.decode, '').bytes(),
      new Writer().header(TYPE.decode, null as unknown as string).bytes(),
      decode().bytes().slice(0, 40),
      // A null time, a bool that is not 0 or 1, a length past the end.
      new Writer().header(TYPE.decode).bool(true).u32(0xffffffff).i32(0).f64(0).u32(0).text('~').text('x').bool(false).bool(false).bytes(),
      new Writer().header(TYPE.decode).u8(2).u32(0).i32(0).f64(0).u32(0).text('~').text('x').bool(false).bool(false).bytes(),
      new Writer().header(TYPE.decode).bool(true).u32(0).i32(0).f64(Number.NaN).u32(0).text('~').text('x').bool(false).bool(false).bytes(),
      new Writer().header(TYPE.clear).u8(3).bytes(),
      new Writer().u32(MAGIC).u32(3).u32(TYPE.decode).u32(100).bytes()
    ];
    for (const [at, bytes] of bad.entries()) expect(readMessage(bytes), `case ${at}`).toEqual({ outcome: 'malformed' });
    // Not UTF-8.
    const invalid = new Writer().header(TYPE.decode).bool(true).u32(0).i32(0).f64(0).u32(0).text('~').bytes();
    const broken = new Uint8Array([...invalid, 0, 0, 0, 2, 0xc3, 0x28, 0, 0]);
    expect(readMessage(broken)).toEqual({ outcome: 'malformed' });
  });

  it('writes Replay as NetworkMessage.hpp defines it', () => {
    const bytes = replayMessage('WSJT-X');
    expect(Buffer.from(bytes).toString('hex')).toBe('adbccbda0000000300000007000000065753' + '4a542d58');
  });
});

describe('against captured messages', () => {
  // Every capture in fixtures/: the simulator's, and WSJT-X's own once taken
  // from a lab machine (QGD-INT-0024). Not vacuous: there is at least one.
  const files = readdirSync(join(import.meta.dirname, 'fixtures')).filter(name => name.endsWith('.json'));
  it('has captures to read', () => { expect(files.length).toBeGreaterThan(0); });
  for (const file of files) {
    it(`reads every datagram in ${file}, and each becomes an event the core accepts`, () => {
      const capture = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', file), 'utf8')) as { datagrams: string[] };
      expect(capture.datagrams.length).toBeGreaterThan(10);
      const types = new Set<string>();
      for (const hex of capture.datagrams) {
        const read = readMessage(new Uint8Array(Buffer.from(hex, 'hex')));
        expect(read.outcome, hex).toBe('message');
        if (read.outcome !== 'message') continue;
        types.add(read.message.type);
        const event = toEvent(read.message)!;
        expect(() => validateEvent(event), JSON.stringify(event)).not.toThrow();
      }
      // Each capture holds a session's worth: the types it was taken for.
      for (const type of ['heartbeat', 'status', 'decode', 'close']) expect(types, type).toContain(type);
    });
  }
});

// A small, seeded generator, so a failure names a case that can be run again.
function generator(seed: number) {
  let state = seed >>> 0;
  return () => { state = (state * 1_664_525 + 1_013_904_223) >>> 0; return state / 2 ** 32; };
}

describe('fuzzed', () => {
  it('never throws, and anything it reads becomes an event the core accepts or is dropped', () => {
    const random = generator(0x7a11);
    const seeds = [decode().bytes(), status().bytes(), new Writer().header(TYPE.heartbeat).u32(3).text('2.7.0').text('').bytes(), new Writer().header(TYPE.clear).bytes()];
    let read = 0;
    for (let n = 0; n < 20_000; n += 1) {
      let bytes: Uint8Array;
      if (n % 4 === 0) {
        bytes = new Uint8Array(Math.floor(random() * 200));
        for (let at = 0; at < bytes.length; at += 1) bytes[at] = Math.floor(random() * 256);
      } else {
        // A real message with bytes changed, cut or added.
        const seed = seeds[n % seeds.length];
        bytes = new Uint8Array(seed);
        const changes = 1 + Math.floor(random() * 4);
        for (let c = 0; c < changes; c += 1) bytes[Math.floor(random() * bytes.length)] = Math.floor(random() * 256);
        if (random() < 0.3) bytes = bytes.slice(0, Math.floor(random() * bytes.length));
      }
      const result = readMessage(bytes);
      if (result.outcome !== 'message') continue;
      read += 1;
      const event = toEvent(result.message)!;
      // The host checks each event before it leaves (runtime.ts); one it
      // refuses is dropped there and counted. Either way, nothing throws.
      try { validateEvent(event); } catch { /* refused, as it should be */ }
    }
    // Not vacuous: plenty of the mutated messages still read.
    expect(read).toBeGreaterThan(1_000);
  });
});
