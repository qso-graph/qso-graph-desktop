// SPDX-License-Identifier: GPL-3.0-only
// Home's channel (QGD-HOM-0001 to QGD-HOM-0006). Electron wiring only: which
// cards exist and when each is asked for is home-cards.ts; how an extension is
// asked is the extension host's supervisor.
import { BrowserWindow, ipcMain } from 'electron';
import { allowsSender } from '../personas/persona-contract.js';
import { createLogger } from '../logging/logger.js';
import type { LoadedExtension } from './extension-runtime.js';
import type { Supervisor } from './extension-host-supervisor.js';
import type { Enablement } from './extension-enablement.js';
import { createCardScheduler, keepHidden, type CatalogueCard } from './home-cards.js';
import { HOME_CARD_CHANNEL, HOME_CHANNEL, validateHomeCommand, type HomeReply, type HomeState } from './home-contract.js';
import { load, save } from './settings.js';

export interface HomeBrokerOptions {
  loaded: () => readonly LoadedExtension[];
  supervisor: Supervisor;
  enablement: Pick<Enablement, 'isOn' | 'onChange'>;
  onPersonasChanged: (listener: () => void) => void;
  logDirectory?: string;
}

export function startHomeBroker(options: HomeBrokerOptions): { stop: () => void } {
  const log = createLogger('home', options.logDirectory);

  // Every card a loaded extension offers. An extension that is turned off
  // offers none (QGD-HOM-0007).
  const catalogue = (): CatalogueCard[] => options.loaded().filter(extension => options.enablement.isOn(extension.manifest.id)).flatMap(extension =>
    extension.manifest.contributes.cards.map(card => ({
      key: `${extension.manifest.id}/${card.id}`, extension: extension.manifest.id, extensionName: extension.manifest.name,
      card: card.id, name: card.name, description: card.description, refreshSeconds: card.refreshSeconds
    })));

  const scheduler = createCardScheduler({
    catalogue,
    pins: () => load().pins,
    card: (extension, card, signal) => options.supervisor.card(extension, card, signal),
    // Pushed to every window; a window not showing Home ignores it.
    publish: view => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) window.webContents.send(HOME_CARD_CHANNEL, view);
      }
    },
    now: () => Date.now()
  });
  options.onPersonasChanged(() => scheduler.personasChanged());
  // Turned off, its cards go and what they had in flight is cancelled; on
  // again, they come back to the pins they held.
  const stopListening = options.enablement.onChange(() => scheduler.changed());

  const state = (): HomeState => ({
    available: catalogue().map(({ key, name, description, extensionName }) => ({ key, name, description, extensionName })),
    pins: load().pins,
    cards: scheduler.views()
  });

  // A window that closes while Home is showing stops the asking: on macOS the
  // application keeps running with no window at all.
  const watched = new WeakSet<Electron.WebContents>();
  const watch = (contents: Electron.WebContents) => {
    if (watched.has(contents)) return;
    watched.add(contents);
    contents.once('destroyed', () => scheduler.setVisible(false));
  };

  ipcMain.handle(HOME_CHANNEL, (event, command: unknown): HomeReply => {
    if (!allowsSender(event.senderFrame, event.sender.mainFrame, event.senderFrame?.url) || !validateHomeCommand(command)) {
      log.warn({ accepted: false }, 'home request refused');
      return { ok: false, error: 'That is not a request Home serves.' };
    }
    switch (command.type) {
      case 'read':
        return { ok: true, state: state() };
      case 'visible':
        watch(event.sender);
        scheduler.setVisible(command.visible);
        return { ok: true, state: state() };
      case 'pin': {
        // Saved in the operator's order (QGD-HOM-0003), with the pins of an
        // extension that is off kept after them while there is room, so its
        // cards come back when it is turned on (QGD-HOM-0007).
        const settings = load();
        const pins = keepHidden(command.pins, settings.pins, catalogue());
        if (!pins) return { ok: false, error: 'There is no room for that many pins beside those kept for extensions that are off.' };
        if (!save({ ...settings, pins })) return { ok: false, error: 'The pins could not be saved.' };
        scheduler.changed();
        return { ok: true, state: state() };
      }
    }
  });

  return {
    stop: () => { stopListening(); scheduler.stop(); ipcMain.removeHandler(HOME_CHANNEL); }
  };
}
