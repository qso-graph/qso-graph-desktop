// SPDX-License-Identifier: GPL-3.0-only
// Portable mode (KI7MT, 2026-10-23): a folder named qso-graph-data beside the
// application holds everything the application keeps, so it runs from a USB
// stick, or any folder, with its data beside it. Started with --portable, the
// folder is made. Without it, the platform's own places are used, as always.
//
// What it holds: the data folder (state.sqlite, reference.sqlite,
// settings.json, the callsigns folder, each extension's folder) and the logs.
// What it does not: logins, which stay in each computer's own credential
// store (QGD-CRD-0001), so nothing secret is carried on a stick that is easy
// to lose. They are entered again on each computer; a backup carries the
// callsigns and Locations, never a login (QGD-PSN-0007).
//
// Pure, so it is tested without Electron; portable-start.ts applies it.
import { posix, win32 } from 'node:path';

export const PORTABLE_FOLDER = 'qso-graph-data';

export interface Where {
  readonly platform: string;
  readonly execPath: string;
  readonly env: Readonly<Record<string, string | undefined>>;
}

// The folder the application is in, as its user sees it: the AppImage's on
// Linux (an AppImage runs from a mount of its own, so its executable's folder
// is not the one it sits in), the folder a Windows portable build was run
// from, the folder an .app bundle sits in on macOS, and otherwise the
// executable's own folder, as a zip unpacks it.
export function applicationFolder({ platform, execPath, env }: Where): string {
  // The platform's own path rules, so a Windows path is read as Windows reads it.
  const { dirname } = platform === 'win32' ? win32 : posix;
  if (platform === 'linux' && env.APPIMAGE) return dirname(env.APPIMAGE);
  if (platform === 'win32' && env.PORTABLE_EXECUTABLE_DIR) return env.PORTABLE_EXECUTABLE_DIR;
  if (platform === 'darwin') {
    const bundle = execPath.indexOf('.app/');
    if (bundle >= 0) return dirname(execPath.slice(0, bundle + 4));
  }
  return dirname(execPath);
}

export interface Portable {
  readonly folder: string;
  readonly logs: string;
  // Whether it is to be made, being asked for by --portable and not there.
  readonly create: boolean;
}

// Whether to run portable, and from where. A packaged application only: a
// development run names its folders by environment (QG_DESKTOP_USER_DATA_DIR)
// as the suites do, and an explicit one always wins.
export function portableFolder(where: Where & {
  readonly packaged: boolean;
  readonly argv: readonly string[];
  readonly exists: (path: string) => boolean;
}): Portable | undefined {
  if (!where.packaged || where.env.QG_DESKTOP_USER_DATA_DIR) return undefined;
  const { join } = where.platform === 'win32' ? win32 : posix;
  const folder = join(applicationFolder(where), PORTABLE_FOLDER);
  const logs = join(folder, 'logs');
  if (where.exists(folder)) return { folder, logs, create: false };
  if (where.argv.includes('--portable')) return { folder, logs, create: true };
  return undefined;
}
