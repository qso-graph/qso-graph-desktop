// SPDX-License-Identifier: GPL-3.0-only
// Every extension that ships loads, through the core's own loader, with none
// refused. ADIF Lookup's tests passed while its manifest was refused at load
// for a field id one character short, and it simply was not there (KI7MT,
// 2026-10-23): the page code was tested, the manifest never was.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
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
