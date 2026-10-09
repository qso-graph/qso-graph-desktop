// SPDX-License-Identifier: GPL-3.0-only
// Cuts the bundled PostgreSQL down to what QSO Graph Desktop actually runs.
//
// QGD-ENG-0004.1. The published build is 356 MB, which is not a reasonable
// thing to put inside a desktop application for one operator. Almost half of
// that is the same file stored under two or three names, and most of the rest
// is machinery this product never reaches: procedural languages, contrib
// modules, and conversions between character encodings it never uses.
//
// Run by scripts/fetch-postgres.mjs after the download has been verified, so
// the SHA-256 in data/postgres-build.json is checked against what was
// published and the trim is applied to a tree already known to be genuine.
//
// Idempotent: running it twice changes nothing, which is what lets the fetch
// script run it unconditionally.
import { lstat, readdir, readFile, rm, stat, symlink, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, join, relative } from 'node:path';

export async function treeSize(directory) {
  let bytes = 0;
  let files = 0;
  for (const entry of await readdir(directory, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    const info = await lstat(join(entry.parentPath ?? directory, entry.name)).catch(() => undefined);
    if (!info || info.isSymbolicLink()) continue;
    bytes += info.size;
    files += 1;
  }
  return { bytes, files };
}

// Identical files stored under several names. macOS ships a library as
// libfoo.1.2.dylib, libfoo.1.dylib and libfoo.dylib; the loader follows
// whichever name the binary was linked against, and a symlink answers that
// just as well as a copy. The largest copy in each set is kept as the real
// file and the rest become links to it.
export async function deduplicate(directory) {
  const sets = new Map();
  for (const name of await readdir(directory)) {
    const path = join(directory, name);
    const info = await lstat(path);
    if (!info.isFile()) continue;
    const digest = createHash('sha256').update(await readFile(path)).digest('hex');
    if (!sets.has(digest)) sets.set(digest, []);
    sets.get(digest).push(name);
  }

  let saved = 0;
  const linked = [];
  for (const names of sets.values()) {
    if (names.length < 2) continue;
    // The most specific name is the real one, because that is what a binary
    // records when it is linked: libicuuc.68.2.dylib, not libicuuc.dylib.
    const keep = [...names].sort((a, b) => b.length - a.length)[0];
    for (const name of names) {
      if (name === keep) continue;
      const path = join(directory, name);
      saved += (await stat(path)).size;
      await unlink(path);
      await symlink(keep, path);
      linked.push(`${name} -> ${keep}`);
    }
  }
  return { saved, linked };
}

export async function removeAll(root, paths) {
  let saved = 0;
  const removed = [];
  for (const path of paths) {
    const full = join(root, path);
    const info = await lstat(full).catch(() => undefined);
    if (!info) continue;
    saved += info.isDirectory() ? (await treeSize(full)).bytes : info.size;
    await rm(full, { recursive: true, force: true });
    removed.push(path);
  }
  return { saved, removed };
}

// Everything in lib/postgresql that is not in this list goes. An allow list
// rather than a deny list: a later version that added a module would otherwise
// ship it without anyone deciding to.
export function keptPlugins(trim) {
  return new Set(trim.plugins.keep);
}

export async function trimPlugins(root, trim) {
  const directory = join(root, 'lib', 'postgresql');
  const keep = keptPlugins(trim);
  const doomed = [];
  for (const name of await readdir(directory).catch(() => [])) {
    if (keep.has(name)) continue;
    doomed.push(relative(root, join(directory, name)));
  }
  return removeAll(root, doomed);
}

// The same allow-list treatment for the extension scripts initdb reads. The
// rest describe contrib modules that are no longer there, and an extension
// whose library is gone is a CREATE EXTENSION that fails confusingly.
export async function trimExtensions(root, trim) {
  const directory = join(root, 'share', 'postgresql', 'extension');
  const keep = new Set(trim.extensions.keep);
  const doomed = [];
  for (const name of await readdir(directory).catch(() => [])) {
    if (keep.has(name)) continue;
    doomed.push(relative(root, join(directory, name)));
  }
  return removeAll(root, doomed);
}

export async function trim(root, build) {
  const before = await treeSize(root);
  const report = { before, steps: [] };

  const duplicates = await deduplicate(join(root, 'lib'));
  report.steps.push({ what: 'duplicate libraries replaced by symlinks', ...duplicates });

  const plugins = await trimPlugins(root, build.trim);
  report.steps.push({ what: 'server plugins not used by this product', ...plugins });

  const extensions = await trimExtensions(root, build.trim);
  report.steps.push({ what: 'extension scripts for modules that are gone', ...extensions });

  const removed = await removeAll(root, build.trim.remove);
  report.steps.push({ what: 'files this product never reads', ...removed });

  report.after = await treeSize(root);
  return report;
}

export function describe(report) {
  const mb = bytes => `${(bytes / 1_000_000).toFixed(1)} MB`;
  const lines = [`PostgreSQL build: ${mb(report.before.bytes)} in ${report.before.files} files`];
  for (const step of report.steps) {
    if (!step.saved) continue;
    lines.push(`  −${mb(step.saved)}  ${step.what}`);
  }
  lines.push(`  = ${mb(report.after.bytes)} in ${report.after.files} files`);
  return lines.join('\n');
}

if (process.argv[1] && basename(process.argv[1]) === 'trim-postgres.mjs') {
  const build = JSON.parse(await readFile('data/postgres-build.json', 'utf8'));
  const { binariesDirectory } = await import('./postgres-build.mjs');
  const report = await trim(binariesDirectory(build), build);
  console.log(describe(report));
}
