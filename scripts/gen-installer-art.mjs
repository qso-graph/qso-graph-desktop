// SPDX-License-Identifier: GPL-3.0-only
// The Windows installer's artwork (KI7MT, 2026-10-28: direction A, "Night"), drawn once in
// build/installer-art.html from build/icon.png and written as the two bitmaps NSIS takes:
//   build/installerSidebar.bmp  164 x 314  the Welcome and Finish pages (the uninstaller's too)
//   build/installerHeader.bmp   150 x 57   the right of each inner page's top strip
// electron-builder finds both in build/ by those names. The bitmaps are committed, so a build
// needs no browser; run this after the icon or the artwork changes:
//   node scripts/gen-installer-art.mjs
//
// Drawn in Electron, the browser npm ci installs (scripts/installer-art-window.cjs), never
// Playwright's own Chromium, which npm ci does not fetch (tests/toolchain.test.mjs). Each piece is
// drawn at the size NSIS shows it (box-filtered down where the screen draws at 2x, as a Retina
// Mac does), then written as a 24-bit BMP, the format NSIS's pages load.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { _electron as electron } from '@playwright/test';
import { decode } from './png.mjs';

export const PIECES = [
  ['#sidebar', 'build/installerSidebar.bmp', 164, 314],
  ['#header', 'build/installerHeader.bmp', 150, 57]
];

// Each output pixel the average of the scale x scale pixels it covers. The pieces are opaque.
export function halve({ width, height, pixels }, scale = 2) {
  const w = width / scale, h = height / scale;
  if (!Number.isInteger(w) || !Number.isInteger(h)) throw new Error(`${width} x ${height} is not a multiple of ${scale}`);
  const out = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) sum += pixels[((y * scale + dy) * width + x * scale + dx) * 4 + c];
        out[(y * w + x) * 3 + c] = Math.round(sum / (scale * scale));
      }
    }
  }
  return { width: w, height: h, rgb: out };
}

// A 24-bit BMP: bottom-up rows, BGR, each row padded to four bytes.
export function bmp({ width, height, rgb }) {
  const row = Math.ceil((width * 3) / 4) * 4;
  const size = 54 + row * height;
  const file = Buffer.alloc(size);
  file.write('BM', 0, 'ascii');
  file.writeUInt32LE(size, 2);
  file.writeUInt32LE(54, 10);
  file.writeUInt32LE(40, 14);
  file.writeInt32LE(width, 18);
  file.writeInt32LE(height, 22);
  file.writeUInt16LE(1, 26);
  file.writeUInt16LE(24, 28);
  file.writeUInt32LE(row * height, 34);
  file.writeInt32LE(2835, 38);
  file.writeInt32LE(2835, 42);
  for (let y = 0; y < height; y++) {
    const at = 54 + (height - 1 - y) * row;
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 3;
      file[at + x * 3] = rgb[p + 2];
      file[at + x * 3 + 1] = rgb[p + 1];
      file[at + x * 3 + 2] = rgb[p];
    }
  }
  return file;
}

async function main() {
  // Headless on Linux, so it runs with no display; elsewhere Electron needs nothing.
  const args = process.platform === 'linux' ? ['--ozone-platform=headless'] : [];
  const application = await electron.launch({ args: [...args, resolve('scripts/installer-art-window.cjs'), resolve('build/installer-art.html')] });
  try {
    const page = await application.firstWindow();
    await page.waitForLoadState('load');
    for (const [selector, file, width, height] of PIECES) {
      const shot = decode(await page.locator(selector).screenshot());
      // The screen's own scale: 1 on most, 2 on a Retina Mac, where the box filter brings it to size.
      const piece = halve(shot, shot.width / width);
      if (piece.width !== width || piece.height !== height) throw new Error(`${selector} drew ${piece.width} x ${piece.height}, not ${width} x ${height}`);
      writeFileSync(file, bmp(piece));
      console.log(`${file}: ${width} x ${height}`);
    }
  } finally {
    await application.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
