// SPDX-License-Identifier: GPL-3.0-only
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { colourCount, compare, decode, describeDiff } from '../scripts/png.mjs';

// The committed baselines are the real input this decoder exists to read, so
// they are what it is tested against rather than something synthesised.
const load = name => readFile(`baselines/${name}.png`).then(decode);

describe('reading a screenshot', () => {
  it('reads the size the window was captured at', async () => {
    const image = await load('callsigns-light');
    expect([image.width, image.height]).toEqual([1100, 740]);
    expect(image.pixels.length).toBe(1100 * 740 * 4);
  });

  it('reads pixels rather than returning a blank image', async () => {
    // A decoder that returned zeroes would make every baseline comparison
    // pass, which is the failure this guards.
    const image = await load('callsigns-light');
    const distinct = new Set();
    for (let i = 0; i < image.pixels.length; i += 4) {
      distinct.add(image.pixels.readUInt32BE(i));
      if (distinct.size > 50) break;
    }
    expect(distinct.size).toBeGreaterThan(50);
  });

  it('refuses what it cannot read instead of guessing', async () => {
    const file = await readFile('baselines/callsigns-light.png');
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
    const light = await load('callsigns-light');
    const dark = await load('callsigns-dark');
    const result = compare(light, dark);
    expect(result.same).toBe(false);
    // Most of the page, not a handful of pixels: these are two themes.
    expect(result.differing / result.total).toBeGreaterThan(0.5);
  });

  it('reports a size change rather than comparing the wrong pixels', async () => {
    const image = await load('callsigns-light');
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

describe('describing a difference', () => {
  // Why this is tested at all: when the screenshot suite began failing
  // intermittently, all it said was "752 of 814000 pixels differ, first at
  // 12,68" — one coordinate and a count, which does not say where the
  // difference is or how it is shaped.
  //
  // What it must NOT do is name a cause. An earlier version inferred one from
  // the largest channel difference and got the suite's own failure wrong, so
  // these controls assert the measurements are there AND that no verdict is
  // attached to them.
  const image = (width, height, fill) => {
    const pixels = new Uint8Array(width * height * 4);
    for (let i = 0; i < pixels.length; i += 4) pixels.set(fill, i);
    return { width, height, pixels };
  };
  const set = (img, x, y, colour) => {
    img.pixels.set(colour, (y * img.width + x) * 4);
  };

  it('gives the region, the density and how far off the channels are', () => {
    const was = image(8, 8, [10, 20, 30, 255]);
    const now = image(8, 8, [10, 20, 30, 255]);
    set(now, 3, 4, [10, 20, 32, 255]);
    const said = describeDiff(was, now);
    expect(said).toContain('region x 3..3, y 4..4 (1x1 of 8x8)');
    expect(said).toContain('1 differing pixel(s), 100% of that region');
    expect(said).toContain('worst channel off by 2');
    // The actual colours, so a reader can see it for themselves.
    expect(said).toContain('(3,4) was 10/20/30/255 now 10/20/32/255');
  });

  it('separates a sparse outline from a solid block by density, not by verdict', () => {
    // Same bounding box, same worst channel, different shape. The numbers
    // differ; neither is labelled.
    const solidWas = image(8, 8, [0, 0, 0, 255]);
    const solidNow = image(8, 8, [0, 0, 0, 255]);
    for (let x = 0; x < 4; x++) for (let y = 2; y < 4; y++) set(solidNow, x, y, [255, 255, 255, 255]);
    const solid = describeDiff(solidWas, solidNow);
    expect(solid).toContain('region x 0..3, y 2..3 (4x2 of 8x8)');
    expect(solid).toContain('8 differing pixel(s), 100% of that region');

    const sparseWas = image(8, 8, [0, 0, 0, 255]);
    const sparseNow = image(8, 8, [0, 0, 0, 255]);
    set(sparseNow, 0, 2, [255, 255, 255, 255]);
    set(sparseNow, 3, 3, [255, 255, 255, 255]);
    const sparse = describeDiff(sparseWas, sparseNow);
    expect(sparse).toContain('region x 0..3, y 2..3 (4x2 of 8x8)');
    expect(sparse).toContain('2 differing pixel(s), 25% of that region');
  });

  it('names no cause, however large or small the difference', () => {
    // The control on the defect itself. 100/100/100 to 102/102/102 is a real
    // colour change that the old rule called antialiasing, and 20 levels over
    // a thin outline is antialiasing that it called a layout change.
    const tinyWas = image(4, 4, [100, 100, 100, 100]);
    const tinyNow = image(4, 4, [102, 102, 102, 102]);
    const bigWas = image(4, 4, [0, 0, 0, 255]);
    const bigNow = image(4, 4, [255, 255, 255, 255]);
    for (const said of [describeDiff(tinyWas, tinyNow), describeDiff(bigWas, bigNow)]) {
      for (const verdict of ['rasteris', 'antialias', 'moved', 'layout', 'not a ']) {
        expect(said.toLowerCase(), `it must not conclude "${verdict}"`).not.toContain(verdict);
      }
    }
  });

  it('says so rather than throwing when the second pass finds nothing', () => {
    // compare and describeDiff decode separately, so a difference that is gone
    // by the time this runs is possible. It reports that instead of inventing
    // a region from Infinity.
    const same = describeDiff(image(4, 4, [1, 2, 3, 4]), image(4, 4, [1, 2, 3, 4]));
    expect(same).toBe('no differing pixel found on the second pass');
  });
});

describe('colourCount', () => {
  const image = (colours) => {
    const pixels = Buffer.alloc(colours.length * 4);
    colours.forEach(([r, g, b, a], i) => {
      pixels[i * 4] = r; pixels[i * 4 + 1] = g; pixels[i * 4 + 2] = b; pixels[i * 4 + 3] = a;
    });
    return { width: colours.length, height: 1, pixels };
  };

  it('is 1 for a blank frame, which is what it exists to catch', () => {
    // The failure it guards: a window hidden for a suite run hands back an
    // empty frame, `stableShot` finds it perfectly stable, and it becomes the
    // baseline KI7MT approves (KI7MT, 2026-10-10).
    expect(colourCount(image(Array(64).fill([0, 0, 0, 255])))).toBe(1);
    expect(colourCount(image(Array(64).fill([255, 255, 255, 255])))).toBe(1);
    // Fully transparent is blank too, and differs from black only in alpha.
    expect(colourCount(image(Array(64).fill([0, 0, 0, 0])))).toBe(1);
  });

  it('counts a real range and stops at the cap', () => {
    const many = Array.from({ length: 200 }, (_, i) => [i, 255 - i, i % 7, 255]);
    expect(colourCount(many.length ? image(many) : image([]))).toBe(64);
    expect(colourCount(image(many), 8)).toBe(8);
  });

  it('separates two colours that differ in one channel only', () => {
    expect(colourCount(image([[10, 10, 10, 255], [10, 10, 11, 255]]))).toBe(2);
    expect(colourCount(image([[10, 10, 10, 255], [10, 10, 10, 254]]))).toBe(2);
  });
});
