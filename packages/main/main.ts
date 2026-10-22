// SPDX-License-Identifier: GPL-3.0-only
import { app, BrowserWindow, Menu, nativeTheme, protocol, session } from 'electron';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allowsResource, resourceName } from './policy.js';
import { PERSONA_STARTING, startPersonaBroker } from './persona-broker.js';
import { untilReady } from './until-ready.js';
import { createLogger } from '../logging/logger.js';
import { load, save, startSettingsBroker } from './settings.js';
import { windowBackground } from './window-background.js';
import { windowVisibility } from './window-visibility.js';
import { startAppearanceBroker } from './system-appearance.js';
import { startLogsBroker } from './logs-broker.js';
import { startStorageBroker, storageRoot } from './storage-broker.js';
import { startHomeBroker } from './home-broker.js';
import { startExtensionBroker } from './extension-broker.js';
import { extensionDirectories } from './extension-directories.js';
import { sourceFixtures } from './source-fixtures.js';
import { FONT_AWESOME_CREDIT } from './attribution.js';

// The compiled tree is dist/<package>/, so this file is dist/main/main.js and
// everything it addresses is a sibling of its own directory (QGD-REP-0001).
// Written once, here, rather than computed at each use.
const distDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const rendererDirectory = join(distDirectory, 'renderer');

const log = createLogger('main');

app.setName('QSO Graph Desktop');
// The About panel carries the attribution CC BY 4.0 requires for the rail's
// icons. NOTICE is the written record; this is the one a user can actually
// reach, which is the point of the obligation.
//
// Each platform shows different fields (KI7MT, 2026-10-22: on Linux it said
// the name alone, under a broken icon). macOS and Windows show the credits;
// Linux does not, so there the attribution goes in the copyright, which it
// does show. Linux and Windows draw the icon only from a file path: the
// packaged icon is beside the archive (extraResources), not inside it.
app.setAboutPanelOptions({
  applicationName: 'QSO Graph Desktop',
  applicationVersion: app.getVersion(),
  copyright: process.platform === 'linux'
    ? `QSO Graph contributors. GPL-3.0-or-later.\n${FONT_AWESOME_CREDIT}`
    : 'QSO Graph contributors. GPL-3.0-or-later.',
  credits: FONT_AWESOME_CREDIT,
  authors: ['QSO Graph contributors'],
  iconPath: app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(app.getAppPath(), 'build', 'icon.png')
});
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
  const window = new BrowserWindow({
    width: 1100,
    height: 740,
    minWidth: 640,
    minHeight: 420,
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
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  // `show: false` above only avoids the white frame at startup; this is what
  // decides whether the window is ever seen.
  window.once('ready-to-show', () => { if (visibility.reveal) window.show(); });
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
    const personas = startPersonaBroker(
      distDirectory,
      join(app.getAppPath(), 'data', 'service-profiles.json'));
    const stopPersonaBroker = personas.stop;
    const stopSettingsBroker = startSettingsBroker();
    const stopAppearanceBroker = startAppearanceBroker();
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
      fetchReference: personas.fetchReference
    });
    personas.onPersonaActivated(name => storageBroker.personaActivated(name));
    // The extension API (QGD-APP-0002). Started after the brokers it reaches
    // through, because its ports are their methods.
    //
    // `apps/` is empty until QGD-PRT-0108, so an ordinary run loads no
    // applications at all. That is the correct result, not a failure: the
    // broker still enforces, and there is nothing yet to enforce against.
    // The suites' recorded responses, never in a packaged application
    // (source-fixtures.ts).
    const recorded = sourceFixtures(app.isPackaged, process.env.QG_DESKTOP_SOURCE_FIXTURES);
    // The persona service's answer while it is still starting (until-ready.ts).
    const starting = (answer: unknown): boolean => answer === PERSONA_STARTING;
    const extensionBroker = await startExtensionBroker({
      // The package's own extensions, and in a development run any more
      // directories the environment names; those are never official, and a
      // packaged application never reads them (QGD-APP-0017).
      directories: extensionDirectories(app.isPackaged, app.getAppPath(), process.env.QG_DESKTOP_EXTENSION_DIRS),
      grantRegisterFile: join(app.getAppPath(), 'data', 'extension-grants.json'),
      sourceRegisterFile: join(app.getAppPath(), 'data', 'extension-sources.json'),
      limitsFile: join(app.getAppPath(), 'data', 'extension-limits.json'),
      distDirectory: join(app.getAppPath(), 'dist'),
      readOff: () => load().extensionsOff,
      writeOff: off => save({ ...load(), extensionsOff: [...off] }),
      ports: {
        allowed: () => load().grants,
        // Every request through the persona service waits for it at a start,
        // as a source fetch does: Your station said "No persona is active
        // yet" at every launch because it asked before the service was up
        // (KI7MT, 2026-10-22). 10 s, inside the 15 s request deadline.
        personas: async () => {
          const briefs = await untilReady(() => personas.personaBriefs(), starting, { withinMs: 10_000 });
          if (typeof briefs === 'string') throw new Error(briefs);
          return briefs;
        },
        activePersona: async () => {
          const brief = await untilReady(() => personas.activeBrief(), starting, { withinMs: 10_000 });
          if (typeof brief === 'string') throw new Error(brief);
          return brief;
        },
        // Name, grid and position only (station-brief.ts, QGD-STN-0003).
        activeStation: async () => storageBroker.activeStation(),
        fetchSource: async url => {
          if (recorded) return recorded(url);
          // At a start the credential core may not be up yet: the request
          // waits for it, up to 30 s, rather than failing a card that then
          // waits fifteen minutes to ask again (until-ready.ts).
          const fetched = await untilReady(() => personas.fetchReference(url), starting, { withinMs: 30_000 });
          if (typeof fetched === 'string') throw new Error(fetched);
          // The core hands back bytes, because reference data includes a zip.
          // A source an application reads is text, decoded here rather than in
          // the core: what the bytes mean is the caller's business.
          return { body: new TextDecoder('utf-8', { fatal: false }).decode(fetched.body), fresh: fetched.fresh };
        },
        callService: async (service, persona, operation, parameters) => {
          const answer = await untilReady(() => personas.serviceLookup(service, persona, operation, parameters),
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

    // Home's cards (QGD-HOM-*): asked of extensions through the extension
    // host, only while Home shows. Nothing if the extension API did not start.
    const homeBroker = extensionBroker ? startHomeBroker({
      loaded: () => extensionBroker.loaded(),
      supervisor: extensionBroker.supervisor,
      enablement: extensionBroker.enablement,
      // A change of station is a new question for the cards, as a change of
      // persona is (QGD-STN-0005, QGD-HOM-0005).
      onPersonasChanged: listener => {
        personas.onPersonasChanged(listener);
        storageBroker.onActiveStationChanged(listener);
      }
    }) : undefined;

    // Closing the stores is the one thing here worth waiting for: a clean
    // close checkpoints the WAL, so the next start has nothing to replay. So
    // the first quit is held while QG Storage closes, and the quit is asked
    // for again; the second one is let through.
    let quitting = false;
    app.on('before-quit', event => {
      homeBroker?.stop();
      extensionBroker?.stop();
      stopPersonaBroker(); stopSettingsBroker(); stopAppearanceBroker(); stopLogsBroker();
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
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: 'QSO Graph Desktop', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] },
      { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
      { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'close' }] },
      // Help, as every desktop application has (KI7MT, 2026-10-22): the way
      // to Troubleshooting from the menu, beside the status bar's button
      // (QGD-LOG-0013). The window opens the panel; this only says so.
      // Privacy and Licences beside it (QGD-FRM-0015, KI7MT 2026-10-22).
      { role: 'help', submenu: [{
        id: 'troubleshooting',
        label: 'Troubleshooting…',
        click: () => {
          const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
          if (window && !window.isDestroyed()) { window.show(); window.webContents.send('menu:troubleshooting'); }
        }
      }, {
        id: 'privacy',
        label: 'Privacy and Licences…',
        click: () => {
          const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
          if (window && !window.isDestroyed()) { window.show(); window.webContents.send('menu:privacy'); }
        }
      }] }
    ]));
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
