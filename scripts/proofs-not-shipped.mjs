// SPDX-License-Identifier: GPL-3.0-only
// QGD-APP-0014.1: the proof applications are absent from the packaged
// application, and that is asserted on the artifact.
//
// "Not shipped" is a check on what was built, never a statement of intent. A
// demonstration that reached an operator would be a feature nobody wrote, and
// the three in proofs/ are deliberately persuasive — one of them types a
// callsign into a real QRZ lookup.
//
// Two independent mechanisms keep them out, so this checks both and would fail
// if either stopped working:
//
//   1. proofs/ is not in electron-builder's `files` list, so no manifest is in
//      the archive and the app runtime finds no application to load.
//   2. __QG_PROOFS__ is false in an ordinary build, so Rollup drops the host
//      import and the three components with it — nothing of them is in
//      dist/renderer/app.js.
//
// Modelled on the gallery's own proof (QGD-FRM-0009), which is why that one is
// checked here too: if the gallery ever did get packaged, the same list is
// wrong and this is the suite that reads it.
import asar from '@electron/asar';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';

const archive = resolve('out/mac-arm64/QSO Graph Desktop.app/Contents/Resources/app.asar');

const failures = [];
const notes = [];

let entries;
try {
  entries = asar.listPackage(archive);
} catch (error) {
  console.error(`The packaged archive could not be read at ${archive}.`);
  console.error('Run `npm run package` first.');
  console.error(String(error instanceof Error ? error.message : error).slice(0, 200));
  process.exit(1);
}

// Not vacuous: the archive has to be the real one before its contents mean
// anything. A listing of nothing would otherwise pass every check below.
if (entries.length < 20 || !entries.some(entry => entry.endsWith('/main/main.js'))) {
  failures.push(`the archive listed ${entries.length} entries and no main process; this is not the packaged application`);
}

// 1. No manifest, no page, no host.
const shipped = entries.filter(entry => /(^|\/)proofs(\/|$)/.test(entry));
if (shipped.length > 0) failures.push(`the archive holds ${shipped.length} proofs path(s): ${shipped.slice(0, 5).join(', ')}`);
else notes.push(`no proofs path among the archive's ${entries.length} entries`);

// The gallery, by the same measure.
const gallery = entries.filter(entry => /storybook/i.test(entry));
if (gallery.length > 0) failures.push(`the archive holds ${gallery.length} gallery path(s)`);
else notes.push('no gallery path either (QGD-FRM-0009)');

// 2. Nothing of their pages in the renderer bundle.
//
// Marked by the words they put on screen rather than by file name, because a
// bundle has no file names in it — which is exactly why the file-list check
// above is not enough on its own.
const MARKERS = [
  'App API harness', 'Try every capability',
  'Space weather', 'Fetch the latest indices',
  'Callsign lookup', 'app-proofs'
];
// Every text entry under dist/, not just app.js.
//
// The first version of this read dist/renderer/app.js alone and reported PASS
// while the archive carried all four proof components in full, as
// `sourcesContent` inside dist/renderer/app.js.map: Rollup drops the code from
// the bundle and keeps the source in the map. The executable was clean and the
// application shipped the demonstrations as source. Found in review, which is
// the second time in this project a gate has passed by looking at one of the
// places a thing could be.
const scanned = [];
for (const entry of entries) {
  if (!/^\/?dist\//.test(entry)) continue;
  if (!/\.(js|cjs|mjs|map|json|html|css|svelte|ts)$/.test(entry)) continue;
  let text;
  try { text = asar.extractFile(archive, entry.replace(/^\//, '')).toString('utf8'); } catch { continue; }
  scanned.push({ entry, text });
  const leaked = MARKERS.filter(marker => text.includes(marker));
  if (leaked.length > 0) failures.push(`${entry} holds proof markers: ${leaked.join(', ')}`);
  if (/(^|\/)proofs\//.test(text) && entry.endsWith('.map')) {
    failures.push(`${entry} names a proofs/ source`);
  }
}
if (scanned.length === 0) failures.push('no dist entry in the archive could be read; this check saw nothing');
else notes.push(`${scanned.length} dist entr(ies) read, including every source map, and none names a proof`);

let bundle;
try {
  bundle = asar.extractFile(archive, 'dist/renderer/app.js').toString('utf8');
} catch {
  failures.push('dist/renderer/app.js is not in the archive');
}
if (bundle) {
  const leaked = MARKERS.filter(marker => bundle.includes(marker));
  if (leaked.length > 0) failures.push(`the renderer bundle holds proof markers: ${leaked.join(', ')}`);
  else notes.push(`none of ${MARKERS.length} proof markers in the renderer bundle (${(bundle.length / 1024).toFixed(0)} kB)`);

  // The control for the control: the bundle has to contain the shell's own
  // words, or a bundle that failed to build would look clean.
  const expected = ['Personas', 'Settings'];
  const missing = expected.filter(word => !bundle.includes(word));
  if (missing.length > 0) failures.push(`the bundle is missing the shell's own words (${missing.join(', ')}); this check would pass on an empty bundle`);
  else notes.push("the bundle does hold the shell's own words, so an absent marker means absent");

  // And no Apps entry in the rail.
  if (/id:\s*['"]apps['"]/.test(bundle) && bundle.includes("'Apps'")) {
    failures.push('the packaged rail offers an Apps entry');
  } else {
    notes.push('the packaged rail offers no Apps entry');
  }
}

// 3. The source of truth for mechanism 1, so a change to it is seen here too.
const manifest = JSON.parse(await readFile('package.json', 'utf8'));
const listed = manifest.build.files.join(' ');
if (/proofs/.test(listed)) failures.push("package.json's build.files names proofs");
else notes.push('build.files does not name proofs');

if (failures.length > 0) {
  console.error('The proof applications are not absent from the packaged application.');
  for (const failure of failures) console.error(`  ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Proofs not shipped: ${notes.length} checks on the packaged artifact: PASS`);
  for (const note of notes) console.log(`  ${note}`);
}
