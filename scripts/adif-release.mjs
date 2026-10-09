// SPDX-License-Identifier: GPL-3.0-only
// Where ADIF's published archive is unpacked, and whether what is there is it.
//
// Shared by the fetch script, the suite and the loader, so there is one answer
// to "is this the release we pinned" rather than three. The same shape as
// scripts/postgres-build.mjs, for the same reason (QGD-REF-0003).
import { access, constants, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export function releaseDirectory(release, root = resolve('.')) {
  return join(root, 'vendor', 'adif', release.version);
}

// Inside the archive everything lives under a directory named for the version
// without its dots: 3.1.7 is published as 317.
export function archiveRoot(release) {
  return release.version.replaceAll('.', '');
}

export function definitionsPath(release, root = resolve('.')) {
  return join(releaseDirectory(release, root), release.source.definitions);
}

export function testQsosPath(release, root = resolve('.')) {
  return join(releaseDirectory(release, root), release.source.testQsos);
}

export async function verifyRelease(release, root = resolve('.')) {
  const problems = [];
  const directory = releaseDirectory(release, root);

  for (const [what, path] of [
    ['the definitions', definitionsPath(release, root)],
    ["ADIF's test QSOs", testQsosPath(release, root)]
  ]) {
    try {
      await access(path, constants.R_OK);
    } catch {
      return { ok: false, version: undefined, problems: [`${what} are missing from ${directory}. Run: make setup`] };
    }
  }

  let version;
  try {
    const definitions = JSON.parse(await readFile(definitionsPath(release, root), 'utf8'));
    version = definitions?.Adif?.Version;
    // The archive says which release it is. A file that says something else is
    // not the release we pinned, whatever the name of the directory says.
    if (version !== release.version) {
      problems.push(`the definitions report ADIF ${version ?? 'no version'}; data/adif-release.json pins ${release.version}`);
    }
    if (definitions?.Adif?.Status !== 'Released') {
      problems.push(`the definitions report status "${definitions?.Adif?.Status}", not Released`);
    }
  } catch (error) {
    problems.push(`the definitions could not be read: ${(error instanceof Error ? error.message : String(error)).slice(0, 120)}`);
  }

  return { ok: problems.length === 0, version, problems };
}
