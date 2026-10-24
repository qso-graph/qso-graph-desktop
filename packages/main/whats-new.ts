// SPDX-License-Identifier: GPL-3.0-only
// What's new (QGD-FRM-0016): the window asks for this version's notes, or
// those since the version it last saw, and gets them from the CHANGELOG.md
// the application ships. Read once, at start; nothing is fetched.
import { ipcMain } from 'electron';
import { readFileSync } from 'node:fs';
import { allowsSender } from '../callsigns/callsign-contract.js';
import { createLogger } from '../logging/logger.js';
import { WHATS_NEW_CHANNEL, notesFor, parseChangelog, validateWhatsNewCommand, type NotesSection, type WhatsNewNotes } from './whats-new-contract.js';

const log = createLogger('whats-new');

export function startWhatsNewBroker(changelogFile: string, version: string): () => void {
  let sections: NotesSection[] = [];
  try {
    sections = parseChangelog(readFileSync(changelogFile, 'utf8'));
  } catch {
    log.warn({}, 'the changelog could not be read; What\'s new will be empty');
  }
  ipcMain.handle(WHATS_NEW_CHANNEL, (event, command: unknown): WhatsNewNotes | false => {
    if (!allowsSender(event.senderFrame, event.sender.mainFrame, event.senderFrame?.url) || !validateWhatsNewCommand(command)) {
      log.warn({ accepted: false }, 'what\'s new request refused');
      return false;
    }
    return notesFor(sections, version, command.since);
  });
  return () => ipcMain.removeHandler(WHATS_NEW_CHANNEL);
}
