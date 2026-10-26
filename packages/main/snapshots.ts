// SPDX-License-Identifier: GPL-3.0-only
// The profile kept before an install, and put back when going back (#77,
// QGD-FRM-0020). An older version opens a newer store without refusing it,
// so going back without its data is not safe: the snapshot is not optional.
//
// Taken and restored only as the application quits, after the stores have
// closed (updater.ts, applyOnQuit), so nothing is copied under a write. What
// is kept: settings, the state store and the extensions' own data, and the
// callsign files. Not reference.sqlite, which is public data rebuilt when its
// schema is not this version's (reference.ts), and never a login, which is in
// the system's own store. A link is never followed or copied.
import { cpSync, lstatSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join, sep } from 'node:path';
import { compareVersions, isOfferedVersion, isReleaseVersion } from './update-contract.js';

// The last three Stable versions left, and the newest of anything else.
export const KEEP_STABLE = 3;

export interface SnapshotPlaces {
  root: string;       // the application's folder (userData)
  callsigns: string;  // the callsign files' folder; its updates/ is not kept
}

export interface Snapshots {
  take: (version: string) => boolean;
  restore: (version: string) => boolean;
  list: () => string[];
}

const FILES = ['settings.json', 'state.sqlite', 'state.sqlite-wal'];
const FOLDERS = ['extensions'];

function present(path: string): boolean {
  try { lstatSync(path); return true; } catch { return false; }
}

// A file or folder, never a link, and nothing under a folder that is one.
function copy(from: string, to: string, skip?: (path: string) => boolean): void {
  cpSync(from, to, {
    recursive: true, dereference: false, errorOnExist: false, force: true,
    filter: source => !lstatSync(source).isSymbolicLink() && !(skip?.(source) ?? false)
  });
}

export function snapshots(places: SnapshotPlaces): Snapshots {
  const folder = join(places.root, 'snapshots');
  const updates = join(places.callsigns, 'updates');
  const notUpdates = (path: string): boolean => path === updates || path.startsWith(updates + sep);

  const list = (): string[] => {
    if (!present(folder)) return [];
    return readdirSync(folder).filter(name => isOfferedVersion(name) && lstatSync(join(folder, name)).isDirectory());
  };

  const prune = (): void => {
    const kept = list().sort((a, b) => compareVersions(b, a));
    const stable: string[] = kept.filter(name => isReleaseVersion(name)).slice(0, KEEP_STABLE);
    const other: string[] = kept.filter(name => !isReleaseVersion(name)).slice(0, 1);
    for (const name of kept) if (!stable.includes(name) && !other.includes(name)) rmSync(join(folder, name), { recursive: true, force: true });
  };

  const take = (version: string): boolean => {
    if (!isOfferedVersion(version)) return false;
    const partial = join(folder, `.${version}.partial`);
    const done = join(folder, version);
    try {
      mkdirSync(folder, { recursive: true, mode: 0o700 });
      rmSync(partial, { recursive: true, force: true });
      mkdirSync(partial, { mode: 0o700 });
      for (const name of [...FILES, ...FOLDERS]) {
        const source = join(places.root, name);
        if (present(source)) copy(source, join(partial, name));
      }
      if (present(places.callsigns)) copy(places.callsigns, join(partial, 'callsigns'), notUpdates);
      // Whole or not at all: the older one goes only once this one is complete.
      rmSync(done, { recursive: true, force: true });
      renameSync(partial, done);
      prune();
      return true;
    } catch {
      // Never throws: this runs as the application quits.
      try { rmSync(partial, { recursive: true, force: true }); } catch { /* the folder itself is unusable */ }
      return false;
    }
  };

  const restore = (version: string): boolean => {
    if (!isOfferedVersion(version) || !list().includes(version)) return false;
    const kept = join(folder, version);
    try {
      for (const name of [...FILES, 'state.sqlite-shm', ...FOLDERS]) rmSync(join(places.root, name), { recursive: true, force: true });
      for (const name of [...FILES, ...FOLDERS]) {
        const source = join(kept, name);
        if (present(source)) copy(source, join(places.root, name));
      }
      if (present(places.callsigns)) {
        for (const name of readdirSync(places.callsigns)) {
          const path = join(places.callsigns, name);
          if (!notUpdates(path)) rmSync(path, { recursive: true, force: true });
        }
      }
      if (present(join(kept, 'callsigns'))) copy(join(kept, 'callsigns'), places.callsigns);
      return true;
    } catch {
      return false;
    }
  };

  return { take, restore, list };
}

