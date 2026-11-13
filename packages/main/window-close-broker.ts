// SPDX-License-Identifier: GPL-3.0-or-later
import { ipcMain, type BrowserWindow } from 'electron';
import { randomUUID } from 'node:crypto';
import { allowsSender } from '../callsigns/callsign-contract.js';

export function startWindowCloseBroker() {
  const pending = new Map<string, { window: BrowserWindow; finish(allowed: boolean): void }>();
  ipcMain.on('window:close-answer', (event, ...args: unknown[]) => {
    if (args.length !== 2 || typeof args[0] !== 'string' || typeof args[1] !== 'boolean') return;
    const request = pending.get(args[0]);
    if (!request || event.sender !== request.window.webContents
      || !allowsSender(event.senderFrame, event.sender.mainFrame, event.senderFrame?.url)) return;
    request.finish(args[1]);
  });
  return (window: BrowserWindow): Promise<boolean> => new Promise(resolve => {
    const token = randomUUID();
    const contents = window.webContents;
    const failed = () => finish(false);
    const finish = (allowed: boolean) => {
      if (!pending.delete(token)) return;
      contents.removeListener('destroyed', failed);
      contents.removeListener('render-process-gone', failed);
      contents.removeListener('did-start-navigation', failed);
      contents.removeListener('did-fail-load', failed);
      contents.removeListener('did-finish-load', send);
      resolve(allowed);
    };
    const send = () => { try { contents.send('window:may-close', token); } catch { finish(false); } };
    pending.set(token, { window, finish });
    contents.once('destroyed', failed);
    contents.once('render-process-gone', failed);
    contents.once('did-start-navigation', failed);
    contents.once('did-fail-load', failed);
    if (contents.isLoadingMainFrame()) contents.once('did-finish-load', send);
    else send();
  });
}
