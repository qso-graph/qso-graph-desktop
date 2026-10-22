// SPDX-License-Identifier: GPL-3.0-only
// The extension API's channel (QGD-APP-0002, QGD-APP-0003).
//
// The fourth broker, on the same shape as callsigns, engine and logs: one
// `invoke` channel, a typed command validated on arrival, a reply that is
// either an answer or a refusal. D-33 is why there is no second route — QSO
// Graph's own extensions use this and nothing else, so a built-in
// application has no private shortcut a contributed one would lack.
//
// **Where the enforcement is.** Every decision comes from
// packages/main/extension-runtime.ts, in this process. An extension asking itself
// whether it is allowed is not a permission system (QGD-CRD-0002).
//
// **What this cannot yet do, stated rather than implied.** The extension
// says which application it is, and in P7 that claim is taken at its word,
// because the official tier shares the renderer with the core — one process,
// one bundle. A contributed application must not be able to claim to be
// another, and the thing that makes the claim unforgeable is giving each
// application its own process, which is the sandbox D-2 defers to a later Part
// (QGD-APP-0004). Until then only `official` manifests load, which is what
// makes the gap bounded rather than open: the code that claims an identity
// here is code this project built and reviewed.
import { ipcMain, MessageChannelMain, utilityProcess, type MessagePortMain } from 'electron';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Port } from '../extension-host/protocol.js';
import { createSupervisor, type Supervisor } from './extension-host-supervisor.js';
import { parseLimits } from './extension-limits.js';
import { createEnablement, type Enablement } from './extension-enablement.js';
import type { ExtensionDirectories } from './extension-directories.js';
import { allowsSender } from '../callsigns/callsign-contract.js';
import { createLogger } from '../logging/logger.js';
import { validateGrantRegister, type GrantRegister } from '../extension-api/grants.js';
import { validateExtensionsCommand, type ExtensionsReply } from './extensions-contract.js';
import { REQUEST_KINDS } from '../extension-api/api-contract.js';
import {
  loadExtensions, readManifests, readSourceRegister, type LoadedExtension
} from './extension-runtime.js';
// The serving itself is in extension-serve.ts, with no Electron above it, so it can
// be unit tested. This file is the Electron wiring: the channels, the sender
// check, the files and the logger.
import {
  buildInventory, createServe, type ExtensionBrokerPorts
} from './extension-serve.js';

// A second channel, for the core's own Settings surface rather than for an
// application (QGD-APP-0012). Separate because an extension has no business
// enumerating the others: this one answers what loaded and what each holds.
export const EXTENSIONS_INVENTORY_CHANNEL = 'extensions:inventory';

export interface ExtensionBrokerOptions {
  // Where manifests are read from: directories of extensions, each in a
  // folder with a manifest.json. Only `shipped`'s may be official
  // (QGD-APP-0017).
  directories: ExtensionDirectories;
  grantRegisterFile: string;
  sourceRegisterFile: string;
  // data/extension-limits.json (QGD-APP-0021, QGD-APP-0022).
  limitsFile: string;
  // Where the built core is, for the extension host's entry file.
  distDirectory: string;
  ports: ExtensionBrokerPorts;
  // The extensions the operator turned off, kept in settings.json
  // (QGD-HOM-0007).
  readOff: () => readonly string[];
  writeOff: (off: readonly string[]) => boolean;
  logDirectory?: string;
}

export interface ExtensionBroker {
  stop: () => void;
  // What loaded and what was refused, for the Settings surface
  // (QGD-APP-0012) and for a suite to assert on.
  loaded: () => readonly LoadedExtension[];
  refused: () => readonly { id: string | undefined; source: string; reason: string }[];
  // The extension host's supervisor: activation and page requests (QGD-APP-0015).
  supervisor: Supervisor;
  // Which extensions are on, and word when one is turned off or on (QGD-HOM-0007).
  enablement: Enablement;
}

function adapt(port: MessagePortMain): Port {
  return {
    post: message => port.postMessage(message),
    onMessage: listener => { port.on('message', event => listener(event.data)); port.start(); },
    close: () => port.close()
  };
}

export async function startExtensionBroker(options: ExtensionBrokerOptions): Promise<ExtensionBroker> {
  const log = createLogger('extensions', options.logDirectory);
  const register: GrantRegister = validateGrantRegister(
    JSON.parse(await readFile(options.grantRegisterFile, 'utf8')));
  const sources = await readSourceRegister(options.sourceRegisterFile);

  const result = loadExtensions([
    ...await readManifests(options.directories.shipped, true),
    ...await readManifests(options.directories.others)
  ], register, options.ports.allowed());
  for (const entry of result.refused) {
    // QGD-APP-0011: a refusal is visible. An extension that did not load is
    // said so, with the subject named.
    log.warn({ source: entry.source, subject: entry.subject }, entry.reason);
  }
  if (result.loaded.length > 0) {
    log.info({ extensions: result.loaded.map(extension => extension.manifest.id) }, 'extensions loaded');
  }

  // One object, shared by serving and by the inventory, holding the loaded
  // extensions so the held grants stay current as requests arrive.
  const deps = {
    register, sources: sources.sources, ports: options.ports, log,
    extensions: [...result.loaded], refused: result.refused
  };
  const serve = createServe(deps);

  // QG Extensions (QGD-APP-0015). Started lazily, when the first extension is
  // needed (QGD-APP-0023). Each extension's channel is made here and bound to
  // it (QGD-APP-0018), and its entry is built from the directory its manifest
  // was read from, which is the package's (QGD-APP-0017).
  const limits = parseLimits(JSON.parse(await readFile(options.limitsFile, 'utf8')));
  const supervisor = createSupervisor({
    limits,
    spawn: () => {
      const child = utilityProcess.fork(join(options.distDirectory, 'extension-host', 'host.js'), [],
        { serviceName: 'QG Extensions', stdio: 'ignore' });
      child.once('spawn', () => { log.info({ hostPid: child.pid }, 'extension host process started'); });
      return {
        post: (message, transfer) => child.postMessage(message, transfer ? [transfer as MessagePortMain] : []),
        onMessage: listener => { child.on('message', listener); },
        onExit: listener => { child.once('exit', listener); },
        kill: () => { child.kill(); }
      };
    },
    channel: () => {
      const { port1, port2 } = new MessageChannelMain();
      return { broker: adapt(port1), transfer: port2 };
    },
    describe: id => {
      const extension = deps.extensions.find(entry => entry.manifest.id === id);
      if (!extension?.manifest.main) return undefined;
      return { entry: join(dirname(extension.source), extension.manifest.main), pages: extension.manifest.contributes.pages.map(page => page.id) };
    },
    serve: (id, request) => serve(id, request),
    log
  });

  const enablement = createEnablement({
    loaded: () => deps.extensions.map(extension => extension.manifest.id),
    readOff: options.readOff,
    writeOff: options.writeOff,
    supervisor
  });
  await enablement.start();

  const inventoryHandler = async (event: Electron.IpcMainInvokeEvent, command: unknown): Promise<ExtensionsReply> => {
    if (!allowsSender(event.senderFrame, event.sender.mainFrame, event.senderFrame?.url)) {
      return { ok: false, error: 'That request did not come from the application window.' };
    }
    if (!validateExtensionsCommand(command)) return { ok: false, error: 'That is not a request this product serves.' };
    if (command.type === 'set-enabled') {
      const done = await enablement.set(command.id, command.enabled);
      if (!done.ok) return done;
      log.info({ extension: command.id, enabled: command.enabled }, 'extension turned on or off');
    }
    return { ok: true, inventory: buildInventory(deps, options.readOff()) };
  };
  ipcMain.handle(EXTENSIONS_INVENTORY_CHANNEL, inventoryHandler);

  // There is no channel from the window to the extension API: extension code
  // never runs there (QGD-APP-0015). Extensions reach the core only on their
  // own channels, through the extension host.

  // Not vacuous: every kind the contract declares has a branch above. A kind
  // added to the contract with no branch falls through the switch and returns
  // undefined, which TypeScript catches — this asserts it at run time too, in
  // case the contract is widened without rebuilding this file.
  const unserved = REQUEST_KINDS.filter(kind => !['extension.info', 'callsign.list', 'callsign.active', 'station.active', 'source.fetch', 'service.request'].includes(kind));
  if (unserved.length > 0) log.error({ unserved }, 'the extension API declares request kinds this broker does not serve');

  return {
    stop: () => { supervisor.stop(); ipcMain.removeHandler(EXTENSIONS_INVENTORY_CHANNEL); },
    supervisor,
    enablement,
    loaded: () => deps.extensions,
    refused: () => result.refused
  };
}
