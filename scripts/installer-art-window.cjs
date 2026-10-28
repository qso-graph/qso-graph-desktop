// SPDX-License-Identifier: GPL-3.0-only
// The window scripts/gen-installer-art.mjs draws the installer's artwork in: Electron, the
// browser npm ci installs (tests/toolchain.test.mjs), hidden. A fresh profile every run, and the
// zoom pinned at 1: Electron remembers a page's zoom in its profile, and a remembered zoom drew
// the artwork twice the size inside a 1x crop.
const { app, BrowserWindow } = require('electron');
const { mkdtempSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');

app.setPath('userData', mkdtempSync(join(tmpdir(), 'qgd-installer-art-')));
app.whenReady().then(() => {
  const window = new BrowserWindow({ show: false, width: 640, height: 960, webPreferences: { zoomFactor: 1 } });
  void window.loadFile(process.argv[process.argv.length - 1]);
});
