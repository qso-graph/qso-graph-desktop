// SPDX-License-Identifier: GPL-3.0-only
// A window for scripts/story-themes.mjs to load the built gallery into.
//
// Development only, and never packaged: electron-builder ships dist/,
// package.json and LICENSE, and this is in scripts/.
//
// It exists so the gallery check uses the Electron that `npm ci` already
// installs rather than Playwright's separate Chromium download, which nothing
// in the documented setup fetches — `make verify` would have failed on a clean
// machine with "Executable doesn't exist".
//
// None of the product's hardening applies here and none should: this is a
// browser window for a local static file, not QSO Graph Desktop. The real
// renderer's protections are asserted by the suites that drive the real
// renderer.
const { app, BrowserWindow } = require('electron');

app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-component-update');
app.commandLine.appendSwitch('disable-sync');
app.commandLine.appendSwitch('no-pings');

app.whenReady().then(() => {
  const window = new BrowserWindow({
    width: 1100,
    height: 740,
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
  });
  // Loaded, so the window has web contents for the suite to attach to; a
  // window that has never navigated is not one Playwright will hand back.
  void window.loadURL('about:blank');
});

app.on('window-all-closed', () => app.quit());
