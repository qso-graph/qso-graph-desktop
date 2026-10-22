// SPDX-License-Identifier: GPL-3.0-only
// Re-reads TQSL's published config.xml and says whether its station location
// fields are still the ones data/tqsl-station-fields.json gives a home. P9-tqsl
// (QGD-STN-0009).
//
// Run by hand when TQSL publishes a new configuration: it goes to SourceForge,
// so it is not part of `make verify`, which needs no network. Nothing it reads
// is written anywhere; the register holds field names, the version and the
// SHA-256 of what was read, never TQSL's file.
//
//   node scripts/tqsl-fields.mjs
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const register = JSON.parse(await readFile('data/tqsl-station-fields.json', 'utf8'));
// TQSL's latest, not the revision the register pins: the point is to see
// whether a newer TQSL asks for something a Location has no home for.
const LATEST = 'https://sourceforge.net/p/trustedqsl/tqsl/ci/master/tree/src/config.xml?format=raw';
const response = await fetch(LATEST);
if (!response.ok) {
  console.error(`TQSL's config.xml could not be fetched: HTTP ${response.status}.`);
  process.exit(1);
}
const text = await response.text();
const sha256 = createHash('sha256').update(text).digest('hex');
const version = /<tqslconfig majorversion="(\d+)" minorversion="(\d+)"/.exec(text);
const pages = /<locpages>([\s\S]*?)<\/locpages>/.exec(text);
if (!version || !pages) {
  console.error("TQSL's config.xml is not the shape this reads: no version, or no <locpages>.");
  process.exit(1);
}
const fields = new Set([...pages[1].matchAll(/<pageField>([A-Z_]+)<\/pageField>/g)].map(match => match[1]));
const recorded = new Set(Object.keys(register.fields));
const added = [...fields].filter(field => !recorded.has(field));
const removed = [...recorded].filter(field => !fields.has(field));

console.log(`TQSL config ${version[1]}.${version[2]}, SHA-256 ${sha256}`);
console.log(`Recorded: ${register.source.configVersion}, SHA-256 ${register.source.sha256}`);
if (added.length || removed.length) {
  if (added.length) console.error(`  New in TQSL, with no home on a Location yet: ${added.join(', ')}`);
  if (removed.length) console.error(`  Recorded here, no longer in TQSL: ${removed.join(', ')}`);
  process.exit(1);
}
console.log(`TQSL station location fields: all ${fields.size} have a home on a Location: PASS`);
if (sha256 !== register.source.sha256) {
  console.log('  The file has changed since it was recorded, and its fields have not. Update the version and SHA-256 in the register.');
}
