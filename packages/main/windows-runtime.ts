// SPDX-License-Identifier: GPL-3.0-only
// Says so when Microsoft's Visual C++ runtime is missing on Windows (#91);
// the check and the words are windows-runtime-contract.ts.
import { dialog, type BrowserWindow } from 'electron';
import { RUNTIME_MESSAGE } from './windows-runtime-contract.js';

export { windowsRuntimeMissing } from './windows-runtime-contract.js';

export async function warnWindowsRuntime(window: BrowserWindow | undefined, openPage: () => void): Promise<void> {
  const options = { type: 'warning' as const, ...RUNTIME_MESSAGE, defaultId: 0, cancelId: 1, noLink: true };
  const { response } = window ? await dialog.showMessageBox(window, options) : await dialog.showMessageBox(options);
  if (response === 0) openPage();
}
