// SPDX-License-Identifier: GPL-3.0-only
// QGD-APP-0014.1: the packaged application is built from a list of the paths
// that ship, and that list is asserted on the artifact.
//
// This suite used to be `proofs-not-shipped`, checking that three
// demonstration applications were absent. They are gone (QGD-APP-0014), so
// the question it answers is the general one they were an instance of: what is
// in the thing we hand people?
//
// An allowlist is what makes the answer small. `build.files` names `dist/**`,
// `package.json`, `LICENSE`, four data files and the SQL storage applies — so the
// gallery, the suites, the fixtures, the spec and anything added later are
// absent by construction rather than by anybody remembering. The one way that
// stops being true is somebody widening the list, which is why the list itself
// is checked and not only the archive.
//
// "Not shipped" is a check on what was built, never a statement of intent.
import asar from '@electron/asar';
import { resolve, sep } from 'node:path';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { validateManifest } from '../dist/extension-api/manifest.js';
import { grantIds, validateGrantRegister } from '../dist/extension-api/grants.js';

// Where electron-builder leaves the unpacked application on each platform.
const CANDIDATES = [
  'out/mac-arm64/QSO Graph Desktop.app/Contents/Resources/app.asar',
  'out/mac/QSO Graph Desktop.app/Contents/Resources/app.asar',
  'out/linux-unpacked/resources/app.asar',
  'out/linux-arm64-unpacked/resources/app.asar',
  'out/win-unpacked/resources/app.asar',
  'out/win-arm64-unpacked/resources/app.asar'
].map(path => resolve(path));
const archive = CANDIDATES.find(path => existsSync(path)) ?? CANDIDATES[0];

// The library looks a file up by splitting on the platform's separator, so a
// "/" path is given back in the platform's form.
const extract = name => asar.extractFile(archive, name.replace(/^\//, '').split('/').join(sep));

const failures = [];
const notes = [];

let entries;
try {
  // In "/" form on every platform: on Windows the library answers with "\",
  // and every check below is written against "/".
  entries = asar.listPackage(archive).map(entry => entry.replaceAll('\\', '/'));
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
} else {
  notes.push(`the archive is the packaged application: ${entries.length} entries, with the main process among them`);
}

// --------------------------------------------------------------------------
// 1. The list is still a list.
const manifest = JSON.parse(await readFile('package.json', 'utf8'));
const files = manifest.build?.files;
if (!Array.isArray(files) || files.length === 0) {
  failures.push('package.json has no build.files list, so everything in the repository would ship');
} else {
  // A pattern that reaches the whole repository turns the allowlist into a
  // denylist, and a denylist is a guess about what exists. `!`-prefixed
  // entries are refinements of something already named, which is fine.
  const sweeping = files.filter(entry => !entry.startsWith('!') && /^(\*\*|\.|\/)/.test(entry));
  if (sweeping.length > 0) {
    failures.push(`build.files sweeps the repository rather than naming paths: ${sweeping.join(', ')}`);
  }
  // Which top-level directories the list admits at all. A new one appearing
  // here is a deliberate act and should be read by somebody.
  const roots = [...new Set(files
    .filter(entry => !entry.startsWith('!'))
    .map(entry => entry.split('/')[0]))].sort();
  const EXPECTED_ROOTS = ['LICENSE', 'data', 'dist', 'drizzle', 'package.json'];
  if (JSON.stringify(roots) !== JSON.stringify(EXPECTED_ROOTS)) {
    failures.push(`build.files admits ${roots.join(', ')}; this suite expects ${EXPECTED_ROOTS.join(', ')}. `
      + 'If the change is wanted, change it here too and say why in the commit.');
  } else {
    notes.push(`build.files is an allowlist of ${files.length} entr(ies), admitting only: ${roots.join(', ')}`);
  }
}

// --------------------------------------------------------------------------
// 2. Nothing from the development tree is in the archive.
const DEVELOPMENT_ONLY = ['tests', 'scripts', 'storybook', 'baselines', 'spec', 'hdbk', 'rvm', 'docs', 'proofs', 'report'];
// Anchored at the archive root, and node_modules excluded.
//
// Unanchored, this matched `/node_modules/pino/docs` and reported fifteen
// failures about a dependency shipping its own documentation — which is that
// dependency's business and not something this product controls. What is being
// checked is that none of *this repository's* development tree is in the
// archive, and all of it sits at the root.
const beforeTree = failures.length;
for (const directory of DEVELOPMENT_ONLY) {
  const found = entries.filter(entry => new RegExp(`^/?${directory}(/|$)`).test(entry));
  if (found.length > 0) failures.push(`the archive holds ${found.length} ${directory}/ path(s): ${found.slice(0, 3).join(', ')}`);
}
if (failures.length === beforeTree) {
  notes.push(`no path from any of ${DEVELOPMENT_ONLY.length} development-only directories is in the archive`);
}

// --------------------------------------------------------------------------
// 3. And nothing of them inside dist either.
//
// The file list is not enough on its own. An earlier version of this suite
// read dist/renderer/app.js alone and reported PASS while the archive carried
// four whole components as `sourcesContent` inside dist/renderer/app.js.map:
// Rollup drops the code from the bundle and keeps the source in the map. So
// every text entry under dist/ is read, maps included.
const MARKERS = ['sb-manager', 'storybook', '.stories.svelte', 'vitest', 'app-proofs'];
const scanned = [];
for (const entry of entries) {
  if (!/^\/?dist\//.test(entry)) continue;
  if (!/\.(js|cjs|mjs|map|json|html|css|svelte|ts)$/.test(entry)) continue;
  let text;
  try { text = extract(entry).toString('utf8'); } catch { continue; }
  scanned.push({ entry, text });
  const leaked = MARKERS.filter(marker => text.includes(marker));
  if (leaked.length > 0) failures.push(`${entry} names development-only material: ${leaked.join(', ')}`);
}
if (scanned.length === 0) failures.push('no dist entry in the archive could be read; this check saw nothing');
else notes.push(`${scanned.length} dist entr(ies) read, including every source map`);

// --------------------------------------------------------------------------
// 4. The PostgreSQL engine is gone, from the package as well as the source
// (QGD-HDBK-001 §13). Source deletion is not enough on its own: the compiler
// only adds to dist/, and build.files ships all of dist/, so a stale
// dist/engine/ from an earlier build could ship. The build now starts from an
// empty dist/ (scripts/clean-dist.mjs); this is the check that it did.
{
  const stale = entries.filter(entry => /^\/?dist\/engine(\/|$)/.test(entry)
    || /^\/?data\/postgres-build\.json$/.test(entry)
    || /^\/?node_modules\/pg(\/|$)/.test(entry));
  if (stale.length > 0) failures.push(`the archive still holds the PostgreSQL engine: ${stale.slice(0, 3).join(', ')}`);
  let resources = [];
  try {
    const { readdirSync } = await import('node:fs');
    resources = readdirSync(resolve(archive, '..'));
  } catch { failures.push('the Resources folder beside the archive could not be read; this check saw nothing'); }
  if (resources.includes('postgres')) failures.push('Resources/postgres is still bundled beside the application');
  // The About panel's icon, read from a file path on Linux and Windows, so it
  // ships beside the archive rather than inside it (KI7MT, 2026-10-22: the
  // About window had a broken icon on Linux).
  if (!resources.includes('icon.png')) failures.push('icon.png is not beside the archive, so the About panel has no icon on Linux and Windows');
  else notes.push('the About panel\'s icon is beside the archive');
  // And what replaced it is there: the storage process and the SQL it applies.
  for (const wanted of ['dist/storage/storage-service.js', 'dist/storage/reference-worker.js',
    'drizzle/state/meta/_journal.json', 'drizzle/reference/meta/_journal.json']) {
    if (!entries.some(entry => entry.replace(/^\//, '') === wanted)) failures.push(`${wanted} is not in the archive`);
  }
  if (stale.length === 0 && !resources.includes('postgres')) {
    notes.push('no PostgreSQL in the package: no dist/engine, no build register, no pg, no Resources/postgres; the storage process and its SQL are there');
  }
}

// --------------------------------------------------------------------------
// 5. The built-in extensions ship in the package, which is what makes them
// official (QGD-APP-0017), with the host that runs them (QGD-APP-0015), and
// nothing of their tests does.
{
  const relative = entries.map(entry => entry.replace(/^\//, ''));
  for (const wanted of ['dist/extension-host/host.js', 'dist/extensions/on-the-air/manifest.json', 'dist/extensions/on-the-air/main.js']) {
    if (!relative.includes(wanted)) failures.push(`${wanted} is not in the archive`);
  }
  const tests = relative.filter(entry => /^dist\/extensions\/.*\.test\.js$/.test(entry));
  if (tests.length > 0) failures.push(`an extension's tests are in the archive: ${tests.slice(0, 3).join(', ')}`);
  // Read and checked as the product checks it when it loads, against the
  // grant register shipped beside it: a manifest that is there but cannot load
  // is no better than a missing one.
  let loadable = false;
  try {
    const manifest = validateManifest(JSON.parse(extract('dist/extensions/on-the-air/manifest.json').toString('utf8')),
      grantIds(validateGrantRegister(JSON.parse(extract('data/extension-grants.json').toString('utf8')))));
    if (manifest.main !== 'main.js') failures.push('On the Air\'s packaged manifest does not name the main.js shipped beside it');
    else loadable = true;
  } catch (error) {
    failures.push(`On the Air's packaged manifest would not load: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (loadable && tests.length === 0) notes.push('On the Air ships in the package with the extension host, its manifest loads, and none of its tests do');
}

// --------------------------------------------------------------------------
// 6. The control for the control: the bundle has to hold the shell's own
// words, or a bundle that failed to build would look clean.
let bundle;
try {
  bundle = extract('dist/renderer/app.js').toString('utf8');
} catch {
  failures.push('dist/renderer/app.js is not in the archive');
}
if (bundle) {
  const expected = ['Callsigns', 'Settings'];
  const missing = expected.filter(word => !bundle.includes(word));
  if (missing.length > 0) failures.push(`the bundle is missing the shell's own words (${missing.join(', ')}); this check would pass on an empty bundle`);
  else notes.push(`the bundle holds the shell's own words, so an absent marker means absent (${(bundle.length / 1024).toFixed(0)} kB)`);
}

if (failures.length > 0) {
  console.error('The packaged application carries something it should not, or its file list no longer bounds it.');
  for (const failure of failures) console.error(`  ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Package contents: ${notes.length} checks on the packaged artifact: PASS`);
  for (const note of notes) console.log(`  ${note}`);
}
