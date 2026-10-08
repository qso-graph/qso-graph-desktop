// SPDX-License-Identifier: GPL-3.0-only
// Where the pinned PostgreSQL build lives, and whether what is there is it.
//
// Shared by the fetch script, the engine's own check and the tests, so there
// is one answer to "is this build the one we pinned" rather than three.
import { spawnSync } from 'node:child_process';
import { access, constants, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

// vendor/, not node_modules/: this is a pinned download, not a dependency, and
// it is ~350 MB unpacked. .gitignore keeps it out of the repository.
export function binariesDirectory(build, root = resolve('.')) {
  return join(root, 'vendor', 'postgres', String(build.version));
}

export function programPath(build, name, root = resolve('.')) {
  return join(binariesDirectory(build, root), 'bin', name);
}

// Reports rather than throws, so a caller can say what is wrong with it.
export async function verifyBinaries(build, root = resolve('.')) {
  const directory = binariesDirectory(build, root);
  const problems = [];

  let present = [];
  try {
    present = await readdir(join(directory, 'bin'));
  } catch {
    return { ok: false, version: undefined, problems: [`no binaries in ${directory}. Run: make setup`] };
  }

  for (const name of build.contains) {
    const path = join(directory, 'bin', name);
    try {
      await access(path, constants.X_OK);
    } catch {
      problems.push(`${name} is missing or not executable in ${directory}/bin`);
    }
  }

  // QGD-ENG-0005 is a fact about this build, and a fact can stop being true:
  // a later version that did carry the client tools would make the backup
  // design unnecessary, and nobody would notice unless this is checked.
  for (const name of build.absent.programs) {
    if (present.includes(name)) {
      problems.push(`${name} is present, which data/postgres-build.json records as absent — QGD-ENG-0005 and the backup design rest on this`);
    }
  }

  let version;
  if (!problems.length) {
    const run = spawnSync(join(directory, 'bin', 'postgres'), ['--version'], { encoding: 'utf8', timeout: 20_000 });
    if (run.status !== 0) {
      problems.push(`postgres --version failed: ${(run.stderr || run.stdout || '').trim().split('\n')[0]}`);
    } else {
      version = (/\b(\d+\.\d+)\b/.exec(run.stdout) ?? [])[1];
      if (version !== build.version) {
        problems.push(`the build reports ${version ?? 'no version'}, data/postgres-build.json pins ${build.version}`);
      }
    }
  }

  return { ok: problems.length === 0, version, problems };
}
