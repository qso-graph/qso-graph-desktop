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
import { app, dialog, ipcMain, type BrowserWindow } from 'electron';
import { spawn, spawnSync } from 'node:child_process';
import { accessSync, chmodSync, constants, copyFileSync, existsSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { allowsSender, UPDATE_FILE_NAME } from '../callsigns/callsign-contract.js';
import { createLogger } from '../logging/logger.js';
import { signedLikeThisCopy } from './windows-signature.js';
import type { UpdateTrack } from './settings-contract.js';
import {
  UPDATES_CHANNEL, UPDATES_STATE_CHANNEL, choose, compareVersions, isReleaseVersion, readFeed, validateUpdateCommand, versionChoices,
  type Feed, type FeedEntry, type UpdatePlatform, type UpdateState, type VersionChoice
} from './update-contract.js';
import type { Snapshots } from './snapshots.js';

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
  build?: 'release' | 'development' | 'preview' | 'store';
  settings: () => { updateCheck: boolean; updateTrack: UpdateTrack };
  online: () => boolean;
  feed: () => Promise<Uint8Array | string>;
  download: (url: string, sum: string, name: string) => Promise<{ path: string } | string>;
  updatesDirectory: string;
  openRelease: (version: string) => void;
  window: () => BrowserWindow | null;
  now?: () => number;
  // Whether a downloaded Windows installer is signed by the same publisher
  // as this running copy (windows-signature.ts; #81). Given here so the
  // updater is tested without Windows.
  windowsTrusted?: (installer: string) => boolean;
  // What Restart says before the application closes, and whether the operator said OK (#114). Given
  // here so the updater is tested without a window.
  confirm?: (notice: RestartNotice) => Promise<boolean>;
  // The profile kept before an install and put back when going back (#77,
  // snapshots.ts). Without it nothing is installed: going back without the
  // data is not safe.
  snapshots: Snapshots;
}

// What Restart to update (or to go back) says first, and waits for OK on (KI7MT, 2026-10-27: "a
// Dialog w/OK, that's a positive ack rather than another flash on a screen"). Without it the window
// closed and, on Windows, nothing was on screen for the minute the installer ran (#114).
export interface RestartNotice { message: string; detail: string }

export function restartNotice(platform: UpdatePlatform | null, version: string, back: boolean, restored: boolean): RestartNotice {
  const message = back ? `Going back to version ${version}` : `Installing version ${version}`;
  const timing = platform === 'win-x64'
    ? 'QSO Graph Desktop closes, installs it and reopens by itself. That takes about a minute, and nothing is on screen while it installs.'
    : 'QSO Graph Desktop closes and reopens by itself in a few seconds.';
  const data = !back ? '' : restored
    ? ' Your data is put back as it was when you left that version.'
    : ' It opens today\'s data.';
  return { message, detail: `${timing}${data}` };
}

async function askOk(window: BrowserWindow | null, notice: RestartNotice): Promise<boolean> {
  const options = { type: 'info' as const, buttons: ['OK', 'Cancel'], defaultId: 0, cancelId: 1, noLink: true, message: notice.message, detail: notice.detail };
  const answer = window && !window.isDestroyed() ? await dialog.showMessageBox(window, options) : await dialog.showMessageBox(options);
  return answer.response === 0;
}

export interface Updater {
  state: () => UpdateState;
  check: (why: 'scheduled' | 'asked' | 'install', version?: string) => Promise<void>;
  versions: () => VersionChoice[];
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
  const windowsTrusted = options.windowsTrusted ?? signedLikeThisCopy;
  const notAsking = (): UpdateState => ({ kind: 'off', why: options.build === 'preview' || options.build === 'development' || options.build === 'store' ? options.build : 'switch' });
  let state: UpdateState = options.asks ? { kind: 'idle' } : notAsking();
  let lastAsked = 0;
  let readyFile: string | null = null;
  let newer: string | null = null;
  // The feed as the last check read it, for Choose a version… (#77).
  let lastFeed: Feed | null = null;
  let running: Promise<void> | null = null;
  let relaunchAfter = false;
  // Asked again while a check ran: run once more when it finishes.
  let again = false;

  const publish = (next: UpdateState): void => {
    const stable = lastFeed?.stable?.version;
    state = stable && compareVersions(stable, options.version) > 0 ? { ...next, stable } : next;
    const window = options.window();
    if (window && !window.isDestroyed()) window.webContents.send(UPDATES_STATE_CHANNEL, state);
  };

  // A file main installs only from the core's folder, and only by the name
  // a release gives it.
  const installable = (path: string): boolean => {
    const folder = resolve(options.updatesDirectory) + sep;
    return resolve(path).startsWith(folder) && UPDATE_FILE_NAME.test(basename(path)) && existsSync(path);
  };

  // Checking only checks (KI7MT, 2026-10-24): a scheduled or asked check stops at 'available'. The
  // download, its checks and 'ready' happen only when the operator chooses Download and install,
  // which asks the feed again, so what is installed is what the feed offers now.
  async function run(fetch: boolean, chosen?: string): Promise<void> {
    if (!options.asks) { publish(notAsking()); return; }
    if (!options.settings().updateCheck) { publish({ kind: 'off', why: 'switch' }); return; }
    // Nothing is tried offline (QGD-FRM-0019); asked again when it is due.
    // Switched back on while offline, it is no longer off (#57, found by
    // Turing: the card went on saying checking was off).
    if (!options.online()) { if (state.kind === 'off') publish({ kind: 'idle' }); return; }
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
    lastFeed = feed;
    // A version chosen from the list (#77): only one the list offers now, for
    // this track, forward or back, and never the one running.
    let offer: FeedEntry | null;
    if (chosen !== undefined) {
      const choice = versionChoices(feed, settings.updateTrack, options.version, options.snapshots.list())
        .find(entry => entry.version === chosen && entry.way !== 'running');
      offer = choice ? feed.releases.find(entry => entry.version === choice.version) ?? null : null;
      if (!offer) { publish({ kind: 'failed', reason: `Version ${chosen} is not offered now.`, checkedAt: now() }); return; }
    } else {
      offer = choose(feed, settings.updateTrack, options.version);
      if (!offer) { newer = null; publish({ kind: 'current', checkedAt: now() }); return; }
    }
    newer = offer.version;
    const back = compareVersions(offer.version, options.version) < 0;
    log.info({ version: offer.version, track: settings.updateTrack, back }, chosen ? 'a version is chosen' : 'a newer version is offered');
    const file = options.platform ? offer.files[options.platform] : undefined;
    if (!file) { publish({ kind: 'available', version: offer.version, checkedAt: now(), installable: false }); return; }
    // Already downloaded and checked this session: nothing to fetch again.
    if (readyFile && basename(readyFile) === file.name) { publish({ kind: 'ready', version: offer.version, back }); return; }
    if (!fetch) { publish({ kind: 'available', version: offer.version, checkedAt: now(), installable: true }); return; }
    publish({ kind: 'downloading', version: offer.version, back });
    const downloaded = await options.download(file.url, file.sha256, file.name);
    if (typeof downloaded === 'string' || !installable(downloaded.path)) {
      readyFile = null;
      publish({ kind: 'failed', reason: typeof downloaded === 'string' ? downloaded : 'The update could not be saved.', checkedAt: now() });
      return;
    }
    // A Windows installer is kept only when it is signed by the publisher
    // that signed this copy (#81), as macOS requires the same team. One that
    // is not is removed, and the operator told, never run.
    if (options.platform === 'win-x64' && !windowsTrusted(downloaded.path)) {
      readyFile = null;
      rmSync(options.updatesDirectory, { recursive: true, force: true });
      log.warn({ version: offer.version }, 'the downloaded installer is not signed by this copy\'s publisher');
      publish({ kind: 'failed', reason: 'The update is not signed by the same publisher as this copy of QSO Graph Desktop, so it was not kept.', checkedAt: now() });
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
    log.info({ version: offer.version, back }, 'an update is ready');
    publish({ kind: 'ready', version: offer.version, back });
  }

  // An install asked for while a check ran: done when that check finishes.
  let installAfter = false;
  let installVersion: string | undefined;
  const check = (why: 'scheduled' | 'asked' | 'install', version?: string): Promise<void> => {
    // One at a time; a second ask while one runs is run again after it, so a
    // change of switch or track made meanwhile is acted on (#57).
    if (running) {
      if (why === 'asked') again = true;
      if (why === 'install') { installAfter = true; installVersion = version; }
      return running;
    }
    if (why === 'scheduled' && lastAsked && now() - lastAsked < CHECK_EVERY_MS) return Promise.resolve();
    // A ready update stays ready: nothing to ask until it is applied.
    if (state.kind === 'ready' && why === 'scheduled') return Promise.resolve();
    running = run(why === 'install', why === 'install' ? version : undefined).catch(() => publish({ kind: 'failed', reason: 'The update check could not be completed.', checkedAt: now() }))
      .finally(() => {
        running = null;
        if (installAfter) { installAfter = false; again = false; void check('install', installVersion); }
        else if (again) { again = false; void check('asked'); }
      });
    return running;
  };

  // The Windows installer, silently, from the core's folder: the program is
  // that file and nothing else, given fixed arguments (no shell). It waits
  // for this process to close, replaces it, and with --force-run starts the
  // new one. An AppImage is replaced in place; Electron starts the new one.
  const apply = (relaunch: boolean): boolean => {
    if (!readyFile || !installable(readyFile)) return false;
    // The profile as it is now, kept under the version being left, before
    // anything is installed (#77). Not kept, nothing is installed.
    if (!options.snapshots.take(options.version)) {
      log.warn({}, 'the profile could not be kept; the update was not applied');
      return false;
    }
    // Going back: the data kept when that version was left, put back before
    // it opens anything. Where none is kept, it opens today's, as the
    // operator was told before choosing it.
    const restored = state.kind === 'ready' && state.back === true && options.snapshots.restore(state.version);
    if (state.kind === 'ready' && state.back) log.info({ version: state.version, restored }, 'going back');
    const applied = install(readyFile, relaunch);
    // Not installed after all: this version's own data back where it was.
    if (!applied && restored) options.snapshots.restore(options.version);
    if (applied) readyFile = null;
    return applied;
  };

  // The file installed, by the platform's own means.
  const install = (file: string, relaunch: boolean): boolean => {
    try {
      if (options.platform === 'win-x64') {
        // Asked again just before it runs: the file sat in the profile
        // folder since it was downloaded.
        if (!windowsTrusted(file)) {
          log.warn({}, 'the installer is not signed by this copy\'s publisher; not run');
          return false;
        }
        const child = spawn(file, relaunch ? ['--updated', '/S', '--force-run'] : ['--updated', '/S'],
          { detached: true, stdio: 'ignore', shell: false, windowsHide: true });
        child.unref();
      } else if (options.platform === 'mac-arm64') {
        replaceMacBundle(file);
        rmSync(options.updatesDirectory, { recursive: true, force: true });
        // The same path, now the new bundle.
        if (relaunch) app.relaunch();
      } else if (options.platform && process.env.APPIMAGE) {
        const target = process.env.APPIMAGE;
        const staged = `${target}.update`;
        copyFileSync(file, staged);
        chmodSync(staged, 0o755);
        renameSync(staged, target);
        rmSync(options.updatesDirectory, { recursive: true, force: true });
        if (relaunch) app.relaunch({ execPath: target, args: [] });
      } else {
        return false;
      }
      log.info({ relaunch }, 'update applied');
      return true;
    } catch {
      log.warn({}, 'the update could not be applied');
      return false;
    }
  };

  const versions = (): VersionChoice[] => lastFeed
    ? versionChoices(lastFeed, options.settings().updateTrack, options.version, options.snapshots.list())
    : [];

  const confirm = options.confirm ?? (notice => askOk(options.window(), notice));

  ipcMain.handle(UPDATES_CHANNEL, async (event, command: unknown): Promise<UpdateState | VersionChoice[] | boolean> => {
    if (!allowsSender(event.senderFrame, event.sender.mainFrame, event.senderFrame?.url) || !validateUpdateCommand(command)) {
      log.warn({ accepted: false }, 'update request refused');
      return false;
    }
    switch (command.type) {
      case 'state': return state;
      case 'check': void check('asked'); return true;
      // Only an offer this build can install, and only when the operator asks.
      case 'install':
        // A version from the list: whenever nothing is under way.
        if ('version' in command) {
          if (running || state.kind === 'downloading' || state.kind === 'off' || !options.platform) return false;
          void check('install', command.version);
          return true;
        }
        if (state.kind !== 'available' || !state.installable) return false;
        void check('install');
        return true;
      case 'versions': return versions();
      // Applied as the application quits, once its stores have closed, so
      // nothing is replaced underneath a write.
      // Said first, and only on OK (#114). Cancel leaves it ready: it applies when the application quits.
      case 'restart': {
        if (state.kind !== 'ready' || !readyFile) return false;
        const back = state.back === true;
        const notice = restartNotice(options.platform, state.version, back, back && options.snapshots.list().includes(state.version));
        if (!(await confirm(notice))) return false;
        if (state.kind !== 'ready' || !readyFile) return false;
        relaunchAfter = true;
        app.quit();
        return true;
      }
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
    versions,
    applyOnQuit: () => { if (state.kind === 'ready' && readyFile) apply(relaunchAfter); },
    stop: () => { clearTimeout(first); clearInterval(hourly); ipcMain.removeHandler(UPDATES_CHANNEL); }
  };
}
