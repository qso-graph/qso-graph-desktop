// SPDX-License-Identifier: GPL-3.0-only
// Updates (QGD-FRM-0019, docs/RELEASES.md): asked once a day while the switch
// is on and the computer is online, downloaded and checked by the credential
// core, and applied only when the operator restarts or quits. Never forced.
//
// No electron-updater (KI7MT, 2026-10-23): it installs only what it downloaded
// itself, over Electron's networking (Squirrel.Mac, on macOS, its own), and
// handing it a file the core fetched would need a local server, which this
// product does not have. What it does at the end is small and done here: the
// Windows installer is run silently, an AppImage is replaced, and on macOS
// the signed zip is unpacked beside the application, checked to be signed by
// the same team, and put in its place.
import { app, ipcMain, type BrowserWindow } from 'electron';
import { spawn, spawnSync } from 'node:child_process';
import { accessSync, chmodSync, constants, copyFileSync, existsSync, readdirSync, renameSync, rmSync } from 'node:fs';
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
  // Whether this build asks at all: a preview or a development run does not,
  // and which it is, so the window can say.
  asks: boolean;
  build?: 'release' | 'development' | 'preview';
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
  // A Mac build replaces its own bundle, so it must be one it can replace:
  // not run from the disk image, not moved aside by Gatekeeper's App
  // Translocation, and in a folder this user can write to. Otherwise it is
  // told a newer version exists.
  if (process.platform === 'darwin' && process.arch === 'arm64') {
    const bundle = macBundle();
    if (!bundle || bundle.startsWith('/Volumes/') || bundle.includes('/AppTranslocation/')) return null;
    try { accessSync(dirname(bundle), constants.W_OK); } catch { return null; }
    return 'mac-arm64';
  }
  return null;
}

// The .app this process runs from: <bundle>/Contents/MacOS/<name>.
function macBundle(): string | null {
  const bundle = resolve(process.execPath, '..', '..', '..');
  return bundle.endsWith('.app') ? bundle : null;
}

// Who signed a bundle, by Apple's own tool at its fixed path. Null when it is
// not validly signed at all. `verify` checks every file in it first, which is
// what a new bundle needs; the running one only needs its team read.
function macTeam(bundle: string, verify: boolean): string | null {
  if (verify) {
    const checked = spawnSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle], { shell: false, timeout: 120_000 });
    if (checked.status !== 0) return null;
  }
  const shown = spawnSync('/usr/bin/codesign', ['-dv', bundle], { shell: false, encoding: 'utf8', timeout: 30_000 });
  const team = /^TeamIdentifier=([A-Z0-9]{10})$/m.exec(`${shown.stderr ?? ''}`)?.[1];
  return team ?? null;
}

// The new bundle unpacked beside the old one, so the swap is two renames on
// one volume; checked to be signed by the team that signed the running one,
// then put in its place. The old bundle is put back if anything fails.
function replaceMacBundle(zip: string): string {
  const bundle = macBundle();
  if (!bundle) throw new Error('not a bundle');
  const team = macTeam(bundle, false);
  if (!team) throw new Error('the running application is not signed');
  const staging = join(dirname(bundle), `.qso-graph-desktop-update-${process.pid}`);
  rmSync(staging, { recursive: true, force: true });
  try {
    const unpacked = spawnSync('/usr/bin/ditto', ['-x', '-k', zip, staging], { shell: false, timeout: 300_000 });
    if (unpacked.status !== 0) throw new Error('the update could not be unpacked');
    const apps = readdirSync(staging).filter(name => name.endsWith('.app'));
    if (apps.length !== 1) throw new Error('the update holds no single application');
    const fresh = join(staging, apps[0]);
    if (macTeam(fresh, true) !== team) throw new Error('the update is not signed by the same team');
    const aside = `${bundle}.old-${process.pid}`;
    renameSync(bundle, aside);
    try {
      renameSync(fresh, bundle);
    } catch (error) {
      renameSync(aside, bundle);
      throw error;
    }
    rmSync(aside, { recursive: true, force: true });
    return bundle;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

export function startUpdater(options: UpdaterOptions): Updater {
  const now = options.now ?? Date.now;
  const notAsking = (): UpdateState => ({ kind: 'off', why: options.build === 'preview' ? 'preview' : options.build === 'development' ? 'development' : 'switch' });
  let state: UpdateState = options.asks ? { kind: 'idle' } : notAsking();
  let lastAsked = 0;
  let readyFile: string | null = null;
  let newer: string | null = null;
  let running: Promise<void> | null = null;
  let relaunchAfter = false;
  // Asked again while a check ran: run once more when it finishes.
  let again = false;

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
    if (!options.asks) { publish(notAsking()); return; }
    if (!options.settings().updateCheck) { publish({ kind: 'off', why: 'switch' }); return; }
    // Nothing is tried offline (QGD-FRM-0019); asked again when it is due.
    if (!options.online()) return;
    lastAsked = now();
    publish({ kind: 'checking' });
    const bytes = await options.feed();
    if (typeof bytes === 'string') { publish({ kind: 'failed', reason: bytes, checkedAt: now() }); return; }
    const feed = readFeed(bytes);
    if (!feed) { publish({ kind: 'failed', reason: 'The update feed could not be read.', checkedAt: now() }); return; }
    // The switch and the track as they are now, not as they were when the
    // feed was asked for (#57: turning checking off while the feed was on its
    // way still downloaded the update).
    const settings = options.settings();
    if (!settings.updateCheck) { publish({ kind: 'off', why: 'switch' }); return; }
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
    // And once more after the download, which can take minutes.
    const after = options.settings();
    if (!after.updateCheck || after.updateTrack !== settings.updateTrack) {
      readyFile = null;
      rmSync(options.updatesDirectory, { recursive: true, force: true });
      publish(after.updateCheck ? { kind: 'idle' } : { kind: 'off', why: 'switch' });
      if (after.updateCheck) again = true;
      return;
    }
    readyFile = downloaded.path;
    log.info({ version: offer.version }, 'an update is ready');
    publish({ kind: 'ready', version: offer.version });
  }

  const check = (why: 'scheduled' | 'asked'): Promise<void> => {
    // One at a time; a second ask while one runs is run again after it, so a
    // change of switch or track made meanwhile is acted on (#57).
    if (running) { if (why === 'asked') again = true; return running; }
    if (why === 'scheduled' && lastAsked && now() - lastAsked < CHECK_EVERY_MS) return Promise.resolve();
    // A ready update stays ready: nothing to ask until it is applied.
    if (state.kind === 'ready' && why === 'scheduled') return Promise.resolve();
    running = run().catch(() => publish({ kind: 'failed', reason: 'The update check could not be completed.', checkedAt: now() }))
      .finally(() => {
        running = null;
        if (again) { again = false; void check('asked'); }
      });
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
      } else if (options.platform === 'mac-arm64') {
        replaceMacBundle(readyFile);
        rmSync(options.updatesDirectory, { recursive: true, force: true });
        // The same path, now the new bundle.
        if (relaunch) app.relaunch();
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
