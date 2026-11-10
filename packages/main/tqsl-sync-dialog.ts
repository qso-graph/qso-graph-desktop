// SPDX-License-Identifier: GPL-3.0-or-later
import { BrowserWindow, ipcMain, session } from 'electron';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { TqslSyncPlan, TqslSyncRow } from './tqsl-sync.js';

const escape = (value: string) =>
  value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const STATUS: Record<TqslSyncRow['status'], string> = {
  new: 'New',
  same: 'Same as your Location',
  differs: 'Differs from your Location',
  refused: 'Refused'
};

export function tqslRowText(row: TqslSyncRow): string {
  return [
    `${row.name}: ${STATUS[row.status]}`,
    ...(row.offered && row.resultName !== row.name ? [`Creates Location: ${row.resultName}`] : []),
    ...Object.entries(row.place).map(([k, v]) => `  ${k}: ${v}`),
    ...(row.park ? [`  LoTW park: ${row.park}`] : []),
    ...(row.differences.length ? ['Differences:'] : []),
    ...row.differences.map(({ field, tqsl, stored }) =>
      `  ${field === 'lotwPark' ? 'LoTW park' : field}: TQSL ${tqsl ?? '(empty)'}; your Location ${stored ?? '(empty)'}`),
    ...(row.reason ? [row.reason] : [])
  ].join('\n');
}

// The window's only style. The CSP names its hash, so no other style can apply; the
// dialog tests check the hash, so change both together. `color-scheme` follows the app's
// theme, which Electron reports to every window.
const STYLE =
  ':root{color-scheme:light dark}' +
  'body{font:14px system-ui,sans-serif;margin:0;padding:20px 24px}' +
  'h1{font-size:17px;font-weight:600;margin:0 0 8px}' +
  '.folder{font:13px ui-monospace,monospace;overflow-wrap:anywhere;margin:0 0 6px}' +
  'p{margin:0 0 12px}' +
  'fieldset{border:1px solid GrayText;border-radius:4px;margin:0 0 10px;padding:8px 12px}' +
  'pre{font:13px ui-monospace,monospace;white-space:pre-wrap;margin:6px 0 0}' +
  '.actions{position:sticky;bottom:0;background:Canvas;display:flex;justify-content:flex-end;gap:8px;padding:12px 0}' +
  'button{font:inherit;padding:5px 18px}';

export function tqslSyncDialog(dist: string, plan: TqslSyncPlan, signal?: AbortSignal): Promise<number[] | undefined> {
  if (signal?.aborted) return Promise.resolve(undefined);
  return new Promise(resolve => {
    const parent = BrowserWindow.getFocusedWindow();
    const isolated = session.fromPartition(`tqsl-sync-${randomUUID()}`);
    isolated.setPermissionRequestHandler((_contents, _permission, answer) => answer(false));
    isolated.webRequest.onBeforeRequest((details, answer) => answer({ cancel: !details.url.startsWith('data:text/html,') }));
    const window = new BrowserWindow({
      parent: parent ?? undefined,
      modal: !!parent,
      width: 760,
      height: 640,
      show: false,
      minimizable: false,
      maximizable: false,
      title: 'Sync from TQSL',
      webPreferences: {
        session: isolated,
        preload: join(dist, 'preload', 'tqsl-sync.cjs'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInWorker: false,
        nodeIntegrationInSubFrames: false,
        webviewTag: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        devTools: false
      }
    });
    let finished = false;
    const finish = (selected?: number[]) => {
      if (finished) return;
      finished = true;
      signal?.removeEventListener('abort', abort);
      ipcMain.removeListener('tqsl:sync-answer', receive);
      resolve(selected);
      if (!window.isDestroyed()) window.destroy();
    };
    const abort = () => finish();
    // Only offered rows can be chosen, each once; null is Cancel.
    const receive = (event: Electron.IpcMainEvent, value: unknown) => {
      if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) return;
      if (value === null) finish();
      else if (
        Array.isArray(value) &&
        value.length <= plan.locations.length &&
        new Set(value).size === value.length &&
        value.every(i => typeof i === 'number' && Number.isSafeInteger(i) && i >= 0 && plan.locations[i]?.offered)
      ) finish(value);
    };
    ipcMain.on('tqsl:sync-answer', receive);
    signal?.addEventListener('abort', abort, { once: true });
    window.on('closed', () => finish());
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.webContents.on('will-attach-webview', event => event.preventDefault());

    // Every value goes through escaping; TQSL's file supplies no HTML.
    const rows = plan.locations
      .map((row, i) => {
        const tick = row.offered
          ? `<label><input type="checkbox" name="location" value="${i}"${row.checked ? ' checked' : ''}> Create ${escape(row.resultName)}</label>`
          : '';
        return `<fieldset>${tick}<pre>${escape(tqslRowText(row))}</pre></fieldset>`;
      })
      .join('');
    const intro = plan.locations.length
      ? 'Choose the Locations to create. Your existing Locations stay as they are, and nothing is written to TQSL.'
      : 'TQSL has no station locations in this folder.';
    const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'sha256-tjwizvuszoBktE0tq/fRBSNDlXrBJBgF+omixIwvw1w='; script-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"><title>Sync from TQSL</title><style>${STYLE}</style><h1>Sync from TQSL</h1><p class="folder">${escape(plan.folder)}</p><p>${intro}</p><form>${rows}<div class="actions"><button type="button" id="cancel">Cancel</button> <button type="submit">Create Locations</button></div></form></html>`;
    window.once('ready-to-show', () => window.show());
    void window.loadURL(`data:text/html,${encodeURIComponent(html)}`).catch(() => finish());
  });
}
