// SPDX-License-Identifier: GPL-3.0-only
// Fetches what the US county data is built from (data/county-sources.json):
// two Census boundary files and TQSL's configuration. Each is checked against
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

for (const key of ['boundaries', 'connecticut', 'names']) {
  const source = sources[key];
  const path = cachedSource(source);
  const have = await readFile(path).catch(() => undefined);
  if (have && sha256(have) === source.sha256) {
    console.log(`${key}: already fetched.`);
    continue;
  }
  let body;
  for (let attempt = 1; attempt <= 3 && !body; attempt++) {
    try {
      const response = await fetch(source.url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      body = Buffer.from(await response.arrayBuffer());
    } catch (error) {
      if (attempt === 3) {
        console.error(`${key}: could not be fetched (${error.message}).`);
        process.exit(1);
      }
      await new Promise(done => setTimeout(done, 2000 * attempt));
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
console.log('US county sources: all three present and checked: PASS');
