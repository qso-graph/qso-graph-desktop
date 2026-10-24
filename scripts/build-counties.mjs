// SPDX-License-Identifier: GPL-3.0-only
// Builds dist/reference/us-counties.json, the US county data that ships with
// the application (QGD-STN-0010), from the files scripts/fetch-counties.mjs
// fetched and checked. Run by `npm run build`, after tsc, because it reads
// the archives with the product's own zip reader.
//
// It refuses to write a partial list: a Census county with no LoTW name, or
// a count that is not what the sources say, fails the build rather than
// shipping a list that quietly leaves a county out.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  assignSections, cachedSource, encodeRing, nameCounties, parseSections, readDbf, readShp, simplify, tqslCounties
} from './county-data.mjs';

const OUT = resolve('dist', 'reference', 'us-counties.json');
const TOLERANCE = 0.0003;
const QUANTUM = 0.0001;

const sources = JSON.parse(await readFile('data/county-sources.json', 'utf8'));
const adifSources = JSON.parse(await readFile('data/reference-sources.json', 'utf8')).adif;
const { read } = await import('../dist/reference/zip.js');

async function source(key) {
  const bytes = await readFile(cachedSource(sources[key])).catch(() => undefined);
  if (!bytes || createHash('sha256').update(bytes).digest('hex') !== sources[key].sha256) {
    console.error(`The US county sources are not fetched (${key}). Run: node scripts/fetch-counties.mjs`);
    console.error('`make setup` and `make update` run it for you.');
    process.exit(1);
  }
  return bytes;
}

function shapefile(archive, name) {
  return { rows: readDbf(read(archive, `${name}.dbf`)), shapes: readShp(read(archive, `${name}.shp`)) };
}

const current = shapefile(await source('boundaries'), sources.boundaries.file);
const older = shapefile(await source('connecticut'), sources.connecticut.file);
const tqsl = tqslCounties((await source('names')).toString('utf8'));

// ADIF's Alaska list, from the pinned release fetch-adif.mjs keeps.
const adif = JSON.parse(await readFile(
  `vendor/adif/${adifSources.version}/${adifSources.source.definitions}`, 'utf8').catch(() => {
  console.error('ADIF\'s definitions are not fetched. Run: node scripts/fetch-adif.mjs');
  process.exit(1);
}));
const alaska = Object.entries(adif.Adif.Enumerations.Secondary_Administrative_Subdivision.Records)
  .filter(([code, row]) => code.startsWith('AK,') && !row.Deleted)
  .map(([code]) => code.slice(3));

// Connecticut from 2021 (its 8 counties), everything else from 2025.
const rows = [];
const shapes = [];
current.rows.forEach((row, i) => { if (row.STUSPS !== 'CT') { rows.push(row); shapes.push(current.shapes[i]); } });
older.rows.forEach((row, i) => { if (row.STUSPS === 'CT') { rows.push(row); shapes.push(older.shapes[i]); } });

const { matched, unmatched } = nameCounties({ rows, tqsl, alaska, renamed: sources.rules.alaskaRenamed });
if (unmatched.length) {
  console.error(`${unmatched.length} Census counties have no LoTW or ADIF name: ${unmatched.join('; ')}`);
  process.exit(1);
}

// One entry per name. Alaska's Copper River and Chugach are both ADIF's
// Valdez-Cordova, so their rings are joined.
const byName = new Map();
const shapeOf = new Map(rows.map((row, i) => [row, shapes[i]]));
for (const { row, state, name } of matched) {
  const key = `${state},${name}`;
  const entry = byName.get(key) ?? { cnty: key, state, name, codes: [], rings: [] };
  entry.codes.push(row.GEOID);
  for (const ring of shapeOf.get(row)) entry.rings.push(simplify(ring, TOLERANCE));
  byName.set(key, entry);
}

const counties = [...byName.values()].sort((a, b) => a.cnty.localeCompare(b.cnty)).map(entry => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const ring of entry.rings) {
    for (const [x, y] of ring) {
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
  }
  const q = value => Math.round(value / QUANTUM);
  return {
    cnty: entry.cnty, codes: entry.codes.sort(),
    box: [q(minX) - 1, q(minY) - 1, q(maxX) + 1, q(maxY) + 1],
    rings: entry.rings.map(ring => encodeRing(ring, QUANTUM)).filter(ring => ring.length >= 8)
  };
});

// The names a pick list offers, per state: every county with a boundary, and
// in Alaska every name ADIF lists, some of which have no boundary of their own.
const names = {};
for (const county of counties) (names[county.cnty.slice(0, 2)] ??= []).push(county.cnty.slice(3));
names.AK = [...new Set([...(names.AK ?? []), ...alaska])];
for (const state of Object.keys(names)) names[state].sort((a, b) => a.localeCompare(b));

// Each county's ARRL section (QGD-STN-0010): from ARRL's Section Boundaries
// page, matched to ADIF's ARRL_Section list. A partial answer is refused.
const adifSections = Object.values(adif.Adif.Enumerations.ARRL_Section.Records)
  .filter(row => !row.Deleted && !row['Deleted Date'])
  .map(row => ({ abbreviation: row.Abbreviation, name: row['Section Name'] }));
const stateNames = Object.fromEntries(rows.map(row => [row.STUSPS, row.STATE_NAME]));
const { byState, byCounty, problems } = assignSections({
  sections: parseSections((await source('sections')).toString('utf8')),
  adifSections, countiesOf: names, stateNames, corrections: sources.rules.sectionCorrections
});
if (problems.length) {
  console.error(`ARRL's sections do not cover the counties: ${problems.join('; ')}`);
  process.exit(1);
}

const data = {
  format: 1,
  quantum: QUANTUM,
  sources: {
    boundaries: sources.boundaries.sha256, connecticut: sources.connecticut.sha256,
    names: sources.names.sha256, sections: sources.sections.sha256, adif: adifSources.source.sha256
  },
  counties,
  names,
  sections: { byState, byCounty }
};
await mkdir(dirname(OUT), { recursive: true });
const text = JSON.stringify(data);
await writeFile(OUT, text);
const total = Object.values(names).reduce((sum, list) => sum + list.length, 0);
console.log(`US counties: ${counties.length} with boundaries, ${total} names in ${Object.keys(names).length} states, ` +
  `ARRL sections for ${Object.keys(byState).length} whole states and ${Object.keys(byCounty).length} counties, ` +
  `${(text.length / 1e6).toFixed(1)} MB: PASS`);
