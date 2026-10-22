// SPDX-License-Identifier: GPL-3.0-only
// Builds packages/ui/generated/world-land.ts, the world map's coastlines as
// one SVG outline, from the file scripts/fetch-map.mjs fetched and checked.
// Run by `npm run build` before anything compiles the window: the window loads
// three files of its own and nothing else (QGD-PRC-0006), so the map is in its
// bundle rather than beside it.
//
// The map is flat, longitude and latitude straight onto x and y: 360 by 180,
// x = longitude + 180, y = 90 − latitude, to a tenth of a degree.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const OUT = resolve('packages', 'ui', 'generated', 'world-land.ts');
const { land } = JSON.parse(await readFile('data/map-sources.json', 'utf8'));
const bytes = await readFile(resolve('vendor', '.cache', `map-${land.sha256.slice(0, 16)}`)).catch(() => undefined);
if (!bytes || createHash('sha256').update(bytes).digest('hex') !== land.sha256) {
  console.error('The world map is not fetched. Run: node scripts/fetch-map.mjs');
  console.error('`make setup` and `make update` run it for you.');
  process.exit(1);
}

const tenth = value => Number(value.toFixed(1));
const rings = [];
for (const { geometry } of JSON.parse(bytes.toString('utf8')).features) {
  const polygons = geometry.type === 'MultiPolygon' ? geometry.coordinates : [geometry.coordinates];
  for (const polygon of polygons) for (const ring of polygon) rings.push(ring);
}
let path = '';
let points = 0;
for (const ring of rings) {
  let last = '';
  const parts = [];
  for (const [longitude, latitude] of ring) {
    const point = `${tenth(longitude + 180)} ${tenth(90 - latitude)}`;
    if (point === last) continue;
    parts.push(point);
    last = point;
  }
  if (parts.length < 3) continue;
  points += parts.length;
  path += `M${parts.join('L')}Z`;
}
if (rings.length < 100 || points < 4000) {
  console.error(`The world map has ${rings.length} outlines and ${points} points, fewer than Natural Earth's 1:110m land holds.`);
  process.exit(1);
}
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, `// SPDX-License-Identifier: GPL-3.0-only
// Written by scripts/build-map.mjs from Natural Earth ${land.edition} (public
// domain; data/map-sources.json). Not in the repository: built, never edited.
export const WORLD_LAND = ${JSON.stringify(path)};
`);
console.log(`World map: ${rings.length} outlines, ${points} points, ${path.length} characters: PASS`);
