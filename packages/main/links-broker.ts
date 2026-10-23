// SPDX-License-Identifier: GPL-3.0-only
// Opens a page in the operator's browser (QGD-SEC-0009): Help's documents and
// a park's or summit's page (QGD-FRM-0015, QGD-STN-0011). The window names
// the page; the URL is built from data/links.json. The browser is the
// operator's, so this is not the application going online (QGD-SEC-0020).
import { readFileSync } from 'node:fs';
import { ipcMain, shell } from 'electron';
import { allowsSender } from '../callsigns/callsign-contract.js';
import { createLogger } from '../logging/logger.js';
import { LINKS_CHANNEL, linkFor, validateLinkCommand, validateLinkRegister, type LinkCommand } from './links-contract.js';

const log = createLogger('links');

export interface LinksBroker {
  open: (command: LinkCommand) => void;
  stop: () => void;
}

export function startLinksBroker(registerFile: string): LinksBroker {
  const register = validateLinkRegister(JSON.parse(readFileSync(registerFile, 'utf8')));
  const open = (command: LinkCommand): void => {
    // The kind only: a reference is the operator's, and stays out of the log.
    log.info({ type: command.type, page: command.type === 'reference' ? command.kind : command.type === 'release' ? command.version : command.name }, 'opening a page in the browser');
    // Built from the register, and checked again here, before the call.
    const url = linkFor(register, command);
    if (!url.startsWith('https://')) return;
    shell.openExternal(url).catch(() => log.warn({ type: command.type }, 'the browser did not open'));
  };
  ipcMain.handle(LINKS_CHANNEL, (event, command: unknown): boolean => {
    if (!allowsSender(event.senderFrame, event.sender.mainFrame, event.senderFrame?.url) || !validateLinkCommand(command)) {
      log.warn({ accepted: false }, 'link refused');
      return false;
    }
    open(command);
    return true;
  });
  return { open, stop: () => ipcMain.removeHandler(LINKS_CHANNEL) };
}
