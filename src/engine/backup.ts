// SPDX-License-Identifier: GPL-3.0-only
// Backup and restore.
//
// QGD-ENG-0011: a backup is a copy of the data directory taken with the engine
// stopped. Not a dump, because the only PostgreSQL build published for macOS
// arm64 carries no pg_dump (QGD-ENG-0005) — and a stopped data directory is a
// complete, consistent database, which is the property a dump is usually
// bought for.
//
// The cost is that it is not portable across major versions. QGD-ENG-0012
// meets that by refusing a restore from a different major rather than writing
// it over a working database and finding out afterwards.
import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { EngineError, exists, status, type EnginePaths } from './supervisor.js';

export const MANIFEST = 'manifest.json';
export const DATA = 'data';
const KIND = 'qso-graph-desktop-engine-backup';

export interface BackupManifest {
  kind: typeof KIND;
  takenAt: string;
  // The major that wrote this data directory, read from PG_VERSION, which is
  // the database's own record of it and needs nothing running to read.
  postgresMajor: number;
  postgresVersion: string;
  files: number;
  bytes: number;
}

export function isManifest(value: unknown): value is BackupManifest {
  if (typeof value !== 'object' || value === null) return false;
  const manifest = value as Record<string, unknown>;
  return manifest.kind === KIND
    && typeof manifest.takenAt === 'string'
    && typeof manifest.postgresMajor === 'number'
    && Number.isInteger(manifest.postgresMajor)
    && typeof manifest.postgresVersion === 'string'
    && typeof manifest.files === 'number'
    && typeof manifest.bytes === 'number';
}

// PG_VERSION holds the major as text, and it is the authority: the build we
// think we have is not necessarily the build that wrote this directory.
export async function majorOf(data: string): Promise<number> {
  const raw = await readFile(join(data, 'PG_VERSION'), 'utf8').catch(() => undefined);
  const major = Number.parseInt((raw ?? '').trim(), 10);
  if (!Number.isInteger(major)) {
    throw new EngineError('That is not a database directory.', `${data} has no readable PG_VERSION.`);
  }
  return major;
}

async function measure(directory: string): Promise<{ files: number; bytes: number }> {
  let files = 0;
  let bytes = 0;
  for (const entry of await readdir(directory, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    files += 1;
    bytes += (await stat(join(entry.parentPath ?? directory, entry.name)).catch(() => ({ size: 0 }))).size;
  }
  return { files, bytes };
}

// QGD-ENG-0012: the previous backup survives a failed one. Everything is
// written beside the destination and moved into place at the end, so the
// backup that was there is only replaced once there is a whole one to replace
// it with.
export async function backup(paths: EnginePaths, destination: string, version: string): Promise<BackupManifest> {
  const state = await status(paths);
  if (state === 'running') {
    throw new EngineError('The engine is running.', 'A backup is a copy of the data directory, which has to be at rest.');
  }
  if (state === 'no-database') {
    throw new EngineError('There is no database to back up.', `${paths.data} holds none.`);
  }

  const major = await majorOf(paths.data);
  const staging = `${destination}.writing`;
  const previous = `${destination}.previous`;
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });

  let moved = false;
  try {
    await cp(paths.data, join(staging, DATA), { recursive: true, preserveTimestamps: true });
    const { files, bytes } = await measure(join(staging, DATA));
    const manifest: BackupManifest = {
      kind: KIND,
      takenAt: new Date().toISOString(),
      postgresMajor: major,
      postgresVersion: version,
      files,
      bytes
    };
    await writeFile(join(staging, MANIFEST), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });

    if (await exists(destination)) {
      await rm(previous, { recursive: true, force: true });
      await rename(destination, previous);
      moved = true;
    }
    await rename(staging, destination);
    await rm(previous, { recursive: true, force: true });
    return manifest;
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    // The old backup goes back where it was. A failed backup must not be the
    // reason there is no backup.
    if (moved && !await exists(destination)) await rename(previous, destination).catch(() => {});
    throw error;
  }
}

export async function readManifest(source: string): Promise<BackupManifest> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(join(source, MANIFEST), 'utf8'));
  } catch {
    throw new EngineError('That is not a backup.', `${source} has no readable ${MANIFEST}.`);
  }
  if (!isManifest(parsed)) {
    throw new EngineError('That is not a backup this version wrote.', `${join(source, MANIFEST)} is not in the expected shape.`);
  }
  return parsed;
}

// QGD-ENG-0012: staged beside the live database and moved into place, so a
// restore that fails leaves the database that was there untouched.
export async function restore(paths: EnginePaths, source: string, intoMajor: number): Promise<BackupManifest> {
  if (await status(paths) === 'running') {
    throw new EngineError('The engine is running.', 'A restore replaces the data directory, which cannot be in use.');
  }

  const manifest = await readManifest(source);
  if (manifest.postgresMajor !== intoMajor) {
    throw new EngineError(
      `That backup was made by PostgreSQL ${manifest.postgresMajor} and this is ${intoMajor}.`,
      'A data directory does not move between major versions. Restoring it would not produce a database that starts.');
  }
  // What the manifest says and what is in the directory have to agree, or the
  // check above was performed against a label rather than against the data.
  const actual = await majorOf(join(source, DATA));
  if (actual !== manifest.postgresMajor) {
    throw new EngineError('That backup does not match its own manifest.',
      `${MANIFEST} says PostgreSQL ${manifest.postgresMajor}; the data says ${actual}.`);
  }

  const staging = `${paths.data}.restoring`;
  const replaced = `${paths.data}.replaced`;
  await rm(staging, { recursive: true, force: true });

  let swapped = false;
  try {
    await cp(join(source, DATA), staging, { recursive: true, preserveTimestamps: true });
    // PostgreSQL refuses to start on a data directory anyone else can read.
    await chmod(staging, 0o700);
    await majorOf(staging);

    if (await exists(paths.data)) {
      await rm(replaced, { recursive: true, force: true });
      await rename(paths.data, replaced);
      swapped = true;
    }
    await rename(staging, paths.data);
    await rm(replaced, { recursive: true, force: true });
    return manifest;
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    // Put back whatever was there. A restore that fails must not be the reason
    // there is no database.
    if (swapped && !await exists(paths.data)) await rename(replaced, paths.data).catch(() => {});
    throw error;
  }
}
