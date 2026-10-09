// SPDX-License-Identifier: GPL-3.0-only
// The Logs page's channel: read the level, change it, export diagnostics.
//
// QGD-LOG-0012 is the rule the export obeys — one redacted archive, and nothing
// leaves the machine unless the user sends it. So the destination is chosen by
// the user in a save dialog and the archive is written there; this process
// transmits nothing and offers nowhere to transmit to.
//
// The dialog is injected rather than called, so the export path can be driven
// without a native window standing in front of it. The default is the real
// dialog, which is what the application uses.
import { app, dialog, ipcMain } from 'electron';
import { join } from 'node:path';
import { allowsSender } from '../personas/persona-contract.js';
import { exportDiagnostics } from './diagnostics.js';
import { createLogger, currentLevel, logDirectory, setLevel } from '../logging/logger.js';
import { DEFAULT_LEVEL, RAISED_LEVEL_MS } from '../logging/logging.js';
import { validateLogsCommand, type LogsReply, type LogsStatus } from './logs-contract.js';

export const LOGS_CHANNEL = 'logs:request';

// Where the dialog opens, and what the file is called. Dated, because somebody
// sending two of these a week apart should not have to work out which is which.
export function suggestedExportName(nowMs = Date.now()): string {
  const stamp = new Date(nowMs).toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return `qg-desktop-diagnostics-${stamp}.zip`;
}

export type ChooseDestination = (suggested: string) => Promise<string | undefined>;

const saveDialog: ChooseDestination = async suggested => {
  const result = await dialog.showSaveDialog({
    title: 'Export diagnostics',
    defaultPath: suggested,
    filters: [{ name: 'Zip archive', extensions: ['zip'] }]
  });
  return result.canceled ? undefined : result.filePath || undefined;
};

export interface LogsBrokerOptions {
  directory?: string;
  chooseDestination?: ChooseDestination;
  now?: () => number;
}

export function startLogsBroker(options: LogsBrokerOptions = {}): () => void {
  const directory = options.directory ?? logDirectory();
  const choose = options.chooseDestination ?? saveDialog;
  const now = options.now ?? Date.now;
  // Created here rather than at module load. A logger built while this module
  // is being imported opens a file in whatever the log directory resolves to
  // at that moment — which, for a test that imports this module for one pure
  // function, is the developer's real log folder.
  const log = createLogger('logs', directory);

  const status = (): LogsStatus => ({
    level: currentLevel(directory),
    defaultLevel: DEFAULT_LEVEL,
    revertAfterMs: RAISED_LEVEL_MS,
    directory
  });

  ipcMain.handle(LOGS_CHANNEL, async (event, command: unknown): Promise<LogsReply> => {
    if (!allowsSender(event.senderFrame, event.sender.mainFrame, event.senderFrame?.url) ||
        !validateLogsCommand(command)) {
      log.warn({ accepted: false }, 'logs request refused');
      return { ok: false, error: 'Invalid logs request.' };
    }

    if (command.type === 'read') return { ok: true, kind: 'status', status: status() };

    if (command.type === 'set-level') {
      if (!setLevel(command.level, directory, now())) {
        log.warn({ level: command.level }, 'log level could not be written');
        return { ok: false, error: 'The log level could not be saved.' };
      }
      // A level is not a secret, and the record of someone raising it is part
      // of what makes the log worth reading afterwards.
      log.info({ level: command.level }, 'log level changed');
      return { ok: true, kind: 'status', status: status() };
    }

    // Offered on the Desktop, where somebody about to attach it to an email
    // will find it. Asked for at the moment of export rather than at startup,
    // so a test can start this broker without Electron being ready.
    const destination = await choose(join(app.getPath('desktop'), suggestedExportName(now())));
    if (destination === undefined) {
      log.info({}, 'diagnostics export cancelled');
      return { ok: true, kind: 'cancelled' };
    }
    try {
      const { files, bytes } = await exportDiagnostics(directory, destination);
      // The count and the size, never the path: the path is the user's and
      // there is nothing to gain by writing it down.
      log.info({ files, bytes }, 'diagnostics exported');
      return { ok: true, kind: 'exported', files, bytes };
    } catch {
      log.warn({}, 'diagnostics export failed');
      return { ok: false, error: 'The diagnostics archive could not be written.' };
    }
  });

  return () => { ipcMain.removeHandler(LOGS_CHANNEL); };
}
