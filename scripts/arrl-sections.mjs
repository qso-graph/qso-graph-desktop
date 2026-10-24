// SPDX-License-Identifier: GPL-3.0-only
// Compares ARRL's live Section Boundaries page with the copy the build is
// pinned to (data/county-sources.json, an Internet Archive snapshot, because
// ARRL's own page varies from one request to the next). Says which sections
// and counties differ, so a change at ARRL is seen and the pin moved on
// purpose. Run by hand: it goes to the network, so it is not in make verify.
//
//   node scripts/arrl-sections.mjs
import { readFile } from 'node:fs/promises';
import { cachedSource, parseSections } from './county-data.mjs';

const source = JSON.parse(await readFile('data/county-sources.json', 'utf8')).sections;
const pinned = parseSections(await readFile(cachedSource(source), 'utf8').catch(() => {
  console.error('The pinned copy is not fetched. Run: node scripts/fetch-counties.mjs');
  process.exit(1);
}));
const response = await fetch(source.live, { headers: { 'User-Agent': 'QSO Graph Desktop section check' } });
if (!response.ok) { console.error(`ARRL's page could not be fetched: HTTP ${response.status}.`); process.exit(1); }
const live = parseSections(await response.text());

const key = section => `${section.name}: ${(section.counties ?? []).join(', ')}${section.note ? ` (${section.note})` : ''}`;
const before = new Set(pinned.map(key));
const after = new Set(live.map(key));
const gone = [...before].filter(entry => !after.has(entry));
const added = [...after].filter(entry => !before.has(entry));
console.log(`Pinned: ${pinned.length} sections, archived ${source.archived}. Live: ${live.length} sections.`);
for (const entry of gone) console.log(`  pinned only: ${entry}`);
for (const entry of added) console.log(`  live only:   ${entry}`);
if (gone.length || added.length) {
  console.log('ARRL\'s page differs from the pinned copy. If the change matters, move the pin; a spelling is a correction in data/county-sources.json.');
  process.exit(1);
}
console.log('ARRL\'s sections: the live page matches the pinned copy: PASS');
