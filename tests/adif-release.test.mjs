// SPDX-License-Identifier: GPL-3.0-only
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { archiveRoot, definitionsPath, releaseDirectory, testQsosPath } from '../scripts/adif-release.mjs';

const release = JSON.parse(await readFile('data/adif-release.json', 'utf8'));

describe('QGD-REF-0003 the pinned ADIF release', () => {
  it('is pinned exactly, from one place, with a hash to check it by', () => {
    expect(release.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(release.source.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(release.source.url.startsWith('https://')).toBe(true);
    expect(release.source.url).toContain(archiveRoot(release));
  });

  it('lives in vendor, beside the database build and out of the repository', async () => {
    expect(releaseDirectory(release, '/somewhere')).toBe(`/somewhere/vendor/adif/${release.version}`);
    expect(definitionsPath(release, '/somewhere')).toContain('exports/json/all.json');
    expect(testQsosPath(release, '/somewhere')).toContain('tests/');
    expect(await readFile('.gitignore', 'utf8')).toContain('vendor/');
  });

  it('names where the definitions and the test cases are inside the archive', () => {
    expect(release.source.definitions.startsWith(`${archiveRoot(release)}/`)).toBe(true);
    expect(release.source.testQsos.startsWith(`${archiveRoot(release)}/`)).toBe(true);
  });
});

describe('QGD-REF-0002 who owns a list, and where this copy came from', () => {
  it('records both, for every list, as two separate facts', () => {
    expect(release.lists.length).toBeGreaterThan(5);
    for (const list of release.lists) {
      expect(list.id, 'every list has an id').toBeTruthy();
      expect(list.what, `${list.id}: what it is`).toBeTruthy();
      expect(list.authority, `${list.id}: who issues it`).toBeTruthy();
      expect(list.copy, `${list.id}: where this copy came from`).toBeTruthy();
      expect(list.authority, `${list.id}: owner and source are different questions`).not.toBe(list.copy);
    }
  });

  it('names the owner rather than ADIF for the lists ADIF only reproduces', () => {
    // The owner of a list is its authority. ADIF issues none of these: the
    // award sponsor does, or the national society, or the ITU.
    const by = Object.fromEntries(release.lists.map(list => [list.id, list.authority]));
    expect(by['dxcc-entities']).toContain('ARRL');
    expect(by['arrl-sections']).toContain('ARRL');
    expect(by['cq-zones']).toContain('CQ Magazine');
    expect(by['itu-zones']).toContain('International Telecommunication Union');
    expect(by['darc-dok']).toContain('DARC');
  });

  it('records the three ADIF does not supply as lists at all', () => {
    // QGD-REF-0006 and QGD-REF-0007 both rest on this being true, and on it
    // being noticed if it ever stops being true.
    const unsupplied = release.lists.filter(list => list.copy.startsWith('NOT'));
    expect(unsupplied.map(list => list.id).sort()).toEqual(['cq-zones', 'darc-dok', 'itu-zones']);
    for (const list of unsupplied) {
      expect(list.copy.length, `${list.id} should say why, not just that`).toBeGreaterThan(60);
    }
  });

  it('does not claim ADIF wrote what ADIF did write', () => {
    // The opposite failure: attributing ADIF's own work to somebody else.
    const fields = release.lists.find(list => list.id === 'fields');
    expect(fields.authority).toContain('ADIF');
    expect(fields.copy).toContain('the same');
  });
});
