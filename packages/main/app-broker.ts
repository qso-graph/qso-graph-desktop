// SPDX-License-Identifier: GPL-3.0-only
// The app API's channel (QGD-APP-0002, QGD-APP-0003).
//
// The fourth broker, on the same shape as personas, engine and logs: one
// `invoke` channel, a typed command validated on arrival, a reply that is
// either an answer or a refusal. D-33 is why there is no second route — QSO
// Graph's own applications use this and nothing else, so a built-in
// application has no private shortcut a contributed one would lack.
//
// **Where the enforcement is.** Every decision comes from
// packages/main/app-runtime.ts, in this process. An application asking itself
// whether it is allowed is not a permission system (QGD-CRD-0002).
//
// **What this cannot yet do, stated rather than implied.** The application
// says which application it is, and in P7 that claim is taken at its word,
// because the official tier shares the renderer with the frame — one process,
// one bundle. A contributed application must not be able to claim to be
// another, and the thing that makes the claim unforgeable is giving each
// application its own process, which is the sandbox D-2 defers to a later Part
// (QGD-APP-0004). Until then only `official` manifests load, which is what
// makes the gap bounded rather than open: the code that claims an identity
// here is code this project built and reviewed.
import { ipcMain } from 'electron';
import { readFile } from 'node:fs/promises';
import { allowsSender } from '../personas/persona-contract.js';
import { createLogger } from '../logging/logger.js';
import { validateGrantRegister, type GrantRegister } from '../app-api/grants.js';
import { validateAppsCommand, type AppsReply } from './apps-contract.js';
import { REQUEST_KINDS, type AppReply } from '../app-api/api-contract.js';
import {
  loadApps, readManifests, readSourceRegister, type LoadedApp
} from './app-runtime.js';
// The serving itself is in app-serve.ts, with no Electron above it, so it can
// be unit tested. This file is the Electron wiring: the channels, the sender
// check, the files and the logger.
import {
  buildInventory, createServe, refusal, type AppBrokerPorts
} from './app-serve.js';

export const APP_CHANNEL = 'app:request';
// A second channel, for the frame's own Settings surface rather than for an
// application (QGD-APP-0012). Separate because an application has no business
// enumerating the others: this one answers what loaded and what each holds.
export const APPS_INVENTORY_CHANNEL = 'apps:inventory';

export interface AppBrokerOptions {
  // Where manifests are read from. One directory per application, each with a
  // manifest.json.
  directories: readonly string[];
  grantRegisterFile: string;
  sourceRegisterFile: string;
  ports: AppBrokerPorts;
  logDirectory?: string;
}

export interface AppBroker {
  stop: () => void;
  // What loaded and what was refused, for the Settings surface
  // (QGD-APP-0012) and for a suite to assert on.
  loaded: () => readonly LoadedApp[];
  refused: () => readonly { id: string | undefined; source: string; reason: string }[];
}

export async function startAppBroker(options: AppBrokerOptions): Promise<AppBroker> {
  const log = createLogger('apps', options.logDirectory);
  const register: GrantRegister = validateGrantRegister(
    JSON.parse(await readFile(options.grantRegisterFile, 'utf8')));
  const sources = await readSourceRegister(options.sourceRegisterFile);

  const result = loadApps(await readManifests(options.directories), register, options.ports.allowed());
  for (const entry of result.refused) {
    // QGD-APP-0011: a refusal is visible. An application that did not load is
    // said so, with the subject named.
    log.warn({ source: entry.source, subject: entry.subject }, entry.reason);
  }
  if (result.loaded.length > 0) {
    log.info({ apps: result.loaded.map(app => app.manifest.id) }, 'applications loaded');
  }

  // One object, shared by serving and by the inventory, holding the loaded
  // applications so the held grants stay current as requests arrive.
  const deps = {
    register, sources: sources.sources, ports: options.ports, log,
    apps: [...result.loaded], refused: result.refused
  };
  const serve = createServe(deps);

  const inventoryHandler = (event: Electron.IpcMainInvokeEvent, command: unknown): AppsReply => {
    if (!allowsSender(event.senderFrame, event.sender.mainFrame, event.senderFrame?.url)) {
      return { ok: false, error: 'That request did not come from the application window.' };
    }
    if (!validateAppsCommand(command)) return { ok: false, error: 'That is not a request this product serves.' };
    return { ok: true, inventory: buildInventory(deps) };
  };
  ipcMain.handle(APPS_INVENTORY_CHANNEL, inventoryHandler);

  const handler = async (event: Electron.IpcMainInvokeEvent, id: unknown, command: unknown): Promise<AppReply> => {
    if (!allowsSender(event.senderFrame, event.sender.mainFrame, event.senderFrame?.url)) {
      return refusal('That request did not come from the application window.');
    }
    return serve(id, command);
  };
  ipcMain.handle(APP_CHANNEL, handler);

  // Not vacuous: every kind the contract declares has a branch above. A kind
  // added to the contract with no branch falls through the switch and returns
  // undefined, which TypeScript catches — this asserts it at run time too, in
  // case the contract is widened without rebuilding this file.
  const unserved = REQUEST_KINDS.filter(kind => !['app.info', 'persona.list', 'source.fetch', 'service.request'].includes(kind));
  if (unserved.length > 0) log.error({ unserved }, 'the app API declares request kinds this broker does not serve');

  return {
    stop: () => { ipcMain.removeHandler(APP_CHANNEL); ipcMain.removeHandler(APPS_INVENTORY_CHANNEL); },
    loaded: () => deps.apps,
    refused: () => result.refused
  };
}
