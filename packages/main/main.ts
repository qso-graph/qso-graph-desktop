// SPDX-License-Identifier: GPL-3.0-only
// First, before anything opens a store or a log: portable mode decides
// where they are (portable.ts).
import './portable-start.js';
import { app, BrowserWindow, Menu, nativeTheme, protocol, screen, session } from 'electron';
import { MIN_HEIGHT, MIN_WIDTH, placeWindow } from './window-place.js';
import { nextZoom } from './window-zoom.js';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allowsResource, resourceName } from './policy.js';
import { CALLSIGNS_STARTING, startCallsignBroker } from './callsign-broker.js';
import { untilReady } from './until-ready.js';
import { createLogger } from '../logging/logger.js';
import { load, save, startSettingsBroker } from './settings.js';
import { MAX_PINS } from './settings-contract.js';
import { windowBackground } from './window-background.js';
import { windowVisibility } from './window-visibility.js';
import { startAppearanceBroker } from './system-appearance.js';
import { startLogsBroker } from './logs-broker.js';
import { startStorageBroker, storageRoot } from './storage-broker.js';
import { startHomeBroker } from './home-broker.js';
import { startUpdater, updatePlatform } from './updater.js';
import { startWhatsNewBroker } from './whats-new.js';
import { isOfferedVersion, isReleaseVersion } from './update-contract.js';
import { snapshots } from './snapshots.js';
import { startExtensionBroker } from './extension-broker.js';
import { extensionDirectories } from './extension-directories.js';
import { sourceFixtures } from './source-fixtures.js';
import { startLinksBroker } from './links-broker.js';
import { warnWindowsRuntime, windowsRuntimeMissing } from './windows-runtime.js';
import type { DocumentName } from './links-contract.js';

// A Setup menu item: the window is told which action, by name, and does it.
function setupItem(action: string, label: string): Electron.MenuItemConstructorOptions {
  return {
    id: `setup-${action}`, label,
    click: () => {
      const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
      if (window && !window.isDestroyed()) { window.show(); window.webContents.send('menu:setup', action); }
    }
  };
}

// View → Zoom (window-zoom.ts): the focused window, one step.
function zoomWindow(direction: -1 | 0 | 1, window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]): void {
  if (!window || window.isDestroyed()) return;
  window.webContents.setZoomFactor(nextZoom(window.webContents.getZoomFactor(), direction));
}

// Help's documents, in the menu's order.
const HELP_DOCUMENTS: readonly (readonly [DocumentName, string])[] = [
  ['guide', 'User Guide'], ['privacy', 'Privacy'], ['security', 'Security'], ['license', 'License'],
  ['attributions', 'Attributions'], ['contributors', 'Contributors'], ['contributing', 'Contributing']
];

// The compiled tree is dist/<package>/, so this file is dist/main/main.js and
// everything it addresses is a sibling of its own directory (QGD-REP-0001).
// Written once, here, rather than computed at each use.
const distDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const rendererDirectory = join(distDirectory, 'renderer');

const log = createLogger('main');

app.setName('QSO Graph Desktop');
// About is Settings' About card (KI7MT, 2026-10-24), from Help on every
// platform and from the application menu on macOS. It carries the version,
// the privacy summary, the project's documents and the attribution CC BY 4.0
// requires for the rail's icons (QGD-REP-0005), so Electron's own About panel
// is not used.
if (process.env.QG_DESKTOP_USER_DATA_DIR) app.setPath('userData', process.env.QG_DESKTOP_USER_DATA_DIR);
// An in-process resource scheme: no socket, server or external request.
protocol.registerSchemesAsPrivileged([
  { scheme: 'qg', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }
]);
app.enableSandbox();
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-component-update');
app.commandLine.appendSwitch('disable-domain-reliability');
app.commandLine.appendSwitch('disable-sync');
app.commandLine.appendSwitch('no-pings');
app.commandLine.appendSwitch('disable-features', 'MediaRouter,OptimizationHints,AutofillServerCommunication');

function createWindow(): void {
  // A suite run never puts a window on screen (KI7MT, 2026-10-10).
  const visibility = windowVisibility();
  // Where it was when it last closed, if that is still on a screen
  // (window-place.ts); else the default size, centred.
  const placed = placeWindow(load().windowBounds, screen.getAllDisplays().map(display => display.workArea));
  const window = new BrowserWindow({
    width: placed?.width ?? 1100,
    height: placed?.height ?? 740,
    ...(placed ? { x: placed.x, y: placed.y } : {}),
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    title: 'QSO Graph Desktop',
    // Read here rather than fixed: the renderer themes itself a moment later,
    // and this is the frame before that (QGD-FRM-0001).
    backgroundColor: windowBackground(load().theme, nativeTheme.shouldUseDarkColors),
    show: visibility.show,
    // Stated rather than left to the default: a window that is never shown
    // still has to paint, or `ready-to-show` never fires and a suite has
    // nothing to capture.
    paintWhenInitiallyHidden: visibility.paintWhenInitiallyHidden,
    webPreferences: {
      sandbox: true,
      preload: join(distDirectory, 'preload', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webviewTag: false,
      // QGD-SEC-0009 and QGD-PRC-0006: middle-click can start a navigation of
      // its own. Nothing in this application needs auxclick.
      disableBlinkFeatures: 'Auxclick',
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false
    }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('context-menu', (_event, params) => {
    if (!params.isEditable) return;
    Menu.buildFromTemplate([
      { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }
    ]).popup({ window });
  });
  // Ctrl or ⌘ with the mouse wheel: the same steps as View → Zoom.
  window.webContents.on('zoom-changed', (_event, direction) => zoomWindow(direction === 'in' ? 1 : -1, window));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  // `show: false` above only avoids the white frame at startup; this is what
  // decides whether the window is ever seen.
  // Maximized again only when it is shown: on macOS maximize() shows the
  // window, so a suite's hidden window was put on screen (the 0.1.3 release
  // run, where a CI Mac's small screen made the default size count as
  // maximized when it closed).
  window.once('ready-to-show', () => {
    if (!visibility.reveal) return;
    if (placed?.maximized) window.maximize();
    window.show();
  });
  // Remembered as it closes: the size it has when not maximized, and whether
  // it is, so a maximized window comes back maximized over the right size.
  window.on('close', () => {
    const { x, y, width, height } = window.getNormalBounds();
    save({ ...load(), windowBounds: { x, y, width, height, maximized: window.isMaximized() } });
  });
  void window.loadURL('qg://desktop/index.html').catch(() => {
    // Deliberately exclude exception payloads and paths from diagnostics.
    log.error({}, 'the bundled page could not be loaded');
    console.error('The bundled preview page could not be loaded.');
    app.exit(1);
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window?.isMinimized()) window.restore();
    window?.focus();
  });
  void app.whenReady().then(async () => {
    const localSession = session.defaultSession;
    localSession.setSpellCheckerEnabled(false);
    localSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    localSession.setPermissionCheckHandler(() => false);
    localSession.on('will-download', event => event.preventDefault());
    protocol.handle('qg', async request => {
      const name = resourceName(request.url);
      if (!name || request.method !== 'GET') return new Response(null, { status: 403 });
      try {
        const content = await readFile(join(rendererDirectory, name));
        return new Response(content, { headers: {
          'Content-Type': name === 'index.html' ? 'text/html; charset=utf-8' : name === 'app.js' ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'; style-src 'self'; script-src 'self'; connect-src 'none'; img-src 'none'; font-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
        } });
      } catch {
        return new Response(null, { status: 404 });
      }
    });
    log.info({ electron: process.versions.electron, platform: process.platform }, 'application ready');
    const callsigns = startCallsignBroker(
      distDirectory,
      join(app.getAppPath(), 'data', 'service-profiles.json'));
    const stopCallsignBroker = callsigns.stop;
    const stopSettingsBroker = startSettingsBroker();
    // What's new (QGD-FRM-0016): the notes are the changelog that ships.
    const stopWhatsNew = startWhatsNewBroker(join(app.getAppPath(), 'CHANGELOG.md'), app.getVersion());
    const stopAppearanceBroker = startAppearanceBroker();
    const links = startLinksBroker(join(app.getAppPath(), 'data', 'links.json'));
    const stopLogsBroker = startLogsBroker();
    // QGD-ENG-0003: started in the background and waited on by nothing. The
    // window below appears whether or not storage ever comes up.
    const storage = storageRoot();
    const storageBroker = startStorageBroker({
      distDirectory,
      root: storage.root,
      stateMigrations: join(app.getAppPath(), 'drizzle', 'state'),
      referenceDdl: join(app.getAppPath(), 'drizzle', 'reference'),
      // The register ships; what it points at is fetched (QGD-REF-0001).
      registerFile: join(app.getAppPath(), 'data', 'reference-sources.json'),
      // Overridable so a suite can run the product against sources that are
      // already there, rather than reaching the network on every run.
      referenceCache: process.env.QG_DESKTOP_REFERENCE_CACHE ?? storage.referenceCache,
      appVersion: app.getVersion(),
      // QG Storage never opens a connection of its own: it asks the
      // credential core, the one process that reaches the network (QGD-SEC-0020).
      fetchReference: callsigns.fetchReference,
      area: () => load().area
    });
    // The Locations travel with the callsigns in a backup, and come back in a
    // restore (KI7MT, 2026-10-23); QG Storage holds them.
    callsigns.connectStations({
      backup: () => storageBroker.backupStations(),
      restore: (backup, replace) => storageBroker.restoreStations(backup, replace),
      check: backup => storageBroker.checkStations(backup),
      count: () => storageBroker.stationCount()
    });
        callsigns.onCallsignActivated(id => storageBroker.callsignActivated(id));
    callsigns.onCallsignRemoved(id => storageBroker.callsignRemoved(id));
    // The extension API (QGD-APP-0002). Started after the brokers it reaches
    // through, because its ports are their methods.
    //
    // `apps/` is empty until QGD-PRT-0108, so an ordinary run loads no
    // applications at all. That is the correct result, not a failure: the
    // broker still enforces, and there is nothing yet to enforce against.
    // The suites' recorded responses, never in a packaged application
    // (source-fixtures.ts).
    const recorded = sourceFixtures(app.isPackaged, process.env.QG_DESKTOP_SOURCE_FIXTURES);
    // What each source last said, for this run: handed back while the
    // credential core holds the source to its floor (#79). A handful of small
    // JSON answers, one per registered source.
    const lastSourceBody = new Map<string, string>();
    // The callsign service's answer while it is still starting (until-ready.ts).
    const starting = (answer: unknown): boolean => answer === CALLSIGNS_STARTING;
    // Told when a page's request reached its source or could not connect,
    // for the Internet lamp; Home's broker takes it once it has started.
    let onReached: (ok: boolean) => void = () => undefined;
    const extensionBroker = await startExtensionBroker({
      // The package's own extensions, and in a development run any more
      // directories the environment names; those are never official, and a
      // packaged application never reads them (QGD-APP-0017).
      directories: extensionDirectories(app.isPackaged, app.getAppPath(), process.env.QG_DESKTOP_EXTENSION_DIRS),
      grantRegisterFile: join(app.getAppPath(), 'data', 'extension-grants.json'),
      sourceRegisterFile: join(app.getAppPath(), 'data', 'extension-sources.json'),
      limitsFile: join(app.getAppPath(), 'data', 'extension-limits.json'),
      distDirectory: join(app.getAppPath(), 'dist'),
      readOn: () => load().extensionsOn,
      writeOn: on => save({ ...load(), extensionsOn: [...on] }),
      // Turned on, its destinations are pinned to Home where there is room
      // and they are not already: every extension starts off, so this is how
      // one first appears (KI7MT, 2026-10-23). A tab under another page is
      // reached from its area's pin, so only destinations are pinned.
      onTurnedOn: id => {
        const extension = extensionBroker?.loaded().find(entry => entry.manifest.id === id);
        if (!extension) return;
        const settings = load();
        const wanted = extension.manifest.contributes.pages.filter(page => page.under === undefined).map(page => `${id}/${page.id}`);
        const pins = [...settings.pins, ...wanted.filter(key => !settings.pins.includes(key))].slice(0, MAX_PINS);
        if (pins.length !== settings.pins.length) save({ ...settings, pins });
      },
      ports: {
        allowed: () => load().grants,
        // Every request through the callsign service waits for it at a
        // start, as a source fetch does: Your station said nothing was active
        // at every launch because it asked before the service was up
        // (KI7MT, 2026-10-22). 10 s, inside the 15 s request deadline.
        callsigns: async () => {
          const briefs = await untilReady(() => callsigns.callsignBriefs(), starting, { withinMs: 10_000 });
          if (typeof briefs === 'string') throw new Error(briefs);
          return briefs;
        },
        activeCallsign: async () => {
          const brief = await untilReady(() => callsigns.activeBrief(), starting, { withinMs: 10_000 });
          if (typeof brief === 'string') throw new Error(brief);
          return brief;
        },
        // Name, grid and position only (station-brief.ts, QGD-STN-0003).
        activeStation: async () => storageBroker.activeStation(),
        // ADIF Lookup's search, answered from reference.sqlite (reference:read).
        // A whole enumeration by its name (reference:read, #58).
        adifList: async name => {
          const found = await storageBroker.adifList(name);
          if (typeof found === 'string') throw new Error(found);
          return found;
        },
        adifSearch: async query => {
          const found = await storageBroker.adifSearch(query);
          if (typeof found === 'string') throw new Error(found);
          return found;
        },
        // My Area: the operator's choice, or else the active Location's own
        // POTA location (station:active; KI7MT, 2026-10-23).
        // As locations, whatever level it was chosen at: an entity or a
        // program stands for its locations (KI7MT, 2026-10-23).
        area: async () => storageBroker.areaLocations(),
        // The parks nearest the active Location, from POTA's park list alone
        // (Near Me): it works offline.
        potaNear: async () => {
          const station = storageBroker.activeStation();
          if (!station || station.latitude === undefined || station.longitude === undefined) {
            throw new Error('The active Location has no position. Give it a grid or a latitude and longitude on the Locations page.');
          }
          const found = await storageBroker.parksNear(station.latitude, station.longitude);
          if (typeof found === 'string') throw new Error(found);
          return found;
        },
        // Each POTA location's program and entity, for Program and Entity
        // filters (reference:read).
        potaPlaces: async locations => {
          const found = await storageBroker.potaPlaces(locations);
          if (typeof found === 'string') throw new Error(found);
          return found;
        },
        // My Area's parks with their activations (QGD-REF-0019), read from
        // reference data on this computer: nothing is fetched.
        potaActivations: async () => {
          const found = await storageBroker.parksToActivate();
          if (typeof found === 'string') throw new Error(found);
          return found;
        },
        // ADIF's bands, for naming a frequency's band (reference:read).
        adifBands: async () => {
          const found = await storageBroker.adifBands();
          if (typeof found === 'string') throw new Error(found);
          return found;
        },
        fetchSource: async url => {
          if (recorded) return recorded(url);
          // At a start the credential core may not be up yet: the request
          // waits for it, up to 30 s, rather than failing a page that then
          // waits fifteen minutes to ask again (until-ready.ts).
          const fetched = await untilReady(() => callsigns.fetchReference(url), starting, { withinMs: 30_000 });
          // The Internet lamp learns from this request, which was being made
          // anyway: only "could not be reached" (the core's connection
          // failing, as behind a wifi login page) means the internet did not
          // answer; any answer from the far end, even a refusal, means it did.
          if (typeof fetched === 'string') {
            if (fetched === 'The reference source could not be reached.') onReached(false);
            else if (fetched.startsWith('The reference source')) onReached(true);
            throw new Error(fetched);
          }
          // Resting (#79): nothing was sent, so the lamp learns nothing, and
          // the page is given what this source last said rather than nothing.
          if (typeof fetched.restingUntil === 'number') {
            const kept = lastSourceBody.get(url);
            if (kept !== undefined) return { body: kept, fresh: false };
            const at = new Date(fetched.restingUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            throw new Error(`This source is resting until ${at}, so as not to ask it too often.`);
          }
          onReached(true);
          // The core hands back bytes, because reference data includes a zip.
          // A source an application reads is text, decoded here rather than in
          // the core: what the bytes mean is the caller's business.
          const body = new TextDecoder('utf-8', { fatal: false }).decode(fetched.body);
          if (fetched.fresh) lastSourceBody.set(url, body);
          return { body: fetched.fresh ? body : (lastSourceBody.get(url) ?? body), fresh: fetched.fresh };
        },
        callService: async (service, callsign, operation, parameters) => {
          const answer = await untilReady(() => callsigns.serviceLookup(service, callsign, operation, parameters),
            starting, { withinMs: 10_000 });
          if (typeof answer === 'string') throw new Error(answer);
          return answer;
        }
      }
    }).catch((error: unknown) => {
      // A register this product ships that cannot be read is worth saying
      // loudly, and is not a reason to refuse to start: an application that
      // does not load leaves the core working (QGD-APP-0013).
      log.error({ reason: error instanceof Error ? error.message : String(error) },
        'the extension API could not start; no extension will load');
      return undefined;
    });

    // Home's pages (QGD-HOM-*): asked of extensions through the extension
    // host, only while Home shows. Nothing if the extension API did not start.
    const homeBroker = extensionBroker ? startHomeBroker({
      loaded: () => extensionBroker.loaded(),
      supervisor: extensionBroker.supervisor,
      enablement: extensionBroker.enablement,
      // A change of station is a new question for the pages, as a change of
      // callsign is (QGD-STN-0005, QGD-HOM-0005).
      onCallsignsChanged: listener => {
        callsigns.onCallsignsChanged(listener);
        storageBroker.onActiveStationChanged(listener);
      }
    }) : undefined;
    if (homeBroker) onReached = homeBroker.reached;

    // Updates (QGD-FRM-0019): asked once a day through the credential core,
    // applied as the application quits. A development run or a pull
    // request's build never asks: its version is neither a release nor a
    // Preview. Nor does a copy from the Microsoft
    // Store, which the Store updates, and whose rules forbid an app updating
    // itself (KI7MT, 2026-10-24).
    const fromStore = process.windowsStore === true;
    const updater = startUpdater({
      version: app.getVersion(),
      platform: fromStore ? null : updatePlatform(),
      // A Preview asks as a release does (#77), so it can be left for one.
      asks: app.isPackaged && isOfferedVersion(app.getVersion()) && !fromStore,
      build: fromStore ? 'store' : !app.isPackaged ? 'development' : isReleaseVersion(app.getVersion()) ? 'release' : 'preview',
      settings: () => load(),
      online: () => homeBroker?.online() ?? true,
      feed: callsigns.updateFeed,
      download: callsigns.downloadUpdate,
      updatesDirectory: callsigns.updatesDirectory,
      snapshots: snapshots({ root: app.getPath('userData'), callsigns: dirname(callsigns.updatesDirectory) }),
      openRelease: version => links.open({ type: 'release', version }),
      window: () => BrowserWindow.getAllWindows()[0] ?? null
    });
    // After the stores have closed, so nothing is replaced under a write.
    app.on('will-quit', () => updater.applyOnQuit());

    // Closing the stores is the one thing here worth waiting for: a clean
    // close checkpoints the WAL, so the next start has nothing to replay. So
    // the first quit is held while QG Storage closes, and the quit is asked
    // for again; the second one is let through.
    let quitting = false;
    app.on('before-quit', event => {
      homeBroker?.stop();
      extensionBroker?.stop();
      updater.stop();
      stopCallsignBroker(); stopSettingsBroker(); stopWhatsNew(); stopAppearanceBroker(); links.stop(); stopLogsBroker();
      if (quitting) return;
      quitting = true;
      event.preventDefault();
      void storageBroker.stop()
        .catch(() => log.warn({}, 'storage did not close cleanly'))
        .finally(() => app.quit());
    });
    localSession.webRequest.onBeforeRequest((details, callback) => {
      callback({ cancel: !allowsResource(details.url) });
    });
    // The menu bar (KI7MT, 2026-10-23): the application's own menu on macOS,
    // which Apple requires, and File with Exit elsewhere, where Hide, Hide
    // Others and Show All do nothing; no Window menu, whose Minimize and Close
    // the title bar already has; Tools for what the operator does with their
    // data, such as moving callsigns to another computer. Where each platform
    // keeps a thing, it is kept there (KI7MT, 2026-10-24): on macOS, Settings
    // (⌘,) and Check for Updates are in the application menu; elsewhere,
    // Settings is in Setup and Check for Updates in Help.
    const mac = process.platform === 'darwin';
    // Check for Updates…: Settings' Updates card, checking now. A build that
    // does not check says why there.
    const checkForUpdates: Electron.MenuItemConstructorOptions = {
      ...setupItem('updates', 'Check for Updates…'),
      click: () => {
        void updater.check('asked');
        const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
        if (window && !window.isDestroyed()) { window.show(); window.webContents.send('menu:setup', 'updates'); }
      }
    };
    const settingsItem: Electron.MenuItemConstructorOptions = { ...setupItem('settings', 'Settings…'), accelerator: 'CmdOrCtrl+,' };
    // Built again when an extension is turned on or off, so POTA Focus
    // Area… is there only while Parks On the Air is on (KI7MT, 2026-10-24).
    const applicationMenu = (): Menu => Menu.buildFromTemplate([
      mac
        ? { label: 'QSO Graph Desktop', submenu: [
          setupItem('about', 'About QSO Graph Desktop'), checkForUpdates, { type: 'separator' },
          settingsItem, { type: 'separator' },
          { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }
        ] }
        : { label: 'File', submenu: [{ role: 'quit', label: 'Exit' }] },
      { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
      // View (KI7MT, 2026-10-24): larger or smaller, within limits
      // (window-zoom.ts), and full screen. Ctrl or ⌘ with = or + zooms in;
      // the + of a US keyboard needs Shift, which the hidden item catches.
      { label: 'View', submenu: [
        { id: 'zoom-in', label: 'Zoom In', accelerator: 'CmdOrCtrl+=', click: () => zoomWindow(1) },
        { id: 'zoom-in-plus', label: 'Zoom In', accelerator: 'CmdOrCtrl+Plus', visible: false, acceleratorWorksWhenHidden: true, click: () => zoomWindow(1) },
        { id: 'zoom-out', label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: () => zoomWindow(-1) },
        { id: 'zoom-reset', label: 'Actual Size', accelerator: 'CmdOrCtrl+0', click: () => zoomWindow(0) },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ] },
      // Setup (KI7MT, 2026-10-22): everything Home's welcome offers, from the
      // menu as well. The window does each; this only says which, by a name
      // from a fixed list (preload.cts, SETUP_ACTIONS). IOTA is shown and
      // greyed out until its reference data exists.
      { label: 'Setup', submenu: [
        setupItem('callsigns', 'Callsigns…'),
        setupItem('locations', 'Locations…'),
        ...(extensionBroker?.enablement.isOn('pota') ? [setupItem('area', 'POTA Focus Area…')] : []),
        { type: 'separator' },
        { label: 'Reference Data', submenu: [
          setupItem('adif', 'ADIF Definitions'),
          setupItem('pota', 'POTA Parks'),
          setupItem('sota', 'SOTA Summits'),
          { id: 'setup-iota', label: 'IOTA Islands (coming)', enabled: false }
        ] },
        { type: 'separator' },
        setupItem('pins', 'Customize Your Pins…'),
        ...(mac ? [] : [settingsItem])
      ] },
      { label: 'Tools', submenu: [
        setupItem('export-callsigns', 'Back Up…'),
        setupItem('import-callsigns', 'Restore…')
      ] },
      // Help, as every desktop application has (KI7MT, 2026-10-22): the way
      // to Troubleshooting from the menu, beside the status bar's button
      // (QGD-LOG-0013). The window opens the panel; this only says so.
      // Above it, the project's documents, opened in the browser from the
      // repository, which is the one place each is kept (QGD-FRM-0015,
      // KI7MT 2026-10-22). No ellipsis: nothing more is asked.
      { role: 'help', submenu: [
        // About and What's New first, in a section of their own (KI7MT,
        // 2026-10-24): About is Settings' About card; on macOS it is in the
        // application menu alone, where Apple puts it. What's New is the
        // notes for this version, from the changelog (QGD-FRM-0016).
        ...(mac ? [] : [setupItem('about', 'About QSO Graph Desktop')]),
        setupItem('whats-new', 'What\'s New'),
        ...(mac ? [] : [checkForUpdates]),
        { type: 'separator' },
        ...HELP_DOCUMENTS.map(([name, label]) => ({
          id: name, label, click: () => links.open({ type: 'document', name })
        })),
        { type: 'separator' },
        // Troubleshooting below the separator (KI7MT, 2026-10-22).
        {
          id: 'troubleshooting',
          label: 'Troubleshooting…',
          click: () => {
            const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
            if (window && !window.isDestroyed()) { window.show(); window.webContents.send('menu:troubleshooting'); }
          }
        },
        // The redacted diagnostics archive, saved where the operator
        // chooses, to post themselves (KI7MT, 2026-10-24: nothing is sent
        // for them, which would invite abuse). Troubleshooting's own export.
        setupItem('diagnostics', 'Save Diagnostics for Support…')
      ] }
    ]);
    Menu.setApplicationMenu(applicationMenu());
    extensionBroker?.enablement.onChange(() => Menu.setApplicationMenu(applicationMenu()));
    createWindow();
    // Without Microsoft's Visual C++ runtime the credential core cannot start
    // on Windows (#91): said once, plainly, with Microsoft's page.
    if (windowsRuntimeMissing(process.platform, process.env.SystemRoot, fromStore)) {
      log.warn({}, "Microsoft's Visual C++ runtime is missing; the credential core cannot start");
      void warnWindowsRuntime(BrowserWindow.getAllWindows()[0], () => links.open({ type: 'site', name: 'vcruntime' }));
    }
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
