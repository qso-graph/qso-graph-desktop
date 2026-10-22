// SPDX-License-Identifier: GPL-3.0-only
// Fetches what the world map is built from (data/map-sources.json): Natural
// Earth's 1:110m land. Checked against its SHA-256 before it is kept, and kept
// under vendor/.cache/, which is not in the repository. Run by `make setup`
// and `make update`; a file already there and matching is not fetched again.
//
//   node scripts/fetch-map.mjs
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const { land } = JSON.parse(await readFile('data/map-sources.json', 'utf8'));
export const cached = resolve('vendor', '.cache', `map-${land.sha256.slice(0, 16)}`);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

await mkdir(resolve('vendor', '.cache'), { recursive: true });
const have = await readFile(cached).catch(() => undefined);
if (have && sha256(have) === land.sha256) {
  console.log('World map: already fetched.');
  process.exit(0);
}
let body;
for (let attempt = 1; attempt <= 3 && !body; attempt++) {
  try {
    const response = await fetch(land.url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    body = Buffer.from(await response.arrayBuffer());
  } catch (error) {
    if (attempt === 3) {
      console.error(`World map: could not be fetched (${error.message}).`);
      process.exit(1);
    }
    await new Promise(done => setTimeout(done, 2000 * attempt));
  }
}
const got = sha256(body);
if (got !== land.sha256) {
  console.error('World map: the file fetched is not the one pinned in data/map-sources.json.');
  console.error(`  expected ${land.sha256}`);
  console.error(`  got      ${got}`);
  process.exit(1);
}
await writeFile(`${cached}.part`, body);
await rename(`${cached}.part`, cached);
console.log(`World map: fetched, ${body.length} bytes, SHA-256 checked: PASS`);
