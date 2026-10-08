// SPDX-License-Identifier: GPL-3.0-only
// Whether the operating system is set to dark, told to the renderer by the main
// process rather than read in the renderer.
//
// QGD-FRM-0001 asks the shell to follow the system and to change with it while
// running. The obvious way to do that is the renderer's
// `prefers-color-scheme` media query, and on Electron 44 that is not reliable:
// measured on macOS 27 with the system in dark mode, `nativeTheme
// .shouldUseDarkColors` was true in the main process while the renderer's media
// query reported light, and it stayed wrong for the life of the window — until
// anything invalidated Chromium's computed style, at which point it corrected
// itself to dark. A requirement cannot rest on that.
//
// So the main process, which has the right answer, is the authority: it is
// asked once at startup and pushes a change when the system changes. The
// renderer keeps its media query subscribed as well, so if Chromium starts
// agreeing nothing has to be undone.
//
// Two named functions, no channel the caller chooses, and the reply is a
// boolean — QGD-SEC-0007 applies here exactly as it does to the other brokers.
import { BrowserWindow, ipcMain, nativeTheme } from 'electron';
import { allowsSender } from './persona-contract.js';
import { createLogger } from './logger.js';

const log = createLogger('appearance');

export const APPEARANCE_REQUEST = 'system:prefers-dark';
export const APPEARANCE_CHANGED = 'system:appearance-changed';

export function startAppearanceBroker(): () => void {
  ipcMain.handle(APPEARANCE_REQUEST, (event): boolean => {
    if (!allowsSender(event.senderFrame, event.sender.mainFrame, event.senderFrame?.url)) {
      log.warn({ accepted: false }, 'appearance request refused');
      // Light is the safer refusal: a window that cannot ask gets the same
      // answer as a system that is not dark, rather than an error to handle.
      return false;
    }
    return nativeTheme.shouldUseDarkColors;
  });

  const publish = (): void => {
    const prefersDark = nativeTheme.shouldUseDarkColors;
    log.info({ prefersDark }, 'system appearance changed');
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(APPEARANCE_CHANGED, prefersDark);
    }
  };

  nativeTheme.on('updated', publish);
  return () => {
    nativeTheme.off('updated', publish);
    ipcMain.removeHandler(APPEARANCE_REQUEST);
  };
}
