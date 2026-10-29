// SPDX-License-Identifier: GPL-3.0-only
// Integrations' channel, and the process that listens (QGD-INT-0001,
// QGD-INT-0010). Electron wiring only: what is decided is
// integrations-hub.ts, tested in process.
//
// The process is started when the first adapter is turned on, never with the
// window (QGD-INT-0004), and restarted with back-off if it exits, as QG
// Storage is (QGD-ENG-0006), while the window and every other process keep
// running (QGD-PRC-0001). Its arguments are a path inside the application,
// never a user's.
import { BrowserWindow, ipcMain, utilityProcess, type UtilityProcess } from 'electron';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { allowsSender } from '../callsigns/callsign-contract.js';
import { createLogger, writeForwarded } from '../logging/logger.js';
import { parseFromIntegrations, isAddress, type ToIntegrations } from '../integrations/integration-contract.js';
import { createIntegrationsHub, type HubExtension, type IntegrationsHub, type NetworkInterface } from './integrations-hub.js';
import {
  INTEGRATIONS_CHANNEL, INTEGRATIONS_STATUS_CHANNEL, validateIntegrationsCommand, type IntegrationsReply
} from './integrations-page-contract.js';
import type { ToExtension } from '../extension-host/protocol.js';
import { isInterfaceName, type AdapterSettings } from './settings-contract.js';

// Closing every port is quick; this is the backstop for one that does not say.
export const SHUTDOWN_MS = 3_000;
// How often the interfaces are looked at while an adapter listens on a
// network. Node's main process has no event for a network that comes or an
// address that changes; reading the interfaces is a call into the operating
// system, with no I/O.
export const INTERFACES_MS = 5_000;

export interface IntegrationsBrokerOptions {
  distDirectory: string;
  // data/integration-limits.json (QGD-INT-0007).
  limitsFile: string;
  extensions: () => readonly HubExtension[];
  isOn: (id: string) => boolean;
  holds: (id: string, grant: string) => boolean;
  readSettings: () => Readonly<Record<string, AdapterSettings>>;
  writeSettings: (settings: Readonly<Record<string, AdapterSettings>>) => boolean;
  deliver: (id: string, message: Extract<ToExtension, { type: 'datagrams' | 'events' }>, allowed: () => boolean) => Promise<boolean>;
  logDirectory?: string;
}

// This computer's network interfaces, by name, without loopback and without
// IPv6 link-local addresses, which need a scope the listener does not take.
export function ownInterfaces(): NetworkInterface[] {
  const out: NetworkInterface[] = [];
  for (const [name, entries] of Object.entries(networkInterfaces())) {
    if (!isInterfaceName(name) || !entries) continue;
    const addresses = entries.filter(entry => !entry.internal && !entry.address.toLowerCase().startsWith('fe80') && isAddress(entry.address))
      .map(entry => entry.address);
    if (addresses.length > 0) out.push({ name, addresses: [...new Set(addresses)].slice(0, 16) });
  }
  return out.slice(0, 32);
}

export interface IntegrationsBroker {
  hub: IntegrationsHub;
  // An adapter or consumer was turned on or off, or a grant changed: the
  // ports are made to match.
  reconcile: () => void;
  stop: () => Promise<void>;
}

export function startIntegrationsBroker(options: IntegrationsBrokerOptions): IntegrationsBroker {
  const log = createLogger('integrations-broker', options.logDirectory);
  let worker: UtilityProcess | undefined;
  let stopped = false;
  let failures = 0;
  let closed: (() => void) | undefined;
  // The last listen said, so a process that has just started is told it.
  let wanted: ToIntegrations = { type: 'listen', specs: [] };

  const push = () => {
    const view = hub.view();
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(INTEGRATIONS_STATUS_CHANNEL, view);
    }
  };

  const hub = createIntegrationsHub({
    extensions: options.extensions,
    isOn: options.isOn,
    holds: options.holds,
    settings: options.readSettings,
    interfaces: ownInterfaces,
    send: message => {
      if (message.type === 'listen') {
        wanted = message;
        // Started when there is something to listen for (QGD-INT-0004).
        if (!worker && message.specs.length > 0 && !stopped) spawn();
      }
      worker?.postMessage(message);
    },
    deliver: options.deliver,
    changed: push,
    now: () => Date.now(),
    log
  });

  function spawn(): void {
    if (stopped || worker) return;
    const child = utilityProcess.fork(join(options.distDirectory, 'integrations', 'integrations-service.js'), [options.limitsFile],
      { serviceName: 'QG Integrations', stdio: 'ignore' });
    worker = child;
    child.once('spawn', () => {
      // Logged so the connection-capture suite can name this process, which
      // is the one process that listens (QGD-INT-0002).
      log.info({ integrationsPid: child.pid }, 'integrations service started');
      if (worker !== child) return;
      hub.processState('running');
      child.postMessage(wanted);
    });
    child.on('message', (raw: unknown) => {
      if (worker !== child) return;
      // From our own process, and checked all the same (QGD-SEC-0006).
      const message = parseFromIntegrations(raw);
      if (!message) {
        // Its kind only: a refused message is not repeated into the log.
        const type = typeof raw === 'object' && raw !== null && typeof (raw as { type?: unknown }).type === 'string' ? (raw as { type: string }).type.slice(0, 16) : typeof raw;
        log.warn({ type }, 'a message from Integrations was refused');
        return;
      }
      if (message.type === 'log') { writeForwarded(message.line); return; }
      if (message.type === 'closed') { closed?.(); return; }
      if (message.type === 'ports' && message.ports.some(port => port.listening)) failures = 0;
      hub.received(message);
    });
    child.once('exit', () => {
      if (worker !== child) return;
      worker = undefined;
      if (stopped) return;
      // The same back-off as QG Storage's: a process that cannot start must
      // not become a restart loop.
      const wait = Math.min(500 * 2 ** failures++, 30_000);
      hub.processState('restarting');
      log.warn({ waitMs: wait, failures }, 'integrations service exited; restarting');
      setTimeout(() => { if (!stopped && !worker) spawn(); }, wait);
    });
  }

  ipcMain.handle(INTEGRATIONS_CHANNEL, (event, command: unknown): IntegrationsReply => {
    if (!allowsSender(event.senderFrame, event.sender.mainFrame, event.senderFrame?.url) || !validateIntegrationsCommand(command)) {
      log.warn({ accepted: false }, 'integrations request refused');
      return { ok: false, error: 'That is not a request Integrations serves.' };
    }
    if (command.type === 'set') {
      if (!options.extensions().some(extension => extension.id === command.adapter && extension.integration)) {
        return { ok: false, error: 'There is no such adapter.' };
      }
      // A network address chosen is a list of senders the operator names;
      // this computer alone has its own (integrations-hub.ts).
      const entry: AdapterSettings = { port: command.port, network: command.network, allow: command.network === null ? [] : [...command.allow] };
      if (!options.writeSettings({ ...options.readSettings(), [command.adapter]: entry })) {
        return { ok: false, error: 'The change could not be saved.' };
      }
      // The address and the senders, never what was sent (QGD-INT-0007).
      log.info({ adapter: command.adapter, port: entry.port, network: entry.network, allowed: entry.allow.length }, 'adapter port set');
      hub.reconcile();
    }
    return { ok: true, view: hub.view() };
  });

  hub.reconcile();
  hub.interfacesChanged();
  const watch = setInterval(() => { if (!stopped && hub.watching()) hub.interfacesChanged(); }, INTERFACES_MS);
  watch.unref?.();

  return {
    hub,
    reconcile: () => hub.reconcile(),
    stop: async () => {
      stopped = true;
      clearInterval(watch);
      ipcMain.removeHandler(INTEGRATIONS_CHANNEL);
      const child = worker;
      if (!child) return;
      const done = new Promise<'closed'>(settle => { closed = () => settle('closed'); });
      child.postMessage({ type: 'close' } satisfies ToIntegrations);
      const outcome = await Promise.race([done, new Promise<'timeout'>(settle => setTimeout(() => settle('timeout'), SHUTDOWN_MS))]);
      if (outcome === 'closed') log.info({}, 'integrations closed');
      else log.warn({ waitedMs: SHUTDOWN_MS }, 'integrations did not close in time; killed');
      worker = undefined;
      child.kill();
    }
  };
}
