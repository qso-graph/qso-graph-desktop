// SPDX-License-Identifier: GPL-3.0-only
// Bringing the engine all the way up, or leaving nothing running.
//
// "Up" means the postmaster is accepting connections AND the migrations have
// been applied. An engine that is listening but not migrated is not one
// anything should be writing to (QGD-ENG-0013), so everything after the
// postmaster starts is part of starting — and a failure in any of it stops
// the postmaster again rather than leaving a half-started database that the
// next status read would cheerfully call "running".
import { readFile } from 'node:fs/promises';
import { connectAsSuperuser } from './roles.js';
import { applyMigrations, recordInstallation } from './migrate.js';
import { initialise, start, stop, type EnginePaths } from './supervisor.js';
import type { Endpoint } from './endpoint.js';
import { openArchive, type FetchArchive } from './reference/fetch.js';
import { ensureAdif, type Loaded, type Register } from './reference/load.js';

export interface ReferenceOptions {
  // data/reference-sources.json, read by the caller.
  register: Register;
  // Where the fetched archive is kept between starts.
  cacheDirectory: string;
  // Replaced by the suite, which has the archive already.
  fetchArchive?: FetchArchive;
}

export interface StartOptions {
  migrations: string;
  buildFile: string;
  // Absent means no reference load was asked for, which is reported as
  // "skipped" rather than passed over in silence (QGD-REF-0014).
  reference?: ReferenceOptions;
  onWarning?: (message: string, fields?: Record<string, unknown>) => void;
}

// QGD-REF-0014: three answers, and "unavailable" is one of them. There is no
// fourth answer that means "fine, probably".
export type ReferenceState =
  | { state: 'loaded'; loaded: Loaded; fromCache: boolean }
  | { state: 'current' }
  | { state: 'skipped' }
  | { state: 'unavailable'; reason: string };

export interface Started {
  version: string;
  migrationsApplied: number;
  reference: ReferenceState;
}

export async function bringUp(
  paths: EnginePaths,
  endpoint: Endpoint,
  options: StartOptions
): Promise<Started> {
  await initialise(paths);
  await start(paths, endpoint);

  try {
    const client = await connectAsSuperuser(endpoint, 'postgres', error => {
      options.onWarning?.('engine connection dropped', { reason: error.message });
    });
    try {
      const applied = await applyMigrations(client, options.migrations);
      const build = JSON.parse(await readFile(options.buildFile, 'utf8')) as { major: number; version: string };
      await recordInstallation(client, build.major, build.version);
      // After the migrations, because the tables it fills are made by one, and
      // inside the try, because a load that throws must still leave a stopped
      // engine rather than a running one — but its failure is caught below and
      // does not become the start's (QGD-REF-0014).
      const reference = await loadReference(client, options);
      return { version: build.version, migrationsApplied: applied.count, reference };
    } finally {
      await client.end().catch(() => {});
    }
  } catch (error) {
    // Everything from here was part of starting, so a failure in it means the
    // engine did not start — and an engine nobody asked for must not be left
    // running with a schema nothing expects.
    await stop(paths).catch(() => {});
    throw error;
  }
}

// The reference load. Its failure is reported, not thrown: the engine is up
// and migrated, and a machine with no network has a working database with no
// reference data in it (QGD-REF-0014). What reads the data asks the source
// table whether it is there, so "not loaded" is an answer and not a silence.
async function loadReference(
  client: Awaited<ReturnType<typeof connectAsSuperuser>>,
  options: StartOptions
): Promise<ReferenceState> {
  if (!options.reference) return { state: 'skipped' };
  const { register, cacheDirectory, fetchArchive } = options.reference;
  try {
    const archive = await openArchive(register.adif, cacheDirectory, fetchArchive);
    const result = await ensureAdif(client, archive.definitions, register);
    return result === 'current'
      ? { state: 'current' }
      : { state: 'loaded', loaded: result, fromCache: archive.fromCache };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'the reference data could not be loaded';
    options.onWarning?.('reference data not loaded', { reason });
    return { state: 'unavailable', reason };
  }
}
