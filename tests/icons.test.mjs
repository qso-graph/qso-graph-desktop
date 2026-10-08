// SPDX-License-Identifier: GPL-3.0-only
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ICONS, extract, fontAwesomeVersion, render, renderAttribution } from '../scripts/icons.mjs';

const root = resolve('.');

describe('the vendored Font Awesome icons', () => {
  it('match the installed package exactly', async () => {
    // The copy is the thing that can drift. Both generated files are compared
    // against what the installed package says right now, so an upgrade that
    // changes a path, or a hand edit, fails here.
    expect(await readFile('src/renderer/ui/icons.ts', 'utf8')).toBe(render());
    expect(await readFile('src/attribution.ts', 'utf8')).toBe(renderAttribution());
  });

  it('carry one path each, from the package rather than from memory', () => {
    for (const icon of ICONS) {
      const { viewBox, path } = extract(icon);
      expect(viewBox, `${icon.name} viewBox`).toMatch(/^0 0 \d+ \d+$/);
      expect(path.length, `${icon.name} path`).toBeGreaterThan(50);
    }
  });

  it('names an icon for every rail item', async () => {
    const store = await readFile('src/renderer/shell-store.ts', 'utf8');
    for (const icon of ICONS) {
      expect(store, `${icon.key} must be used by a page`).toContain(`icon: '${icon.key}'`);
    }
  });
});

describe('CC BY 4.0 attribution', () => {
  it('credits Font Awesome in NOTICE, at the version that ships', async () => {
    const notice = await readFile('NOTICE', 'utf8');
    expect(notice).toContain('Font Awesome Free');
    expect(notice).toContain(fontAwesomeVersion());
    expect(notice).toContain('CC BY 4.0');
    expect(notice).toContain('https://creativecommons.org/licenses/by/4.0/');
    expect(notice).toContain('Fonticons, Inc.');
  });

  it('credits Font Awesome in the About panel the user can open', async () => {
    // NOTICE is the record; this is the one somebody can actually reach, which
    // is what the licence is asking for.
    const main = await readFile('src/main.ts', 'utf8');
    expect(main).toContain('setAboutPanelOptions');
    expect(main).toContain('FONT_AWESOME_CREDIT');
    const attribution = await readFile('src/attribution.ts', 'utf8');
    expect(attribution).toContain('Fonticons, Inc.');
    expect(attribution).toContain('CC BY 4.0');
    expect(attribution).toContain(fontAwesomeVersion());
  });

  it('pins the package it credits', async () => {
    const manifest = JSON.parse(await readFile('package.json', 'utf8'));
    const pinned = manifest.devDependencies['@fortawesome/fontawesome-free'];
    expect(pinned, 'Font Awesome must be pinned exactly').toMatch(/^\d+\.\d+\.\d+$/);
    expect(pinned).toBe(fontAwesomeVersion());
    // Nothing of it is loaded at runtime, so it must not be a dependency.
    expect(manifest.dependencies?.['@fortawesome/fontawesome-free']).toBeUndefined();
  });

  it('loads no font, stylesheet or sprite from the package at runtime', async () => {
    // QGD-SEC-0008: the renderer's policy allows no font and no image. The
    // icons are inline markup; a webfont or a sprite would mean widening it.
    const html = await readFile('src/renderer/index.html', 'utf8');
    expect(html).toContain("font-src 'none'");
    expect(html).toContain("img-src 'none'");
    // An import, not a mention: the generated files name the package in their
    // header, which is the provenance and exactly what should be written down.
    for (const file of await sources()) {
      const text = await readFile(file, 'utf8');
      const loads = [...text.matchAll(/(?:from|import|require)\s*\(?\s*['"](@fortawesome\/[^'"]*)['"]/g)]
        .map(match => match[1]);
      expect(loads, `${relative(root, file)} must not load the package at runtime`).toEqual([]);
    }
  });
});

describe('the main process does not import from the renderer tree', () => {
  it('because vite empties dist/renderer after tsc has written to it', async () => {
    // Caught exactly this: main.ts imported src/renderer/ui/icons.ts, which
    // compiled, type-checked, and then was deleted by `vite build` before the
    // application ever ran.
    for (const file of await sources()) {
      if (relative(root, file).startsWith('src/renderer')) continue;
      const text = await readFile(file, 'utf8');
      const reaching = [...text.matchAll(/from '([^']*renderer\/[^']*)'/g)].map(match => match[1]);
      expect(reaching, `${relative(root, file)} imports from the renderer`).toEqual([]);
    }
  });
});

async function sources(directory = resolve('src'), found = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await sources(path, found);
    else if (/\.(ts|cts|svelte)$/.test(entry.name)) found.push(path);
  }
  return found;
}
