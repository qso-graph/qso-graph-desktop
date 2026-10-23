// SPDX-License-Identifier: GPL-3.0-only
// Updates (QGD-FRM-0019, docs/RELEASES.md): asked once a day while the switch
// is on and the computer is online, downloaded and checked by the credential
// core, and applied only when the operator restarts or quits. Never forced.
//
// No electron-updater (KI7MT, 2026-10-23): it installs only what it downloaded
// itself, over Electron's networking, and handing it a file the core fetched
// would need a local server, which this product does not have. What it does
// at the end is small and done here: the Windows installer is run silently,
// and an AppImage is replaced, as electron-updater itself does both.
import { app, ipcMain, type BrowserWindow } from 'electron';
import { spawn } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, renameSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { allowsSender, UPDATE_FILE_NAME } from '../callsigns/callsign-contract.js';
import { createLogger } from '../logging/logger.js';
import type { UpdateTrack } from './settings-contract.js';
import {
  UPDATES_CHANNEL, UPDATES_STATE_CHANNEL, choose, isReleaseVersion, readFeed, validateUpdateCommand,
  type UpdatePlatform, type UpdateState
} from './update-contract.js';

const log = createLogger('updates');

// Once a day; looked at hourly, so a computer that sleeps through the moment
// still asks the day it wakes. The first look waits a minute, so starting is
// never slowed by it.
export const CHECK_EVERY_MS = 24 * 60 * 60 * 1000;
const LOOK_EVERY_MS = 60 * 60 * 1000;
const FIRST_LOOK_MS = 60 * 1000;

export interface UpdaterOptions {
  version: string;
  // The feed's key for this build when it installs updates itself, or null:
  // told only that a newer version exists.
  platform: UpdatePlatform | null;
  // Whether this build asks at all: a preview or a development run does not.
  asks: boolean;
  settings: () => { updateCheck: boolean; updateTrack: UpdateTrack };
  online: () => boolean;
  feed: () => Promise<Uint8Array | string>;
  download: (url: string, sum: string, name: string) => Promise<{ path: string } | string>;
  updatesDirectory: string;
  openRelease: (version: string) => void;
  window: () => BrowserWindow | null;
  now?: () => number;
}

export interface Updater {
  state: () => UpdateState;
  check: (why: 'scheduled' | 'asked') => Promise<void>;
  // Called as the application quits, after the stores have closed: a ready
  // update is applied then, and the new version started if the operator
  // chose Restart.
  applyOnQuit: () => void;
  stop: () => void;
}

// The build this is, from how it was installed: an installed Windows build
// has its uninstaller beside it, and an AppImage is told its own path.
export function updatePlatform(): UpdatePlatform | null {
  if (!app.isPackaged) return null;
  if (process.platform === 'win32' && process.arch === 'x64') {
    return existsSync(join(dirname(process.execPath), `Uninstall ${app.getName()}.exe`)) ? 'win-x64' : null;
  }
  if (process.platform === 'linux' && process.env.APPIMAGE) {
    if (process.arch === 'x64') return 'linux-x86_64';
    if (process.arch === 'arm64') return 'linux-arm64';
  }
  return null;
}

export function startUpdater(options: UpdaterOptions): Updater {
  const now = options.now ?? Date.now;
  let state: UpdateState = options.asks ? { kind: 'idle' } : { kind: 'off' };
  let lastAsked = 0;
  let readyFile: string | null = null;
  let newer: string | null = null;
  let running: Promise<void> | null = null;
  let relaunchAfter = false;

  const publish = (next: UpdateState): void => {
    state = next;
    const window = options.window();
    if (window && !window.isDestroyed()) window.webContents.send(UPDATES_STATE_CHANNEL, state);
  };

  // A file main installs only from the core's folder, and only by the name
  // a release gives it.
  const installable = (path: string): boolean => {
    const folder = resolve(options.updatesDirectory) + sep;
    return resolve(path).startsWith(folder) && UPDATE_FILE_NAME.test(basename(path)) && existsSync(path);
  };

  async function run(): Promise<void> {
    const settings = options.settings();
    if (!options.asks || !settings.updateCheck) { publish({ kind: 'off' }); return; }
    // Nothing is tried offline (QGD-FRM-0019); asked again when it is due.
    if (!options.online()) return;
    lastAsked = now();
    publish({ kind: 'checking' });
    const bytes = await options.feed();
    if (typeof bytes === 'string') { publish({ kind: 'failed', reason: bytes, checkedAt: now() }); return; }
    const feed = readFeed(bytes);
    if (!feed) { publish({ kind: 'failed', reason: 'The update feed could not be read.', checkedAt: now() }); return; }
    const offer = choose(feed, settings.updateTrack, options.version);
    if (!offer) { newer = null; publish({ kind: 'current', checkedAt: now() }); return; }
    newer = offer.version;
    log.info({ version: offer.version, track: settings.updateTrack }, 'a newer version is offered');
    const file = options.platform ? offer.files[options.platform] : undefined;
    if (!file) { publish({ kind: 'available', version: offer.version, checkedAt: now() }); return; }
    // Already downloaded and checked this session: nothing to fetch again.
    if (readyFile && basename(readyFile) === file.name) { publish({ kind: 'ready', version: offer.version }); return; }
    publish({ kind: 'downloading', version: offer.version });
    const downloaded = await options.download(file.url, file.sha256, file.name);
    if (typeof downloaded === 'string' || !installable(downloaded.path)) {
      readyFile = null;
      publish({ kind: 'failed', reason: typeof downloaded === 'string' ? downloaded : 'The update could not be saved.', checkedAt: now() });
      return;
    }
    readyFile = downloaded.path;
    log.info({ version: offer.version }, 'an update is ready');
    publish({ kind: 'ready', version: offer.version });
  }

  const check = (why: 'scheduled' | 'asked'): Promise<void> => {
    // One at a time; a second ask waits on the first.
    if (running) return running;
    if (why === 'scheduled' && lastAsked && now() - lastAsked < CHECK_EVERY_MS) return Promise.resolve();
    // A ready update stays ready: nothing to ask until it is applied.
    if (state.kind === 'ready' && why === 'scheduled') return Promise.resolve();
    running = run().catch(() => publish({ kind: 'failed', reason: 'The update check could not be completed.', checkedAt: now() }))
      .finally(() => { running = null; });
    return running;
  };

  // The Windows installer, silently, from the core's folder: the program is
  // that file and nothing else, given fixed arguments (no shell). It waits
  // for this process to close, replaces it, and with --force-run starts the
  // new one. An AppImage is replaced in place; Electron starts the new one.
  const apply = (relaunch: boolean): boolean => {
    if (!readyFile || !installable(readyFile)) return false;
    try {
      if (options.platform === 'win-x64') {
        const child = spawn(readyFile, relaunch ? ['--updated', '/S', '--force-run'] : ['--updated', '/S'],
          { detached: true, stdio: 'ignore', shell: false, windowsHide: true });
        child.unref();
      } else if (options.platform && process.env.APPIMAGE) {
        const target = process.env.APPIMAGE;
        const staged = `${target}.update`;
        copyFileSync(readyFile, staged);
        chmodSync(staged, 0o755);
        renameSync(staged, target);
        rmSync(options.updatesDirectory, { recursive: true, force: true });
        if (relaunch) app.relaunch({ execPath: target, args: [] });
      } else {
        return false;
      }
      log.info({ relaunch }, 'update applied');
      readyFile = null;
      return true;
    } catch {
      log.warn({}, 'the update could not be applied');
      return false;
    }
  };

  ipcMain.handle(UPDATES_CHANNEL, (event, command: unknown): UpdateState | boolean => {
    if (!allowsSender(event.senderFrame, event.sender.mainFrame, event.senderFrame?.url) || !validateUpdateCommand(command)) {
      log.warn({ accepted: false }, 'update request refused');
      return false;
    }
    switch (command.type) {
      case 'state': return state;
      case 'check': void check('asked'); return true;
      // Applied as the application quits, once its stores have closed, so
      // nothing is replaced underneath a write.
      case 'restart':
        if (state.kind !== 'ready' || !readyFile) return false;
        relaunchAfter = true;
        app.quit();
        return true;
      case 'release':
        if (!newer || !isReleaseVersion(newer)) return false;
        options.openRelease(newer);
        return true;
    }
  });

  const first = setTimeout(() => void check('scheduled'), FIRST_LOOK_MS);
  const hourly = setInterval(() => void check('scheduled'), LOOK_EVERY_MS);
  return {
    state: () => state,
    check,
    applyOnQuit: () => { if (state.kind === 'ready' && readyFile) apply(relaunchAfter); },
    stop: () => { clearTimeout(first); clearInterval(hourly); ipcMain.removeHandler(UPDATES_CHANNEL); }
  };
}
