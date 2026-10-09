// SPDX-License-Identifier: GPL-3.0-only
// Fetches POTA's three lists and checks their shape. P5-pota-sources.
//
// QGD-REF-0009: fetched from POTA at run time and never redistributed. Run by
// `make setup`, which is also where the PostgreSQL build and ADIF's archive
// come from — so `make verify` needs no network, and the one thing that does
// go to POTA's servers does it once rather than on every run of the gate.
//
// What it proves is the live shape: the park CSV's header and columns, and the
// fields of a program and a location, read with the product's own readers
// rather than with a second copy of them here. A column added, removed or
// renamed fails this, which is the point — the loader would otherwise read the
// wrong column and store it as if it were right.
//
// What it writes goes under vendor/, which is not in the repository, so
// nothing of POTA's is committed by running it.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { downloadText } from '../dist/engine/reference/fetch.js';
import { readLocations, readParks, readPrograms } from '../dist/engine/reference/pota.js';

const register = JSON.parse(await readFile('data/reference-sources.json', 'utf8'));
const pota = register.pota;
export const POTA_CACHE = resolve('vendor', 'pota');

const readers = {
  parks: (body, source) => {
    const list = readParks(body, source.columns);
    return { rows: list.parks.length, note:
      `${list.counts.active} active, ${list.counts.retired} retired, ` +
      `${list.counts.multipleLocations} in more than one location, ` +
      `${list.counts.noEntity} with no entity, ` +
      `${list.counts.noCoordinates} with no coordinates, ` +
      `${list.counts.impossibleCoordinates} with coordinates that cannot exist` };
  },
  programs: body => ({ rows: readPrograms(body).length, note: 'each with a prefix and a programId' }),
  locations: body => ({ rows: readLocations(body).length, note: "each with POTA's own entity number" })
};

await mkdir(POTA_CACHE, { recursive: true });
const failures = [];
const notes = [];

for (const [list, source] of Object.entries(pota.sources)) {
  try {
    const answer = await downloadText(source.url);
    if (answer.status !== 'fresh') throw new Error(`answered ${answer.status} to an unconditional request`);
    // Read with the product's own reader, so a shape it would refuse at run
    // time is refused here instead of at a user's first start.
    const { rows, note } = readers[list](answer.body, source);
    const path = join(POTA_CACHE, `${list}.${source.format}`);
    await writeFile(`${path}.part`, answer.body);
    await rename(`${path}.part`, path);
    await writeFile(join(POTA_CACHE, `${list}.headers.json`), JSON.stringify({
      url: source.url, etag: answer.etag, lastModified: answer.lastModified,
      fetchedAt: new Date().toISOString(), rows
    }, null, 2) + '\n');
    notes.push(`${list}: ${rows} rows — ${note}` +
      (answer.etag ? ` [etag]` : '') + (answer.lastModified ? ' [last-modified]' : ''));
  } catch (error) {
    failures.push(`${list} (${source.url}): ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (failures.length) {
  console.error("POTA's lists could not be fetched or are not the shape the loader reads:");
  for (const failure of failures) console.error(`  ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`POTA: three lists fetched into ${POTA_CACHE} and read by the product's own readers: PASS`);
  for (const note of notes) console.log(`  ${note}`);
}
