// SPDX-License-Identifier: GPL-3.0-only
// Where the stores are, and how each comes to exist (QGD-ENG-0001, QGD-ENG-0007).
//
// Everything is under one root, the application's own directory
// (app.getPath('userData')). The root is given by QG Storage's caller, never
// by a user (QGD-ENG-0006).
import { lstatSync, mkdirSync, renameSync, rmSync, realpathSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { isAppId } from '../app-api/manifest.js';
import { StorageFailure, failure } from './errors.js';
import { applyMigrations } from './migrate.js';
import { openStore, type Store } from './sqlite.js';
import { INSTALLATION_ID, installation, stateSchema } from './schema.js';

export interface Layout {
  root: string;
  settings: string;   // read by main, never opened here (QGD-ENG-0003)
  state: string;
  apps: string;
  reference: string;  // exists only once a build has published it
  referenceCache: string;
}

export function layout(root: string): Layout {
  if (!isAbsolute(root)) throw new StorageFailure({ kind: 'path' });
  return {
    root,
    settings: join(root, 'settings.json'),
    state: join(root, 'state.sqlite'),
    apps: join(root, 'apps'),
    reference: join(root, 'reference.sqlite'),
    referenceCache: join(root, 'reference')
  };
}

// QGD-ENG-0018 and QGD-SEC-0004. The identifier must be one a manifest may
// carry, and the folder must really be apps/<id> inside the root, on disk and
// not only in the string. So, on every call and not only on creation:
// - apps/ must be a real directory, not a link, whose real path is
//   <real root>/apps
// - apps/<id>, if it exists, must be a real directory, not a link
// A link at either level could otherwise send a write, or a removal, outside
// the application's directory.
export function appFolder(paths: Layout, id: string, options: { create?: boolean } = {}): string {
  if (!isAppId(id)) throw new StorageFailure({ kind: 'path' });
  const folder = join(paths.apps, id);
  try {
    if (options.create) mkdirSync(paths.apps, { recursive: true, mode: 0o700 });
    if (present(paths.apps)) {
      realDirectory(paths.apps);
      if (realpathSync(paths.apps) !== join(realpathSync(paths.root), 'apps')) throw new StorageFailure({ kind: 'path' });
    }
    if (options.create && !present(folder)) mkdirSync(folder, { mode: 0o700 });
    if (present(folder)) realDirectory(folder);
  } catch (error) {
    throw failure(error, 'path');
  }
  return folder;
}

function realDirectory(path: string): void {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new StorageFailure({ kind: 'path' });
}

export function removeAppFolder(paths: Layout, id: string): void {
  // appFolder validates both levels first, so a link is refused rather than followed.
  const folder = appFolder(paths, id);
  try {
    rmSync(folder, { recursive: true, force: true });
  } catch (error) {
    throw failure(error, 'path');
  }
}

// lstat, so a link, even a dangling one, counts as something being there.
function present(path: string): boolean {
  try { lstatSync(path); return true; } catch { return false; }
}

// state.sqlite is created on first run (QGD-ENG-0007). It is built under a
// temporary name, migrated, closed and only then renamed into place. A
// creation that fails therefore leaves no file the next start could take for
// a store; the next start simply begins again.
export async function openState(paths: Layout, migrations: string, version: string):
  Promise<Store<typeof stateSchema>> {
  const creating = `${paths.state}.creating`;
  const leftovers = [creating, `${creating}-wal`, `${creating}-shm`, `${creating}-journal`];
  // After a failure: best effort, so a cleanup that fails cannot replace the
  // failure being reported. The next start removes what is left, strictly.
  const cleanUp = () => {
    for (const name of leftovers) {
      try { rmSync(name, { force: true }); } catch { /* the reported failure stands */ }
    }
  };
  try {
    mkdirSync(paths.root, { recursive: true, mode: 0o700 });
  } catch (error) {
    throw failure(error, 'open');
  }
  if (!present(paths.state)) {
    // Before a creation: strict. An abandoned temporary database from an
    // earlier failed start must be gone, or this start would build on top of
    // it and could promote it to state.sqlite.
    try {
      for (const name of leftovers) rmSync(name, { force: true });
    } catch (error) {
      throw failure(error, 'open');
    }
    if (leftovers.some(present)) throw new StorageFailure({ kind: 'open' });
    try {
      const fresh = openStore(creating, { schema: stateSchema });
      try {
        // Created in rollback-journal mode and closed before the rename, so no
        // -wal or -shm file is left beside the temporary name.
        fresh.connection.exec('PRAGMA journal_mode = DELETE');
        await applyMigrations(fresh, migrations);
        await recordInstallation(fresh, version);
      } finally {
        fresh.close();
      }
      renameSync(creating, paths.state);
    } catch (error) {
      cleanUp();
      throw failure(error, 'open');
    }
  }
  const store = openStore(paths.state, { schema: stateSchema });
  try {
    await applyMigrations(store, migrations);
    await recordInstallation(store, version);
  } catch (error) {
    store.close();
    throw failure(error, 'migration');
  }
  return store;
}

// Inserted once and never rewritten: the row records when this installation
// began and which version began it.
async function recordInstallation(store: Store<typeof stateSchema>, version: string): Promise<void> {
  await store.unit(async (db) => {
    await db.insert(installation)
      .values({ id: INSTALLATION_ID, createdAt: new Date().toISOString(), createdByVersion: version })
      .onConflictDoNothing();
  });
}
