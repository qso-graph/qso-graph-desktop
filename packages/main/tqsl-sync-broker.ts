// SPDX-License-Identifier: GPL-3.0-or-later
import { app, ipcMain } from 'electron';
import { allowsSender } from '../callsigns/callsign-contract.js';
import { TQSL_SYNC_MESSAGES, type TqslSyncResult } from './tqsl-sync.js';
export function startTqslSyncBroker(run: (signal: AbortSignal) => Promise<TqslSyncResult>) {
  const pending = new Set<AbortController>();
  const stop = () => { for (const controller of pending) controller.abort(); ipcMain.removeHandler('tqsl:sync'); };
  ipcMain.handle('tqsl:sync', async (event, ...args: unknown[]) => {
    if (!allowsSender(event.senderFrame, event.sender.mainFrame, event.senderFrame?.url) || args.length) return { ok: false, error: 'The Sync request was refused.' };
    const controller = new AbortController(); pending.add(controller);
    const abort = () => controller.abort();
    event.sender.once('destroyed', abort);
    event.sender.once('did-start-navigation', abort);
    try { return { ok: true, result: await run(controller.signal) }; }
    catch (error) { return { ok: false, error: error instanceof Error && TQSL_SYNC_MESSAGES.includes(error.message) ? error.message : 'Sync from TQSL could not be completed. Check that TQSL can read its station locations, then try again.' }; }
    finally { pending.delete(controller); event.sender.removeListener('destroyed', abort); event.sender.removeListener('did-start-navigation', abort); }
  });
  app.once('before-quit', stop);
  return stop;
}
