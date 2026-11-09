// SPDX-License-Identifier: GPL-3.0-or-later
import { BrowserWindow, dialog, ipcMain, session } from 'electron';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { LotwManagePorts } from './lotw-manage.js';

// Main owns all three dialogs. Nothing here accepts text or answers from an extension.
export function lotwDialogs(dist: string): Pick<LotwManagePorts, 'choose' | 'password' | 'confirm'> {
  return {
    async choose(backup) {
      const options: Electron.OpenDialogOptions = { title: backup ? 'Restore a TQSL backup' : 'Load a LoTW certificate', properties: ['openFile'], filters: [{ name: backup ? 'TQSL backup' : 'LoTW certificate', extensions: backup ? ['tbk'] : ['tq6', 'p12'] }] };
      const parent = BrowserWindow.getFocusedWindow();
      const chosen = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
      return !chosen.canceled && chosen.filePaths.length === 1 ? chosen.filePaths[0] : undefined;
    },
    async confirm(file, preview, locations, skipped, deleting, signal) {
      const detail = [
        ...(file ? [file, ''] : []),
        ...preview.certificates.map(c => `${c.call}, serial ${c.serial || '(unanswered request)'}: ${c.disposition}${c.reason ? ` — ${c.reason}` : ''}\nDXCC ${c.dxcc}; QSOs ${c.qsoFirst} to ${c.qsoLast}; valid ${c.validFrom} to ${c.validTo}\nKey in file: ${c.fileHasKey ? 'yes' : 'no'}; installed key: ${c.keyPresent ? 'yes' : 'no'}`),
        ...preview.roots.map(r => `Trust new root (SHA-256): ${r.fingerprint}`),
        `Signed-QSO record: ${preview.signedQsos} entries, ${preview.signedQsoBytes} bytes`,
        ...locations.map(s => `Desktop Location: ${s.name}\n${Object.entries(s.place).map(([k,v]) => `${k}: ${v}`).join('; ')}${s.lotwPark ? `; LoTW park: ${s.lotwPark}` : ''}`),
        ...skipped.map(s => `Skip Location ${s.name}: ${s.reason}`)
      ].join('\n\n');
      const options: Electron.MessageBoxOptions = { type: 'warning', signal, title: deleting ? 'Delete LoTW certificate' : 'Import into QG Trust', message: deleting ? 'Delete this certificate and its key?' : 'Import exactly these inspected items?', detail, buttons: ['Cancel', deleting ? 'Delete' : 'Import'], defaultId: 0, cancelId: 0, noLink: true, ...(locations.length ? { checkboxLabel: 'Also create these Desktop Locations', checkboxChecked: false } : {}) };
      const parent = BrowserWindow.getFocusedWindow();
      const answer = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
      return { accepted: answer.response === 1, locations: answer.checkboxChecked };
    },
    password: (label, signal) => passwordDialog(dist, label, signal)
  };
}

function passwordDialog(dist: string, label: string, signal?: AbortSignal): Promise<string | undefined> {
  if (signal?.aborted) return Promise.resolve(undefined);
  return new Promise(resolve => {
    const parent = BrowserWindow.getFocusedWindow();
    const isolated = session.fromPartition(`lotw-password-${randomUUID()}`);
    isolated.setPermissionRequestHandler((_contents, _permission, answer) => answer(false));
    isolated.webRequest.onBeforeRequest((details, answer) => answer({ cancel: !details.url.startsWith('data:text/html,') }));
    const window = new BrowserWindow({ parent: parent ?? undefined, modal: !!parent, width: 480, height: 260, resizable: false, minimizable: false, maximizable: false, title: 'Unlock LoTW key', show: false, webPreferences: { session: isolated, preload: join(dist, 'preload', 'lotw-password.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false, webviewTag: false, webSecurity: true, allowRunningInsecureContent: false, devTools: false } });
    let finished = false;
    const finish = (password?: string) => {
      if (finished) return;
      finished = true; signal?.removeEventListener('abort', abort); ipcMain.removeListener('lotw:password', receive); resolve(password);
      if (!window.isDestroyed()) window.destroy();
    };
    const receive = (event: Electron.IpcMainEvent, value: unknown) => {
      if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) return;
      if (typeof value === 'string' && Buffer.byteLength(value) <= 1024) finish(value);
      else finish();
    };
    const abort = () => finish();
    signal?.addEventListener('abort', abort, { once: true });
    ipcMain.on('lotw:password', receive);
    window.on('closed', () => finish());
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.webContents.on('will-attach-webview', event => event.preventDefault());
    // Text goes through escaping, never HTML supplied by the inspected file.
    const escaped = label.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
    const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'sha256-5qF03e6zht3b7Kr4Q6IiHaQ72LxLFEC73sZFUEqz7Tc='; script-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"><title>Unlock LoTW key</title><style>body{font:16px system-ui;padding:20px}input{display:block;width:95%;margin:16px 0}button{padding:6px 16px}</style><form><label for="password">${escaped}</label><input id="password" type="password" maxlength="1024" autocomplete="off" autofocus><button type="submit">Unlock</button><button type="button" id="cancel">Cancel</button></form></html>`;
    window.once('ready-to-show', () => window.show());
    void window.loadURL(`data:text/html,${encodeURIComponent(html)}`).catch(() => finish());
  });
}
