// SPDX-License-Identifier: GPL-3.0-or-later
// The WSJT-X adapter's work: events out, and Replay once per copy heard
// (QGD-INT-0011, QGD-INT-0022).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createAdapter } from '../src/adapter.js';
import { replayMessage } from '../src/protocol.js';

const fixture = (name: string) => (JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8')) as { datagrams: string[] })
  .datagrams.map(hex => new Uint8Array(Buffer.from(hex, 'hex')));
const capture = fixture('qg-interop-0.1.0.json');
const from = '127.0.0.1:50123';

describe('the WSJT-X adapter', () => {
  it('turns a session into events, in order, and asks for Replay once', () => {
    const adapter = createAdapter();
    const { events, replies, malformed } = adapter.receive(capture.map(bytes => ({ from, bytes })));
    expect(malformed).toBe(0);
    expect(events).toHaveLength(capture.length);
    expect(events[0].type).toBe('heartbeat');
    expect(events.at(-1)!.type).toBe('close');
    expect(replies).toEqual([{ to: from, bytes: replayMessage('WSJT-X') }]);
    // The capture holds the simulator's answer to that Replay: decodes it
    // already had, marked not new.
    expect(events.some(event => event.type === 'decode' && !event.isNew)).toBe(true);
  });

  it('keeps two copies of WSJT-X apart, and asks each', () => {
    const adapter = createAdapter();
    const rename = (bytes: Uint8Array, id: string) => {
      // The Id is the header's string: replace it, keeping the rest.
      const length = new DataView(bytes.buffer, bytes.byteOffset).getUint32(12);
      const name = Buffer.from(id);
      const out = Buffer.alloc(bytes.length - length + name.length);
      Buffer.from(bytes.subarray(0, 12)).copy(out, 0);
      out.writeUInt32BE(name.length, 12);
      name.copy(out, 16);
      Buffer.from(bytes.subarray(16 + length)).copy(out, 16 + name.length);
      return new Uint8Array(out);
    };
    const { events, replies } = adapter.receive([
      { from, bytes: rename(capture[0], 'WSJT-X - IC-7300') },
      { from: '127.0.0.1:50999', bytes: rename(capture[0], 'WSJT-X - FTDX10') },
      { from, bytes: rename(capture[1], 'WSJT-X - IC-7300') }
    ]);
    expect(events.map(event => event.source)).toEqual(['WSJT-X - IC-7300', 'WSJT-X - FTDX10', 'WSJT-X - IC-7300']);
    expect(replies.map(reply => reply.to)).toEqual([from, '127.0.0.1:50999']);
  });

  it('asks again after a copy closes, or when it is heard from elsewhere', () => {
    const adapter = createAdapter();
    const close = capture.find(bytes => new DataView(bytes.buffer, bytes.byteOffset).getUint32(8) === 6)!;
    expect(adapter.receive([{ from, bytes: capture[0] }]).replies).toHaveLength(1);
    expect(adapter.receive([{ from, bytes: capture[1] }]).replies).toHaveLength(0);
    expect(adapter.receive([{ from: '127.0.0.1:60000', bytes: capture[1] }]).replies).toHaveLength(1);
    adapter.receive([{ from: '127.0.0.1:60000', bytes: close }]);
    expect(adapter.receive([{ from: '127.0.0.1:60000', bytes: capture[0] }]).replies).toHaveLength(1);
  });

  // JTTY's text (JTTYText, type 19, as WSJT-X pull request 171 proposes it) is
  // not read yet: it is ignored as any type this does not read is, never counted
  // as malformed, and the rest of the session still arrives.
  it('ignores JTTY text and keeps the session around it', () => {
    // In fixtures/not-read/, out of the sessions protocol.test.ts reads in full.
    const jtty = fixture('not-read/qg-interop-0.2.0-beta.1-jtty.json');
    const types = jtty.map(bytes => new DataView(bytes.buffer, bytes.byteOffset).getUint32(8));
    expect(types.filter(type => type === 19).length).toBeGreaterThan(0);
    const { events, malformed } = createAdapter().receive(jtty.map(bytes => ({ from, bytes })));
    expect(malformed).toBe(0);
    expect(events.map(event => event.type)).toEqual(['heartbeat', 'status', 'close']);
    expect(events[1]).toMatchObject({ type: 'status', mode: 'JTTY' });
  });

  it('counts what it cannot read, and sends nothing for it', () => {
    const adapter = createAdapter();
    const outcome = adapter.receive([{ from, bytes: new Uint8Array([1, 2, 3]) }, { from, bytes: capture[0].slice(0, 20) }]);
    expect(outcome).toEqual({ events: [], replies: [], malformed: 2 });
  });
});
