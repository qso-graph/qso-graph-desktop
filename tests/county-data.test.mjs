// SPDX-License-Identifier: GPL-3.0-only
// What builds the US county data (QGD-STN-0010), run on the real files
// scripts/fetch-counties.mjs fetched, and on small cases.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  cachedSource, comparable, contains, encodeRing, nameCounties, readDbf, readShp, simplify, tqslCounties,
  htmlText,
} from '../scripts/county-data.mjs';
import { read } from '../dist/reference/zip.js';

const sources = JSON.parse(readFileSync('data/county-sources.json', 'utf8'));
const adifSources = JSON.parse(readFileSync('data/reference-sources.json', 'utf8')).adif;
const archive = key => readFileSync(cachedSource(sources[key]));
const rowsOf = (key) => readDbf(read(archive(key), `${sources[key].file}.dbf`));

describe('spellings of one county compare equal', () => {
  it.each([
    ['DeKalb', 'De Kalb'], ['St. Joseph', 'Saint Joseph'], ['Ste. Genevieve', 'Sainte Genevieve'],
    ["O'Brien", 'OBrien'], ['Doña Ana', 'Dona Ana'], ['Miami-Dade', 'Miami Dade']
  ])('%s and %s', (a, b) => expect(comparable(a)).toBe(comparable(b)));

  it('and different counties do not', () => {
    expect(comparable('Fairfax')).not.toBe(comparable('Fairfax City'));
  });
});

describe('simplifying a boundary', () => {
  it('keeps the ends, drops points within the tolerance, keeps a corner', () => {
    const ring = [[0, 0], [1, 0.00001], [2, 0], [2, 2], [0, 2], [0, 0]];
    expect(simplify(ring, 0.001)).toEqual([[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]);
  });

  it('never shrinks a ring below four points, so no island disappears', () => {
    const tiny = [[0, 0], [0.00001, 0], [0.00001, 0.00001], [0, 0]];
    expect(simplify(tiny, 1)).toEqual(tiny);
  });

  it('encodes a ring as differences, the first point absolute', () => {
    expect(encodeRing([[-116.2, 43.6], [-116.1, 43.6], [-116.1, 43.6]], 0.1)).toEqual([-1162, 436, 1, 0]);
  });

  it('treats a hole as outside', () => {
    const outer = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
    const hole = [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]];
    expect(contains([outer, hole], 2, 2)).toBe(true);
    expect(contains([outer, hole], 5, 5)).toBe(false);
  });
});

describe('the real sources', () => {
  const current = rowsOf('boundaries');
  const older = rowsOf('connecticut');
  const rows = [...current.filter(row => row.STUSPS !== 'CT'), ...older.filter(row => row.STUSPS === 'CT')];
  const tqsl = tqslCounties(archive('names').toString('utf8'));
  const adif = JSON.parse(readFileSync(`vendor/adif/${adifSources.version}/${adifSources.source.definitions}`, 'utf8'));
  const alaska = Object.entries(adif.Adif.Enumerations.Secondary_Administrative_Subdivision.Records)
    .filter(([code, row]) => code.startsWith('AK,') && !row.Deleted).map(([code]) => code.slice(3));

  it('reads every Census county and its shape', () => {
    const shapes = readShp(read(archive('boundaries'), `${sources.boundaries.file}.shp`));
    expect(current).toHaveLength(3235);
    expect(shapes).toHaveLength(current.length);
    expect(shapes.every(shape => shape.length > 0)).toBe(true);
  });

  it('names every Census county in the 50 states, and no two the same', () => {
    const { matched, unmatched } = nameCounties({ rows, tqsl, alaska, renamed: sources.rules.alaskaRenamed });
    expect(unmatched).toEqual([]);
    expect(matched).toHaveLength(3142);
    expect(new Set(matched.map(m => `${m.state},${m.name}`)).size).toBe(3141);
  });

  it('takes Connecticut\'s 8 counties from 2021: 2025 has the 9 planning regions', () => {
    expect(current.filter(row => row.STUSPS === 'CT')).toHaveLength(9);
    expect(older.filter(row => row.STUSPS === 'CT')).toHaveLength(8);
  });

  it('comes to CQ USA-CA\'s 3,077 under its rules, the check on what awards will derive', () => {
    // Alaska counts as its 4 judicial districts; the independent cities of
    // Virginia, Nevada and DC count for a bordering county, not their own;
    // Baltimore City and St. Louis City count. Territories are other entities.
    const counted = rows.filter(row => !['PR', 'AS', 'GU', 'MP', 'VI', 'AK', 'DC'].includes(row.STUSPS))
      .filter(row => !(row.STUSPS === 'VA' && row.LSAD === '25'))
      .filter(row => !(row.STUSPS === 'NV' && row.NAME === 'Carson City'));
    expect(counted.length + 4).toBe(3077);
  });
});

// The page's text, read by scanning rather than regex replacement (code
// scanning: js/bad-tag-filter, js/double-escaping,
// js/incomplete-multi-character-sanitization).
describe('htmlText', () => {
  it('skips script and style to their closing tag, whatever its spacing or case', () => {
    expect(htmlText('a<script>x</script >b<STYLE>y</Style>c')).toBe('a\nb\nc');
    expect(htmlText('a<script>never closed')).toBe('a\n');
  });

  it('decodes entities once: an escaped entity stays text', () => {
    expect(htmlText('Q &amp; A &amp;nbsp; x&nbsp;y it&#39;s it&rsquo;s')).toBe("Q & A &nbsp; x y it's it's");
  });

  it('drops an unclosed tag at the end rather than reading it as text', () => {
    expect(htmlText('text<p')).toBe('text');
  });
});
