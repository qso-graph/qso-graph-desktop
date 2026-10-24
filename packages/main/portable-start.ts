// SPDX-License-Identifier: GPL-3.0-only
// Applies portable mode (portable.ts) before anything else in the main
// process runs: main.ts imports this first, so the data folder and the log
// folder are set before any module opens a store or a log. The utility
// processes inherit the log folder through the environment.
import { app } from 'electron';
import { existsSync, mkdirSync } from 'node:fs';
import { portableFolder } from './portable.js';

const portable = portableFolder({
  platform: process.platform, execPath: process.execPath, env: process.env,
  packaged: app.isPackaged, argv: process.argv, exists: existsSync
});
if (portable) {
  try {
    if (portable.create) mkdirSync(portable.folder, { recursive: true });
    app.setPath('userData', portable.folder);
    process.env.QG_DESKTOP_LOG_DIR ??= portable.logs;
    process.env.QG_DESKTOP_PORTABLE = portable.folder;
  } catch {
    // A folder that cannot be made, as on a read-only stick, leaves the
    // platform's own places in use rather than stopping the application.
  }
}
