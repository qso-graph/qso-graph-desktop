// SPDX-License-Identifier: GPL-3.0-only
// QGD-ENG-0003: simple settings live in a file, not the database, so the
// application starts before the engine is up.
//
// The main process owns the file, as it owns the log. The renderer asks over
// the same kind of channel the persona broker uses, with the same two checks:
// the sender has to be the bundled page (QGD-SEC-0007, QGD-PRC-0006) and the
// command has to pass its contract (QGD-SEC-0006).
import { app, ipcMain } from 'electron';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { allowsSender } from './persona-contract.js';
import { createLogger } from './logger.js';
import {
  DEFAULT_SETTINGS, readSettings, validateSettingsCommand,
  type Settings, type SettingsReply
} from './settings-contract.js';

const log = createLogger('settings');

export function settingsPath(directory = app.getPath('userData')): string {
  return join(directory, 'settings.json');
}

export function load(directory?: string): Settings {
  try {
    return readSettings(JSON.parse(readFileSync(settingsPath(directory), 'utf8')));
  } catch {
    // Missing, unreadable or malformed: the defaults are the answer, and the
    // file is rewritten the next time something is changed.
    return { ...DEFAULT_SETTINGS };
  }
}

export function save(settings: Settings, directory = app.getPath('userData')): boolean {
  const path = settingsPath(directory);
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    mkdirSync(directory, { recursive: true });
    // Written beside and renamed, so an interrupted write cannot leave a
    // half-written settings file behind.
    writeFileSync(temporary, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, path);
    return true;
  } catch {
    return false;
  }
}

export function startSettingsBroker(): () => void {
  ipcMain.handle('settings:request', (event, command: unknown): SettingsReply => {
    if (!allowsSender(event.senderFrame, event.sender.mainFrame, event.senderFrame?.url) ||
        !validateSettingsCommand(command)) {
      log.warn({ accepted: false }, 'settings request refused');
      return { ok: false, error: 'Invalid settings request.' };
    }
    if (command.type === 'read') return { ok: true, data: load() };

    const settings = { ...load(), [command.key]: command.value } as Settings;
    if (!save(settings)) {
      log.warn({ key: command.key }, 'settings could not be saved');
      return { ok: false, error: 'The setting could not be saved.' };
    }
    // The key and the value are both non-secret by the contract that allowed
    // them; a setting nobody may see does not belong in this file.
    log.info({ key: command.key, value: String(command.value) }, 'setting changed');
    return { ok: true, data: settings };
  });
  return () => { ipcMain.removeHandler('settings:request'); };
}
