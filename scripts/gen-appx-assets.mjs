// SPDX-License-Identifier: GPL-3.0-only
// The Microsoft Store package's logos (KI7MT, 2026-10-24), made from
// build/icon.png so there is one icon, not a second drawing of it. Without
// them electron-builder ships Electron's sample logos, which the Store can
// refuse. Run after the icon changes: node scripts/gen-appx-assets.mjs
//
// Box-filter downscaling (each output pixel the average of the input pixels
// it covers, alpha-weighted) and a plain PNG writer, so no image library is
// added for four small files.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { decode } from './png.mjs';

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const OUT = 'build/appx';
// name, width, height, and the size of the square icon drawn centred in it.
export const ASSETS = [
  ['StoreLogo.png', 50, 50, 50],
  ['Square44x44Logo.png', 44, 44, 44],
  ['Square150x150Logo.png', 150, 150, 150],
  ['Wide310x150Logo.png', 310, 150, 150]
];

export function downscale(source, size) {
  const { width, height, pixels } = source;
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    const y0 = Math.floor((y * height) / size), y1 = Math.max(y0 + 1, Math.floor(((y + 1) * height) / size));
    for (let x = 0; x < size; x++) {
      const x0 = Math.floor((x * width) / size), x1 = Math.max(x0 + 1, Math.floor(((x + 1) * width) / size));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * width + xx) * 4;
          const alpha = pixels[i + 3];
          r += pixels[i] * alpha; g += pixels[i + 1] * alpha; b += pixels[i + 2] * alpha; a += alpha; n++;
        }
      }
      const o = (y * size + x) * 4;
      if (a > 0) { out[o] = Math.round(r / a); out[o + 1] = Math.round(g / a); out[o + 2] = Math.round(b / a); }
      out[o + 3] = Math.round(a / n);
    }
  }
  return out;
}

// The square icon of `inner` pixels, centred on a transparent canvas.
export function placed(source, width, height, inner) {
  const icon = downscale(source, inner);
  const out = new Uint8Array(width * height * 4);
  const left = Math.floor((width - inner) / 2), top = Math.floor((height - inner) / 2);
  for (let y = 0; y < inner; y++) out.set(icon.subarray(y * inner * 4, (y + 1) * inner * 4), ((top + y) * width + left) * 4);
  return out;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

// An 8-bit RGBA PNG, every row with filter 0.
export function encode(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))
  ]);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const source = decode(readFileSync('build/icon.png'));
  mkdirSync(OUT, { recursive: true });
  for (const [name, width, height, inner] of ASSETS) {
    writeFileSync(`${OUT}/${name}`, encode(width, height, placed(source, width, height, inner)));
    console.log(`${OUT}/${name}: ${width}x${height}`);
  }
}
