// SPDX-License-Identifier: GPL-3.0-only
// QGD-FRM-0015, QGD-REP-0005: every source of data the application downloads
// or ships is credited in NOTICE, which Help → Attributions opens. Held to the
// registers that name the sources, so a new source cannot be added without its
// credit, and a credit cannot outlive its source. Each credit is marked with
// its register key in a comment: `<!-- credit: reference/pota -->`.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const reference = JSON.parse(readFileSync('data/reference-sources.json', 'utf8'));
const counties = JSON.parse(readFileSync('data/county-sources.json', 'utf8'));
const sources = JSON.parse(readFileSync('data/extension-sources.json', 'utf8'));
const map = JSON.parse(readFileSync('data/map-sources.json', 'utf8'));
const notice = readFileSync('NOTICE', 'utf8');
const keys = new Set([...notice.matchAll(/<!-- credit: ([a-z/]+) -->\n- \*\*[^*]+\*\*: \S/g)].map(match => match[1]));

describe('NOTICE credits every data source', () => {
  it('credits each reference resource the operator can download', () => {
    for (const resource of reference.resources) expect(keys, resource.id).toContain(`reference/${resource.id}`);
  });

  it('credits each file the US county data is built from', () => {
    for (const key of ['boundaries', 'names', 'sections']) {
      expect(counties[key], key).toBeDefined();
      expect(keys, key).toContain(`county/${key}`);
    }
  });

  it('credits each source a card may fetch', () => {
    // Who each host belongs to, as the credit names them.
    const owner = { 'services.swpc.noaa.gov': 'noaa' };
    const hosts = new Set(Object.values(sources.sources).map(url => new URL(url).hostname));
    expect(hosts.size, 'the register names sources, or this check is vacuous').toBeGreaterThan(0);
    for (const host of hosts) {
      expect(owner[host], `${host} has an owner in this test`).toBeDefined();
      expect(keys, host).toContain(owner[host]);
    }
  });

  it('credits the world map\'s coastlines', () => {
    expect(map.land).toBeDefined();
    expect(keys).toContain('map/land');
  });

  it('credits the icons, which CC BY 4.0 requires', () => {
    expect(keys).toContain('icons');
  });

  it('credits nothing that is not a source', () => {
    const known = new Set([...reference.resources.map(resource => `reference/${resource.id}`),
      'county/boundaries', 'county/names', 'county/sections', 'map/land', 'noaa', 'icons']);
    expect([...keys].filter(key => !known.has(key))).toEqual([]);
  });
});
