// SPDX-License-Identifier: GPL-3.0-only
// QGD-REP-0006: the dependency direction between packages, checked over the
// imports themselves.
//
// The QGD-PRT-0107 restructure (QGD-REP-0001) is only worth the move if the
// boundaries it draws hold afterwards. A directory layout on its own enforces
// nothing — relative imports cross it freely, and the three edges this found
// on the day of the move had all been written without anyone deciding them:
// the logger reached into the engine to sweep its own log directory, a
// component reached into the core's settings contract for the word "dark",
// and a story reached into the shell's page list.
//
// The direction, from QGD-REP-0006:
//
//   persona-core, logging, reference, ui, preload, extension-api   depend on no package
//   personas, storage                                        depend only on those
//   main                                                     adds personas, storage, extension-api
//   renderer                                                 may depend on any of them
//   an application                                           extension-api and ui, nothing else
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
  // The contract an application is written against, so it depends on nothing:
  // a surface that imported the core's own contracts would hand an
  // application the core's internals through its own types, and main would
  // depend on it while it depended on main (QGD-REP-0006).
  'extension-api': [],
  'personas': ['logging', 'persona-core'],
  // The SQLite stores (QGD-ENG-0001). extension-api only for the shape of an
  // application id, which names a folder (QGD-ENG-0018).
  'storage': ['extension-api', 'logging', 'reference'],
  'main': ['logging', 'personas', 'storage', 'reference', 'persona-core', 'ui', 'extension-api'],
  'renderer': ['logging', 'personas', 'storage', 'reference', 'persona-core', 'ui', 'main', 'extension-api']
};

// An application is not a package: QGD-REP-0003 says a built-in application
// uses only the extension API and its grants, exactly as a contributed one would.
export const ALLOWED_FOR_APPS = ['extension-api', 'ui'];

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
// QGD-REP-0003 and QGD-REP-0006, for applications rather than packages: an
// application depends on extension-api and ui and on nothing else. Checked over
// apps/, which is empty until QGD-PRT-0108 — so what is asserted here is the
// rule the first application will meet, not a rule being enforced on code
// that exists.
//
// An application reaching into `personas`, `storage`, `reference` or `main`
// would be using the core directly, which is the thing the extension API exists to
// prevent. A built-in application gets no shortcut a contributed one lacks
// (D-33).
export const EXTENSION_ROOTS = ['extensions'];

export async function extensionCrossings() {
  const found = [];
  for (const root of EXTENSION_ROOTS) {
    for (const file of await sources(root)) {
      // The owning application is its own directory, not the root. Comparing
      // roots treated everything under apps/ as one application, so
      // apps/one/page.ts importing ../two/private.ts produced no crossing at
      // all and the gate passed — one application depending directly on
      // another's implementation, which is what QGD-REP-0003 forbids. Found in
      // review.
      const parts = file.split(sep);
      const owner = parts.length > 2 ? join(parts[0], parts[1]) : parts[0];
      const text = await readFile(file, 'utf8');
      for (const match of text.matchAll(SPECIFIER)) {
        const target = normalize(join(dirname(file), match[1]));
        // Inside its own directory is its own business.
        if (!target.startsWith('..') && target.startsWith(owner + sep)) continue;
        const reachedParts = target.split(sep);
        const reached = reachedParts[0] === 'packages'
          ? reachedParts[1]
          // Another application, named by its directory so the refusal says
          // which one.
          : (reachedParts.length > 2 ? join(reachedParts[0], reachedParts[1]) : reachedParts[0]);
        found.push({ file, owner, reached, specifier: match[1] });
      }
    }
  }
  return found;
}

export function judgeApp(crossing) {
  if (ALLOWED_FOR_APPS.includes(crossing.reached)) return { verdict: 'allowed' };
  return {
    verdict: 'refused',
    why: `an application may depend on ${ALLOWED_FOR_APPS.join(' and ')} only, not ${crossing.reached}`
  };
}

// The core reaching the other way, which happens exactly once and is named
// here so it is a decision rather than a gap.
//
// Shell.svelte imports the proof host behind PROOFS_ENABLED, a build-time
// constant. That is how the demonstrations are kept out of a release bundle:
// with the constant false, Rollup drops the import and everything it reaches
// (QGD-APP-0014.1). Loading a page from disk instead would mean widening the
// three resources policy.ts serves over qg: to a pattern (QGD-SEC-0008), which
// is what a contributed application will need and what the sandbox Part brings.
//
// Any import from packages/ into apps/ is refused: the core must not depend
// on an application.
// Keyed on the importing file AND the exact file it may reach.
//
// The first version keyed on the importer alone, which exempted Shell.svelte's
// every import: `../../apps/example/private.ts` from Shell was marked named
// and allowed, though the exception it was claiming is the proof host and
// nothing else. An allowance that names one file and grants a directory is not
// the allowance that was written down. Found in review.
// Deliberately empty.
//
// It held one entry until 2026-10-10 — the host that mounted the
// demonstration applications — and that host is gone with them
// (QGD-APP-0014). With nothing named here, every import from `packages/` into
// an application is refused, which is the rule as written. The mechanism is
// kept rather than deleted because the sandboxed-tier Part may need one named
// exception, and an exception has to be a named file reaching a named file,
// never an importer granted a directory.
export const CORE_TO_EXTENSION_ALLOWANCE = {};


// The allowance decision, on its own so it can be controlled.
//
// It is a function rather than a lookup because the lookup was the defect: an
// exception keyed on the importer alone grants that importer everything under
// apps/, and nothing in a clean run shows it. The control is in
// tests/package-boundaries.test.mjs.
export function namedAllowance(file, target) {
  const allowance = CORE_TO_EXTENSION_ALLOWANCE[file];
  return allowance !== undefined && target === allowance.target;
}

export async function coreReachingExtensions() {
  const found = [];
  for (const file of await sources('packages')) {
    const text = await readFile(file, 'utf8');
    for (const match of text.matchAll(SPECIFIER)) {
      const target = normalize(join(dirname(file), match[1]));
      const root = target.split(sep)[0];
      if (!EXTENSION_ROOTS.includes(root)) continue;
      // The allowance has to match the target too, not merely the importer.
      found.push({ file, reached: root, specifier: match[1], target, named: namedAllowance(file, target) });
    }
  }
  return found;
}

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
    console.error('The core has them, so this walk is looking in the wrong place.');
    process.exitCode = 1;
  } else {
    const judged = found.map(crossing => ({ crossing, ...judge(crossing) }));
    const extensions = (await extensionCrossings()).map(crossing => ({ crossing, ...judgeApp(crossing) }));
    const inward = (await coreReachingExtensions()).map(crossing => ({
      crossing,
      verdict: crossing.named ? 'allowed' : 'refused',
      why: crossing.named ? undefined : `the core must not depend on ${crossing.reached}/`
    }));
    const refused = [...judged, ...extensions, ...inward].filter(entry => entry.verdict === 'refused');
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
      // An empty scope says so rather than reporting a pass.
      //
      // Four gates in this project went quiet by having nothing to look at —
      // ESLint reviewing no Svelte, svelte-check excluding every story, the
      // network scan's scope, and svelte-check again after the restructure.
      // `apps/` is empty until QGD-PRT-0108, and "0 import(s), every one
      // permitted: PASS" reads like a check that ran. This one did not.
      console.log(extensions.length === 0
        ? 'Application boundaries: extensions/ holds no application yet (QGD-PRT-0108), so nothing was checked. '
          + `The rule it will meet — extension-api and ui only — is asserted in tests/package-boundaries.test.mjs.`
        : `Application boundaries: ${extensions.length} import(s) out of extensions/, every one to ${ALLOWED_FOR_APPS.join(' or ')}: PASS`);
      for (const entry of inward) {
        console.log(`  named: ${entry.crossing.file} -> ${entry.crossing.target} — ${CORE_TO_EXTENSION_ALLOWANCE[entry.crossing.file].why}`);
      }
      for (const { crossing, why } of waived) {
        console.log(`  waived: ${relative('packages', crossing.file)} -> ${crossing.reached} — ${why}`);
      }
    }
  }
}
