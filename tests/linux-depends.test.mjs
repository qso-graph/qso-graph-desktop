// SPDX-License-Identifier: GPL-3.0-only
// The Linux packages name their own dependencies. Left to electron-builder,
// the rpm requires libXScrnSaver, which Electron has not linked for years
// (it is not among the electron binary's NEEDED libraries) and which Rocky
// Linux 10 ships only in EPEL: the 0.4.1 rpm installed on Rocky 10.2 only
// because EPEL was enabled, and without it dnf refuses (KI7MT's ThinkPad,
// 2026-10-30). So the lists are set in package.json, and checked here
// against the default they replace.
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const SCREENSAVER = /^(libXScrnSaver|libxss1)$/;

export function screensaverDepends(list) {
  return list.filter(name => SCREENSAVER.test(name));
}

describe('the Linux packages name their own dependencies', async () => {
  const build = JSON.parse(await readFile('package.json', 'utf8')).build;

  it('sets the rpm and deb lists rather than taking the default', () => {
    expect(build.rpm.depends).toContain('gtk3');
    expect(build.deb.depends).toContain('libgtk-3-0');
  });

  it('requires no X screensaver library', () => {
    expect(screensaverDepends(build.rpm.depends)).toEqual([]);
    expect(screensaverDepends(build.deb.depends)).toEqual([]);
  });

  it('would notice the default it replaces', async () => {
    // electron-builder's own default lists, read from its source.
    const source = await readFile('node_modules/app-builder-lib/out/targets/FpmTarget.js', 'utf8');
    const names = [...source.matchAll(/"([A-Za-z0-9.+-]+)"/g)].map(match => match[1]);
    expect(screensaverDepends(names)).toEqual(expect.arrayContaining(['libXScrnSaver', 'libxss1']));
  });
});
