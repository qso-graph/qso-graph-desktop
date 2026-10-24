// SPDX-License-Identifier: GPL-3.0-only
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { archiveRoot, definitionsPath, releaseDirectory, testQsosPath } from '../scripts/adif-release.mjs';

const sources = JSON.parse(await readFile('data/reference-sources.json', 'utf8'));
const release = sources.adif;

describe('QGD-REF-0003 the pinned ADIF release', () => {
  it('is pinned exactly, from one place, with a hash to check it by', () => {
    expect(release.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(release.source.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(release.source.url.startsWith('https://')).toBe(true);
    expect(release.source.url).toContain(archiveRoot(release));
  });

  it('lives in vendor, out of the repository', async () => {
    expect(releaseDirectory(release, '/somewhere')).toBe(join('/somewhere', 'vendor', 'adif', release.version));
    expect(definitionsPath(release, '/somewhere').replaceAll('\\', '/')).toContain('exports/json/all.json');
    expect(testQsosPath(release, '/somewhere').replaceAll('\\', '/')).toContain('tests/');
    expect(await readFile('.gitignore', 'utf8')).toContain('vendor/');
  });

  it('names where the definitions and the test cases are inside the archive', () => {
    expect(release.source.definitions.startsWith(`${archiveRoot(release)}/`)).toBe(true);
    expect(release.source.testQsos.startsWith(`${archiveRoot(release)}/`)).toBe(true);
  });
});

describe('QGD-REF-0002 who owns a list, and where this copy came from', () => {
  it('records both, for every list, as two separate facts', () => {
    expect(sources.lists.length).toBeGreaterThan(5);
    for (const list of sources.lists) {
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
    const by = Object.fromEntries(sources.lists.map(list => [list.id, list.authority]));
    expect(by['dxcc-entities']).toContain('ARRL');
    expect(by['arrl-sections']).toContain('ARRL');
    expect(by['cq-zones']).toContain('CQ Magazine');
    expect(by['itu-zones']).toContain('International Telecommunication Union');
    expect(by['darc-dok']).toContain('DARC');
  });

  it('records the three ADIF does not supply as lists at all', () => {
    // QGD-REF-0006 and QGD-REF-0007 both rest on this being true, and on it
    // being noticed if it ever stops being true.
    const unsupplied = sources.lists.filter(list => list.copy.startsWith('NOT'));
    expect(unsupplied.map(list => list.id).sort()).toEqual(['cq-zones', 'darc-dok', 'itu-zones']);
    for (const list of unsupplied) {
      expect(list.copy.length, `${list.id} should say why, not just that`).toBeGreaterThan(60);
    }
  });

  it('does not claim ADIF wrote what ADIF did write', () => {
    // The opposite failure: attributing ADIF's own work to somebody else.
    const fields = sources.lists.find(list => list.id === 'fields');
    expect(fields.authority).toContain('ADIF');
    expect(fields.copy).toContain('the same');
  });
});

describe('QGD-REF-0009 and QGD-REF-0012 POTA', () => {
  const pota = sources.lists.filter(list => list.id.startsWith('pota-'));

  it('is recorded as POTA\u2019s, not as ADIF\u2019s and not as ours', () => {
    expect(pota.map(list => list.id).sort()).toEqual(['pota-activations', 'pota-locations', 'pota-parks', 'pota-programs']);
    for (const list of pota) {
      expect(list.authority, `${list.id}: POTA issues its own references`).toContain('Parks on the Air');
      expect(list.copy, `${list.id}: fetched, not shipped`).toContain('run time');
      expect(list.copy, `${list.id}: never redistributed`).toContain('never redistributed');
    }
  });

  it('says the park list is not pinned, and why', () => {
    // QGD-REF-0010. Pinning it by checksum would be the ADIF treatment applied
    // to something that changes every day, and would break daily.
    const parks = pota.find(list => list.id === 'pota-parks');
    expect(parks.copy).toContain('not pinned');
    expect(parks.copy).toContain('daily');
    expect(parks.copy).not.toContain('sha256');
  });

  it('does not claim POTA\u2019s entity numbering is ADIF\u2019s', () => {
    // 13 of 311 entity numbers in the park list are not ADIF DXCC codes: the
    // same places under different numbers. A register that said otherwise
    // would be the reason a loader later refused 113 parks.
    const locations = pota.find(list => list.id === 'pota-locations');
    expect(locations.copy).toContain("POTA's own");
    expect(locations.copy).toContain('QGD-REF-0012');
  });

  it('names where POTA’s lists are and holds none of their contents', async () => {
    // QGD-REF-0009: fetched at run time, never redistributed. Which means the
    // register must name the URLs — the first version of this test forbade
    // the park list's URL, confusing POTA's data with the address of it, and
    // the requirement says the opposite: what ships is where to get it.
    const text = await readFile('data/reference-sources.json', 'utf8');
    const register = JSON.parse(text);
    const urls = Object.values(register.pota.sources).map(source => source.url);
    expect(urls).toEqual([
      'https://pota.app/all_parks_ext.csv',
      'https://api.pota.app/programs',
      'https://api.pota.app/locations'
    ]);
    for (const url of urls) expect(url.startsWith('https://'), `${url} must be HTTPS`).toBe(true);

    // And no row of POTA's: no park reference, and no park or program name.
    // The requirement citations are taken out first — QGD-REF-0002 has the
    // shape of a park reference and is not one.
    const withoutCitations = text.replaceAll(/QGD-[A-Z]{3}-\d{4}(\.\d+)?/g, '');
    const references = withoutCitations.match(/\b[A-Z0-9]{1,4}-\d{4,5}\b/g) ?? [];
    expect(references, "a park reference would be POTA's data, committed").toEqual([]);
    for (const name of ['Acadia National Park', 'Afghanistan', 'Test Park']) {
      expect(text.includes(name), `"${name}" is POTA's data, not a source`).toBe(false);
    }
  });
});
