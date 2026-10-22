// SPDX-License-Identifier: GPL-3.0-only
// Home's channel (QGD-HOM-0001 to QGD-HOM-0006). Electron wiring only: which
// pages exist and when each is asked for is home-pages.ts; how an extension is
// asked is the extension host's supervisor.
import { BrowserWindow, ipcMain } from 'electron';
import { allowsSender } from '../callsigns/callsign-contract.js';
import { createLogger } from '../logging/logger.js';
import type { LoadedExtension } from './extension-runtime.js';
import type { Supervisor } from './extension-host-supervisor.js';
import type { Enablement } from './extension-enablement.js';
import { createPageScheduler, keepHidden, type CataloguePage } from './page-scheduler.js';
import { HOME_CARD_CHANNEL, HOME_CHANNEL, HOME_NOTICE_CHANNEL, validateHomeCommand, type HomeReply, type HomeState } from './home-contract.js';
import { dismiss, hostNotice } from './home-notice.js';
import { load, save } from './settings.js';
import { isExtensionIcon } from '../ui/icons.js';

export interface HomeBrokerOptions {
  loaded: () => readonly LoadedExtension[];
  supervisor: Supervisor;
  enablement: Pick<Enablement, 'isOn' | 'onChange'>;
  onCallsignsChanged: (listener: () => void) => void;
  logDirectory?: string;
}

export function startHomeBroker(options: HomeBrokerOptions): { stop: () => void } {
  const log = createLogger('home', options.logDirectory);

  // Every page a loaded extension offers. An extension that is turned off
  // offers none (QGD-HOM-0007).
  const catalogue = (): CataloguePage[] => options.loaded().filter(extension => options.enablement.isOn(extension.manifest.id)).flatMap(extension =>
    extension.manifest.contributes.pages.map(page => ({
      key: `${extension.manifest.id}/${page.id}`, extension: extension.manifest.id, extensionName: extension.manifest.name,
      page: page.id, name: page.name, description: page.description, refreshSeconds: page.refreshSeconds,
      icon: page.icon !== undefined && isExtensionIcon(page.icon) ? page.icon : 'extension', rail: page.rail === true
    })));

  // The page on screen, if any. Only it is asked for (KI7MT, 2026-10-22).
  let open: string | null = null;
  const scheduler = createPageScheduler({
    catalogue,
    pins: () => (open === null ? [] : [open]),
    page: (extension, page, signal) => options.supervisor.page(extension, page, signal),
    // Pushed to every window; a window not showing Home ignores it.
    publish: view => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) window.webContents.send(HOME_CARD_CHANNEL, view);
      }
    },
    now: () => Date.now()
  });
  options.onCallsignsChanged(() => scheduler.callsignsChanged());
  // Turned off, its pages go and what they had in flight is cancelled; on
  // again, they come back to the pins they held.
  const stopListening = options.enablement.onChange(() => scheduler.changed());

  // The extension host's notice (QGD-APP-0022): which extensions a stop
  // affected, by name, until dismissed. Dismissing hides that stop only.
  let dismissed = 0;
  const nameOf = (id: string) => options.loaded().find(extension => extension.manifest.id === id)?.manifest.name ?? id;
  const notice = () => hostNotice(options.supervisor.status(), nameOf, dismissed);
  const pushNotice = () => {
    const now = notice();
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(HOME_NOTICE_CHANNEL, now);
    }
  };
  const stopNotices = options.supervisor.onChange(pushNotice);

  const state = (): HomeState => ({
    available: catalogue().map(({ key, name, description, extensionName, icon, rail }) => ({ key, name, description, extensionName, icon, rail })),
    pins: load().pins,
    pages: scheduler.views(),
    notice: notice()
  });

  // A window that closes while a page is open stops the asking: on macOS the
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
      case 'open':
        watch(event.sender);
        open = command.key;
        scheduler.changed();
        scheduler.setVisible(open !== null);
        return { ok: true, state: state() };
      case 'pin': {
        // Saved in the operator's order (QGD-HOM-0003), with the pins of an
        // extension that is off kept after them while there is room, so its
        // tiles come back when it is turned on (QGD-HOM-0007).
        const settings = load();
        const pins = keepHidden(command.pins, settings.pins, catalogue());
        if (!pins) return { ok: false, error: 'There is no room for that many pins beside those kept for extensions that are off.' };
        if (!save({ ...settings, pins })) return { ok: false, error: 'The pins could not be saved.' };
        scheduler.changed();
        return { ok: true, state: state() };
      }
      case 'dismiss': {
        // Only a stop that has happened can be dismissed; a later one shows.
        const next = dismiss(dismissed, command.id, options.supervisor.status().stops);
        if (next === undefined) return { ok: false, error: 'There is no such notice.' };
        dismissed = next;
        pushNotice();
        return { ok: true, state: state() };
      }
    }
  });

  return {
    stop: () => { stopListening(); stopNotices(); scheduler.stop(); ipcMain.removeHandler(HOME_CHANNEL); }
  };
}
