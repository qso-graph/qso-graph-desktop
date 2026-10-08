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

export interface StartOptions {
  migrations: string;
  buildFile: string;
  onWarning?: (message: string, fields?: Record<string, unknown>) => void;
}

export interface Started {
  version: string;
  migrationsApplied: number;
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
      return { version: build.version, migrationsApplied: applied.count };
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
