// SPDX-License-Identifier: GPL-3.0-only
// QGD-SEC-0019 and QGD-SEC-0012: the pin, and that it is a pin.
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const manifest = JSON.parse(await readFile('package.json', 'utf8'));
const dev = manifest.devDependencies ?? {};

describe('QGD-SEC-0019 the TypeScript pin', () => {
  it('is an exact version, not a range', () => {
    // A range would let 7 arrive on its own and silently break three tools.
    expect(dev.typescript).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('is 6.x, the line typescript-eslint, svelte-check and Electronegativity accept', () => {
    expect(dev.typescript.startsWith('6.')).toBe(true);
  });

  it('keeps the tools the pin exists for', () => {
    for (const tool of ['typescript-eslint', 'svelte-check', '@doyensec/electronegativity']) {
      expect(dev[tool], `${tool} is why TypeScript is pinned`).toBeTruthy();
    }
  });
});

describe('QGD-SEC-0012 the paths that must be pinned exactly', () => {
  it.each([
    ['pino', 'logging, which handles credential-bearing fields'],
    ['@electron/asar', 'reading the packaged archive the audit checks'],
    ['electron', 'the runtime'],
    ['electron-builder', 'packaging'],
    ['svelte', 'the renderer'],
    ['vite', 'the renderer build']
  ])('%s is pinned exactly (%s)', name => {
    const version = dev[name] ?? manifest.dependencies?.[name];
    expect(version, `${name} is not declared`).toBeTruthy();
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('verification uses only the browser npm ci installs', () => {
  it('launches Electron, never Playwright’s own Chromium', async () => {
    // `npm ci` installs Playwright but not its browser binaries, and nothing
    // in the documented setup fetches them — a suite calling chromium.launch()
    // fails on a clean machine with "Executable doesn't exist". Electron is
    // installed, so Electron is what the suites drive.
    //
    // connectOverCDP is fine and is not this: it attaches to a browser that is
    // already running, which in this project is always Electron.
    const { readdir, readFile } = await import('node:fs/promises');
    const offenders = [];
    for (const file of await readdir('scripts')) {
      if (!/\.(mjs|cjs)$/.test(file)) continue;
      const text = await readFile(`scripts/${file}`, 'utf8');
      if (/\bchromium\s*\.\s*launch\s*\(/.test(text)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
