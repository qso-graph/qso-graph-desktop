// SPDX-License-Identifier: GPL-3.0-only
// Enough PNG to compare two screenshots.
//
// Comparing the encoded bytes would be simpler and wrong: two encoders, or one
// encoder in two moods, produce different bytes for the same picture. What
// P3-screenshots has to notice is a changed pixel, so the pixels are what get
// compared.
//
// Handles what a Chromium screenshot is: 8 bits per channel, colour type 6
// (RGBA) or 2 (RGB). Anything else throws rather than being read wrongly — a
// decoder that quietly returned the wrong pixels would make every baseline
// comparison pass.
import { inflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function decode(file) {
  if (!file.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG');
  let offset = 8;
  let width = 0, height = 0, depth = 0, colour = 0, interlace = 0;
  const parts = [];
  while (offset + 8 <= file.length) {
    const length = file.readUInt32BE(offset);
    const type = file.toString('latin1', offset + 4, offset + 8);
    const data = file.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8];
      colour = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      parts.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }
  if (depth !== 8) throw new Error(`unsupported bit depth ${depth}`);
  if (colour !== 2 && colour !== 6) throw new Error(`unsupported colour type ${colour}`);
  if (interlace !== 0) throw new Error('interlaced PNG is not supported');
  if (!parts.length) throw new Error('no image data');

  const channels = colour === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(parts));
  const stride = width * channels;
  if (raw.length < (stride + 1) * height) throw new Error('image data is shorter than the header claims');

  const pixels = Buffer.alloc(width * height * 4);
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? line[x - channels] : 0;
      const b = previous[x];
      const c = x >= channels ? previous[x - channels] : 0;
      let value = line[x];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        value += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      } else if (filter !== 0) {
        throw new Error(`unsupported row filter ${filter}`);
      }
      line[x] = value & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const source = x * channels, target = (y * width + x) * 4;
      pixels[target] = line[source];
      pixels[target + 1] = line[source + 1];
      pixels[target + 2] = line[source + 2];
      pixels[target + 3] = channels === 4 ? line[source + 3] : 255;
    }
    previous = line;
  }
  return { width, height, pixels };
}

// `tolerance` is per channel. Zero is the default, and is right for one
// session drawing the same page twice (stableShot's settling check).
//
// Against a baseline the screenshots allow RENDER_TOLERANCE (KI7MT,
// 2026-10-22). The same Mac drew drop shadows one shade apart over ssh and in a
// logged-in session, and macOS updates, displays and machines move them too:
// variables without end, none of them the product. Two shades absorbs that and
// nothing a person would call a change: moved or edited text, a new colour or
// a shifted control differs by far more, which tests/png.test.mjs holds.
export const RENDER_TOLERANCE = 2;

export function compare(a, b, tolerance = 0) {
  if (a.width !== b.width || a.height !== b.height) {
    return { same: false, reason: `size changed: ${b.width}x${b.height} was ${a.width}x${a.height}`, differing: null };
  }
  let differing = 0;
  let first;
  for (let i = 0; i < a.pixels.length; i += 4) {
    let changed = false;
    for (let channel = 0; channel < 4; channel++) {
      if (Math.abs(a.pixels[i + channel] - b.pixels[i + channel]) > tolerance) { changed = true; break; }
    }
    if (!changed) continue;
    differing++;
    if (!first) {
      const pixel = i / 4;
      first = { x: pixel % a.width, y: Math.floor(pixel / a.width) };
    }
  }
  const total = a.width * a.height;
  return {
    same: differing === 0,
    differing,
    total,
    first,
    reason: differing ? `${differing} of ${total} pixels differ, first at ${first.x},${first.y}` : undefined
  };
}

// Where the difference is and what it looks like, for a failure to quote.
//
// Measurements only. An earlier version read a cause off the largest channel
// difference — "off by 2 or less is antialiasing, more means something moved"
// — and the evidence from this very suite says that does not hold: the rail
// differences that started this were off by 20 with nothing moved, and a
// background changing from 100/100/100 to 102/102/102 is a real colour change
// that the rule would have called antialiasing. A diagnostic that guesses
// wrong is worse than one that only reports, because it sends the reader past
// the answer. Found in review.
//
// So: the region, how densely it differs inside that region, how far off the
// channels are, and some actual colours. A thin outline and a solid block read
// differently in those numbers without anyone being told what they mean.
export function describeDiff(a, b) {
  const at = (img, x, y) => {
    const i = (y * img.width + x) * 4;
    return [img.pixels[i], img.pixels[i + 1], img.pixels[i + 2], img.pixels[i + 3]];
  };
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1, worst = 0, count = 0;
  const samples = [];
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const was = at(a, x, y), now = at(b, x, y);
      let delta = 0;
      for (let c = 0; c < 4; c++) delta = Math.max(delta, Math.abs(was[c] - now[c]));
      if (delta === 0) continue;
      count++;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      worst = Math.max(worst, delta);
      if (samples.length < 4) samples.push(`(${x},${y}) was ${was.join('/')} now ${now.join('/')}`);
    }
  }
  if (x1 < 0) return 'no differing pixel found on the second pass';
  const width = x1 - x0 + 1, height = y1 - y0 + 1;
  const density = Math.round((count / (width * height)) * 100);
  return [
    `region x ${x0}..${x1}, y ${y0}..${y1} (${width}x${height} of ${a.width}x${a.height}); `
      + `${count} differing pixel(s), ${density}% of that region; worst channel off by ${worst}`,
    ...samples.map(line => `      ${line}`)
  ].join('\n');
}

// How many distinct colours an image holds, capped so a large image costs no
// more than a small one to judge.
//
// This exists because of how the windows were hidden (KI7MT, 2026-10-10).
// A window that never appears can still hand back an empty frame on macOS,
// and `stableShot` cannot tell: a blank capture is perfectly stable, so it
// would compare equal to itself and be written as the baseline. All eight
// baselines change in this round anyway (D9), so a comparison failure proves
// nothing either way — the blankness has to be asserted directly.
export function colourCount({ pixels }, cap = 64) {
  const seen = new Set();
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    seen.add((pixels[i] << 24) | (pixels[i + 1] << 16) | (pixels[i + 2] << 8) | pixels[i + 3]);
    if (seen.size >= cap) return seen.size;
  }
  return seen.size;
}
