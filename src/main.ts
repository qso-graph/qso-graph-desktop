// SPDX-License-Identifier: GPL-3.0-only
import { app, BrowserWindow, Menu, protocol, session } from 'electron';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allowsResource, resourceName } from './policy.js';
import { startPersonaBroker } from './persona-broker.js';
import { createLogger } from './logger.js';
import { startSettingsBroker } from './settings.js';

const rendererDirectory = join(dirname(fileURLToPath(import.meta.url)), 'renderer');
const log = createLogger('main');

app.setName('QG Desktop');
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
    title: 'QG Desktop',
    backgroundColor: '#f6f7f9',
    show: false,
    webPreferences: {
      sandbox: true,
      preload: join(dirname(fileURLToPath(import.meta.url)), 'preload.cjs'),
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
  void app.whenReady().then(() => {
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
    const stopPersonaBroker = startPersonaBroker(dirname(fileURLToPath(import.meta.url)));
    const stopSettingsBroker = startSettingsBroker();
    app.once('before-quit', () => { stopPersonaBroker(); stopSettingsBroker(); });
    localSession.webRequest.onBeforeRequest((details, callback) => {
      callback({ cancel: !allowsResource(details.url) });
    });
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: 'QG Desktop', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] },
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
