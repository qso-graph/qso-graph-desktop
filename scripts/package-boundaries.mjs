// SPDX-License-Identifier: GPL-3.0-only
// QGD-REP-0006: the dependency direction between packages, checked over the
// imports themselves.
//
// The QGD-PRT-0107 restructure (QGD-REP-0001) is only worth the move if the
// boundaries it draws hold afterwards. A directory layout on its own enforces
// nothing — relative imports cross it freely, and the three edges this found
// on the day of the move had all been written without anyone deciding them:
// the logger reached into the engine to sweep its own log directory, a
// component reached into the frame's settings contract for the word "dark",
// and a story reached into the shell's page list.
//
// The direction, from QGD-REP-0006:
//
//   persona-core, logging, reference, ui, preload  depend on no package
//   personas, engine                               depend only on those
//   main                                           adds personas and engine
//   renderer                                       may depend on any of them
//   an application                                 app-api and ui, nothing else
//
// Derived, not listed: every file under packages/ is read and every relative
// specifier that leaves its own package is resolved and judged. A scope that
// is a list somebody has to extend goes quiet, which has happened four times
// in this project (QGD-SEC-0021).
import { readdir, readFile } from 'node:fs/promises';
import { normalize, join, dirname, relative, sep } from 'node:path';

// What each package is allowed to reach. Absent from a value means refused;
// absent as a key means the package may reach nothing.
export const ALLOWED = {
  'persona-core': [],
  'logging': [],
  'reference': [],
  'ui': [],
  'preload': [],
  'personas': ['logging', 'persona-core'],
  'engine': ['logging', 'reference'],
  'app-api': ['logging', 'personas', 'engine', 'reference', 'persona-core', 'main'],
  'main': ['logging', 'personas', 'engine', 'reference', 'persona-core', 'ui', 'app-api'],
  'renderer': ['logging', 'personas', 'engine', 'reference', 'persona-core', 'ui', 'main', 'app-api']
};

// An application is not a package: QGD-REP-0003 says a built-in application
// uses only the app API and its grants, exactly as a contributed one would.
export const ALLOWED_FOR_APPS = ['app-api', 'ui'];

// Named, so it cannot be forgotten: a story ships nowhere (QGD-FRM-0009) and
// the gallery is required to render a component the way the shell does
// (QGD-FRM-0006), so the rail's story reads the shell's real page list rather
// than a copy that can drift from it.
export const STORY_EXCEPTION =
  'a .stories.svelte is development-only and the gallery must show the shell as it is (QGD-FRM-0006, QGD-FRM-0009)';

const SOURCE = /\.(ts|cts|mts|svelte)$/;
const SPECIFIER = /(?:\bfrom|\bimport|\brequire)\s*\(?\s*['"](\.[^'"]+)['"]/g;

async function sources(root) {
  const found = [];
  const walk = async directory => {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      // Cargo's build tree and anything installed: neither is ours.
      if (entry.isDirectory() && (entry.name === 'target' || entry.name === 'node_modules')) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (SOURCE.test(entry.name) && !entry.name.endsWith('.d.ts')) found.push(path);
    }
  };
  await walk(root);
  return found.sort();
}

// Every import that leaves its own package, with where it went.
export async function crossings(root = 'packages') {
  const found = [];
  for (const file of await sources(root)) {
    const parts = relative(root, file).split(sep);
    const owner = parts[0];
    const text = await readFile(file, 'utf8');
    for (const match of text.matchAll(SPECIFIER)) {
      const target = normalize(join(dirname(file), match[1]));
      const reached = relative(root, target).split(sep)[0];
      if (reached === owner || reached.startsWith('..')) continue;
      found.push({ file, owner, reached, specifier: match[1], story: file.endsWith('.stories.svelte') });
    }
  }
  return found;
}

// 'allowed', 'refused', or 'waived' — the last only where the direction is
// refused and a story is what crossed, so the four stories that import in a
// permitted direction are not reported as exceptions they do not need.
export function judge(crossing, allowed = ALLOWED) {
  const permitted = allowed[crossing.owner];
  if (permitted === undefined) {
    return { verdict: 'refused', why: `${crossing.owner} is not a package QGD-REP-0001 lists` };
  }
  if (permitted.includes(crossing.reached)) return { verdict: 'allowed' };
  if (crossing.story) return { verdict: 'waived', why: STORY_EXCEPTION };
  return { verdict: 'refused', why: `${crossing.owner} may not depend on ${crossing.reached}` };
}

if (process.argv[1]?.endsWith('package-boundaries.mjs')) {
  const found = await crossings();
  if (found.length === 0) {
    // The gate cannot see its subject. Every package but the leaves imports
    // something, so zero crossings means the walk is wrong — the failure that
    // let svelte-check pass on an empty tree during this very restructure.
    console.error('No cross-package import found at all under packages/.');
    console.error('The frame has them, so this walk is looking in the wrong place.');
    process.exitCode = 1;
  } else {
    const judged = found.map(crossing => ({ crossing, ...judge(crossing) }));
    const refused = judged.filter(entry => entry.verdict === 'refused');
    const waived = judged.filter(entry => entry.verdict === 'waived');
    if (refused.length) {
      console.error('Package boundaries failed. QGD-REP-0006.');
      for (const { crossing, why } of refused) {
        console.error(`  ${crossing.file}  imports ${crossing.specifier}`);
        console.error(`    ${why}`);
      }
      process.exitCode = 1;
    } else {
      const packages = new Set(found.map(crossing => crossing.owner));
      console.log(`Package boundaries: ${found.length} cross-package import(s) from ${packages.size} package(s), every one in the permitted direction: PASS`);
      for (const { crossing, why } of waived) {
        console.log(`  waived: ${relative('packages', crossing.file)} -> ${crossing.reached} — ${why}`);
      }
    }
  }
}
