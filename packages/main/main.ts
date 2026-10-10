// SPDX-License-Identifier: GPL-3.0-only
import { app, BrowserWindow, Menu, nativeTheme, protocol, session } from 'electron';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allowsResource, resourceName } from './policy.js';
import { startPersonaBroker } from './persona-broker.js';
import { createLogger } from '../logging/logger.js';
import { load, startSettingsBroker } from './settings.js';
import { windowBackground } from './window-background.js';
import { startAppearanceBroker } from './system-appearance.js';
import { startLogsBroker } from './logs-broker.js';
import { enginePaths, startEngineBroker } from './engine-broker.js';
import { startAppBroker } from './app-broker.js';
import { FONT_AWESOME_CREDIT } from './attribution.js';

// The compiled tree is dist/<package>/, so this file is dist/main/main.js and
// everything it addresses is a sibling of its own directory (QGD-REP-0001).
// Written once, here, rather than computed at each use.
const distDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const rendererDirectory = join(distDirectory, 'renderer');

// Read from the register rather than written twice. A version in two places is
// a version that will disagree with itself.
function postgresVersion(): string {
  try {
    const file = join(app.getAppPath(), 'data', 'postgres-build.json');
    return (JSON.parse(readFileSync(file, 'utf8')) as { version: string }).version;
  } catch {
    return 'unknown';
  }
}

// Packaged, the build is in Contents/Resources: programs have to be executed
// and an asar is not a filesystem, so it is an extraResource rather than part
// of the application archive. Running from the repository, it is in vendor/
// where make setup put it.
function postgresBin(): string {
  const root = app.isPackaged
    ? join(process.resourcesPath, 'postgres')
    : join(app.getAppPath(), 'vendor', 'postgres');
  return join(root, postgresVersion(), 'bin');
}
const log = createLogger('main');

app.setName('QSO Graph Desktop');
// The About panel carries the attribution CC BY 4.0 requires for the rail's
// icons. NOTICE is the written record; this is the one a user can actually
// reach, which is the point of the obligation.
app.setAboutPanelOptions({
  applicationName: 'QSO Graph Desktop',
  credits: FONT_AWESOME_CREDIT
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
  const window = new BrowserWindow({
    width: 1100,
    height: 740,
    minWidth: 640,
    minHeight: 420,
    title: 'QSO Graph Desktop',
    // Read here rather than fixed: the renderer themes itself a moment later,
    // and this is the frame before that (QGD-FRM-0001).
    backgroundColor: windowBackground(load().theme, nativeTheme.shouldUseDarkColors),
    show: false,
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
  window.once('ready-to-show', () => window.show());
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
    // window below appears whether or not the engine ever comes up.
    const engine = enginePaths();
    const stopEngineBroker = startEngineBroker({
      distDirectory,
      // The pinned, trimmed build (QGD-ENG-0004, QGD-ENG-0004.1).
      binaries: process.env.QG_DESKTOP_POSTGRES_BIN ?? postgresBin(),
      data: engine.data,
      sockets: engine.sockets,
      buildFile: join(app.getAppPath(), 'data', 'postgres-build.json'),
      migrations: join(app.getAppPath(), 'drizzle'),
      // The register ships; what it points at is fetched (QGD-REF-0001).
      registerFile: join(app.getAppPath(), 'data', 'reference-sources.json'),
      // Overridable for the same reason QG_DESKTOP_POSTGRES_BIN is: a suite
      // needs to run the product against an archive that is already there.
      referenceCache: process.env.QG_DESKTOP_REFERENCE_CACHE ?? engine.referenceCache,
      // The engine never opens a connection of its own: it asks the
      // credential core, which is the one process that reaches the network
      // (D-18, D-31).
      fetchReference: personas.fetchReference,
      startAtLaunch: process.env.QG_DESKTOP_ENGINE_OFF !== '1'
    });
    // The app API (QGD-APP-0002). Started after the brokers it reaches
    // through, because its ports are their methods.
    //
    // `apps` is empty until QGD-PRT-0108 and `proofs` is absent from a shipped
    // build, so on a release this loads nothing — which is the correct result,
    // not a failure (QGD-APP-0014.1).
    const appBroker = await startAppBroker({
      // Overridable for the same reason QG_DESKTOP_POSTGRES_BIN is: a suite
      // needs to run the product against manifests of its own. Without it the
      // only way to exercise a refused application was to edit a tracked
      // manifest, and an interrupted run then left that edit behind — where
      // the next run would read it as the original and keep failing.
      directories: process.env.QG_DESKTOP_APP_DIRS
        ? process.env.QG_DESKTOP_APP_DIRS.split(':').filter(Boolean)
        : [join(app.getAppPath(), 'apps'), join(app.getAppPath(), 'proofs')],
      grantRegisterFile: join(app.getAppPath(), 'data', 'app-grants.json'),
      sourceRegisterFile: join(app.getAppPath(), 'data', 'app-sources.json'),
      ports: {
        allowed: () => load().grants,
        personas: async () => {
          const briefs = await personas.personaBriefs();
          if (typeof briefs === 'string') throw new Error(briefs);
          return briefs;
        },
        fetchSource: async url => {
          const fetched = await personas.fetchReference(url);
          if (typeof fetched === 'string') throw new Error(fetched);
          // The core hands back bytes, because reference data includes a zip.
          // A source an application reads is text, decoded here rather than in
          // the core: what the bytes mean is the caller's business.
          return { body: new TextDecoder('utf-8', { fatal: false }).decode(fetched.body), fresh: fetched.fresh };
        },
        callService: async (service, persona, operation, parameters) => {
          const answer = await personas.serviceLookup(service, persona, operation, parameters);
          if (typeof answer === 'string') throw new Error(answer);
          return answer;
        }
      }
    }).catch((error: unknown) => {
      // A register this product ships that cannot be read is worth saying
      // loudly, and is not a reason to refuse to start: an application that
      // does not load leaves the frame working (QGD-APP-0013).
      log.error({ reason: error instanceof Error ? error.message : String(error) },
        'the app API could not start; no application will load');
      return undefined;
    });

    // Stopping the engine is the one thing here that takes time, and it has
    // to finish: a postmaster that outlives the application refuses the next
    // launch (QGD-ENG-0008). So the first quit is held, the engine is stopped,
    // and the quit is asked for again — the second one is let through.
    let quitting = false;
    app.on('before-quit', event => {
      appBroker?.stop();
      stopPersonaBroker(); stopSettingsBroker(); stopAppearanceBroker(); stopLogsBroker();
      if (quitting) return;
      quitting = true;
      event.preventDefault();
      void stopEngineBroker()
        .catch(error => log.warn({ reason: String(error) }, 'the engine did not stop cleanly'))
        .finally(() => app.quit());
    });
    localSession.webRequest.onBeforeRequest((details, callback) => {
      callback({ cancel: !allowsResource(details.url) });
    });
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: 'QSO Graph Desktop', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] },
      { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
      { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'close' }] }
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
