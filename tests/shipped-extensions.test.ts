// SPDX-License-Identifier: GPL-3.0-or-later
// Every extension that ships loads, through the core's own loader, with none
// refused. ADIF Lookup's tests passed while its manifest was refused at load
// for a field id one character short, and it simply was not there:
// the page code was tested, the manifest never was.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadExtensions } from '../packages/main/extension-runtime.js';

describe('the extensions that ship', () => {
  it('all load, and none is refused', () => {
    const register = JSON.parse(readFileSync('data/extension-grants.json', 'utf8'));
    const ids = readdirSync('extensions').filter(id => statSync(join('extensions', id)).isDirectory());
    expect(ids.length, 'there are extensions to check, or this is vacuous').toBeGreaterThan(0);
    const found = loadExtensions(ids.map(id => ({
      source: `extensions/${id}/manifest.json`, value: JSON.parse(readFileSync(join('extensions', id, 'manifest.json'), 'utf8')), shipped: true
    })), register, {});
    expect(found.refused).toEqual([]);
    expect(found.loaded.map(extension => extension.manifest.id).sort()).toEqual([...ids].sort());
  });
});

// This runs after build in make check: source imports alone cannot prove a
// flattened extension's runtime API imports still resolve in the package.
it('activates the compiled LoTW extension with only the public API context', async () => {
  const module = await import(pathToFileURL(resolve('dist', 'extensions', 'lotw', 'main.js')).href);
  const pages: string[] = []; const actions: string[] = [];
  module.activate({ subscriptions: [], pages: {
    register: (id: string) => { pages.push(id); return { dispose: () => {} }; },
    onAction: (id: string) => { actions.push(id); return { dispose: () => {} }; }
  } });
  expect(pages).toEqual(['certificates', 'roots']);
  expect(actions).toEqual(['certificates']);
});
