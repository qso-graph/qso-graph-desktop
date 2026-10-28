// SPDX-License-Identifier: GPL-3.0-only
// The installer's artwork (#122): the bitmaps NSIS loads are 24-bit BMPs at its sizes, and the
// writer that makes them puts each pixel where Windows reads it (bottom-up rows, BGR, rows padded
// to four bytes). A wrong order shows as wrong colours with no error anywhere, so it is pinned here.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bmp, halve, PIECES } from '../scripts/gen-installer-art.mjs';

describe('the installer artwork (#122)', () => {
  it('writes rows bottom-up, as BGR, padded to four bytes', () => {
    // 2 x 2: top-left red, top-right green, bottom-left blue, bottom-right white.
    const file = bmp({ width: 2, height: 2, rgb: Uint8Array.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]) });
    expect(file.subarray(0, 2).toString('ascii')).toBe('BM');
    expect(file.readUInt16LE(28)).toBe(24);
    expect(file.length).toBe(54 + 8 * 2);
    // First row in the file is the bottom one: blue then white, then 2 bytes of padding.
    expect([...file.subarray(54, 62)]).toEqual([255, 0, 0, 255, 255, 255, 0, 0]);
    // Then the top row: red, green.
    expect([...file.subarray(62, 68)]).toEqual([0, 0, 255, 0, 255, 0]);
  });

  it('averages each 2 x 2 block into one pixel', () => {
    const pixels = new Uint8Array(2 * 2 * 4);
    [[0, 0, 0], [100, 0, 0], [0, 100, 0], [100, 100, 200]].forEach(([r, g, b], n) => pixels.set([r, g, b, 255], n * 4));
    expect([...halve({ width: 2, height: 2, pixels }).rgb]).toEqual([50, 50, 50]);
    expect(() => halve({ width: 3, height: 2, pixels: new Uint8Array(24) })).toThrow(/not a multiple/);
  });

  it('the committed bitmaps are what NSIS takes: 24-bit, at its sizes', () => {
    for (const [, file, width, height] of PIECES) {
      const data = readFileSync(file);
      expect(data.subarray(0, 2).toString('ascii'), file).toBe('BM');
      expect([data.readInt32LE(18), data.readInt32LE(22), data.readUInt16LE(28)], file).toEqual([width, height, 24]);
    }
  });
});
