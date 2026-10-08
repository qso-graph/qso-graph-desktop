// SPDX-License-Identifier: GPL-3.0-only
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { compare, decode } from '../scripts/png.mjs';

// The committed baselines are the real input this decoder exists to read, so
// they are what it is tested against rather than something synthesised.
const load = name => readFile(`baselines/${name}.png`).then(decode);

describe('reading a screenshot', () => {
  it('reads the size the window was captured at', async () => {
    const image = await load('personas-light');
    expect([image.width, image.height]).toEqual([1100, 740]);
    expect(image.pixels.length).toBe(1100 * 740 * 4);
  });

  it('reads pixels rather than returning a blank image', async () => {
    // A decoder that returned zeroes would make every baseline comparison
    // pass, which is the failure this guards.
    const image = await load('personas-light');
    const distinct = new Set();
    for (let i = 0; i < image.pixels.length; i += 4) {
      distinct.add(image.pixels.readUInt32BE(i));
      if (distinct.size > 50) break;
    }
    expect(distinct.size).toBeGreaterThan(50);
  });

  it('refuses what it cannot read instead of guessing', async () => {
    const file = await readFile('baselines/personas-light.png');
    expect(() => decode(Buffer.from('not a png at all'))).toThrow(/not a PNG/);

    const depth = Buffer.from(file);
    depth[24] = 16; // IHDR bit depth
    expect(() => decode(depth)).toThrow(/unsupported bit depth 16/);

    const interlaced = Buffer.from(file);
    interlaced[28] = 1; // IHDR interlace method
    expect(() => decode(interlaced)).toThrow(/interlaced/);
  });
});

describe('comparing two screenshots', () => {
  it('calls an image identical to itself identical', async () => {
    const image = await load('settings-dark');
    expect(compare(image, image).same).toBe(true);
  });

  it('notices a single changed pixel', async () => {
    const before = await load('settings-dark');
    const after = await load('settings-dark');
    after.pixels[(400 * before.width + 500) * 4] ^= 0xff;
    const result = compare(before, after);
    expect(result.same).toBe(false);
    expect(result.differing).toBe(1);
    expect(result.first).toEqual({ x: 500, y: 400 });
  });

  it('notices that light and dark are not the same picture', async () => {
    const light = await load('personas-light');
    const dark = await load('personas-dark');
    const result = compare(light, dark);
    expect(result.same).toBe(false);
    // Most of the page, not a handful of pixels: these are two themes.
    expect(result.differing / result.total).toBeGreaterThan(0.5);
  });

  it('reports a size change rather than comparing the wrong pixels', async () => {
    const image = await load('personas-light');
    const smaller = { width: image.width, height: image.height - 1, pixels: image.pixels };
    expect(compare(image, smaller)).toMatchObject({ same: false, differing: null });
    expect(compare(image, smaller).reason).toMatch(/size changed/);
  });

  it('applies the tolerance per channel, and zero means zero', async () => {
    const before = await load('settings-dark');
    const after = await load('settings-dark');
    after.pixels[0] += 2;
    expect(compare(before, after, 0).differing).toBe(1);
    expect(compare(before, after, 1).differing).toBe(1);
    expect(compare(before, after, 2).same).toBe(true);
  });
});
