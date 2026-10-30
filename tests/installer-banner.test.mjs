// SPDX-License-Identifier: GPL-3.0-only
// The banner Windows shows while an update installs (#116) is the NSIS Banner
// plugin's own window, a fixed size: a longer line is cut off, not wrapped
// (#135: "It opens again by itself when it's done." lost "done."). Each line is
// held to the length of "Updating QSO Graph Desktop...", which shows whole.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const FITS = 'Updating QSO Graph Desktop...'.length;

export function bannerLines(nsis) {
  return [...nsis.matchAll(/^\s*Banner::show\b(.*)$/gm)].flatMap(match => [...match[1].matchAll(/"([^"]*)"/g)].map(text => text[1]));
}

export function tooLong(lines) {
  return lines.filter(line => line.length > FITS);
}

describe('the update banner on Windows (#135)', () => {
  const lines = bannerLines(readFileSync('build/installer.nsh', 'utf8'));

  it('has its two lines', () => {
    expect(lines).toEqual(['Updating QSO Graph Desktop...', "It reopens when it's done."]);
  });

  it('keeps every line short enough to show whole', () => {
    expect(tooLong(lines)).toEqual([]);
  });

  it('would catch the line that was cut off', () => {
    expect(tooLong(bannerLines(`Banner::show /set 76 "Updating QSO Graph Desktop..." "It opens again by itself when it's done."`)))
      .toEqual(["It opens again by itself when it's done."]);
  });
});
