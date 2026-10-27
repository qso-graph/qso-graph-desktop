// SPDX-License-Identifier: GPL-3.0-only
// Fetches what the US county data is built from (data/county-sources.json):
// two Census boundary files, TQSL's configuration and ARRL's section
// boundaries. Each is checked against
// its SHA-256 before it is kept, and kept under vendor/.cache/, which is not
// in the repository. Run by `make setup` and `make update`; a file already
// there and matching is not fetched again, so it goes to the network once.
//
//   node scripts/fetch-counties.mjs
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cachedSource } from './county-data.mjs';

const sources = JSON.parse(await readFile('data/county-sources.json', 'utf8'));
const cache = resolve('vendor', '.cache');
await mkdir(cache, { recursive: true });

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

for (const key of ['boundaries', 'connecticut', 'names', 'sections']) {
  const source = sources[key];
  const path = cachedSource(source);
  const have = await readFile(path).catch(() => undefined);
  if (have && sha256(have) === source.sha256) {
    console.log(`${key}: already fetched.`);
    continue;
  }
  // A busy source is waited on as it asks (#79): its Retry-After, or else
  // 15, 30 then 60 seconds, never more than two minutes at a time. The
  // Internet Archive answers 503 for minutes at a time, and two retries a few
  // seconds apart failed the build on 2026-10-26 for an outage of its own.
  let body;
  const attempts = 4;
  for (let attempt = 1; attempt <= attempts && !body; attempt++) {
    let wait = 15_000 * 2 ** (attempt - 1);
    try {
      const response = await fetch(source.url);
      if (!response.ok) {
        const asked = Number(response.headers.get('retry-after'));
        if (Number.isFinite(asked) && asked > 0) wait = asked * 1000;
        throw new Error(`HTTP ${response.status}`);
      }
      body = Buffer.from(await response.arrayBuffer());
    } catch (error) {
      if (attempt === attempts) {
        console.error(`${key}: could not be fetched (${error.message}).`);
        process.exit(1);
      }
      wait = Math.min(wait, 120_000);
      console.log(`${key}: ${error.message}; asking again in ${Math.round(wait / 1000)} s.`);
      await new Promise(done => setTimeout(done, wait));
    }
  }
  const got = sha256(body);
  if (got !== source.sha256) {
    console.error(`${key}: the file fetched is not the one pinned in data/county-sources.json.`);
    console.error(`  expected ${source.sha256}`);
    console.error(`  got      ${got}`);
    process.exit(1);
  }
  await writeFile(`${path}.part`, body);
  await rename(`${path}.part`, path);
  console.log(`${key}: fetched, ${body.length} bytes, SHA-256 checked.`);
}
console.log('US county sources: all four present and checked: PASS');
