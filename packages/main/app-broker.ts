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
import { findGrant, validateGrantRegister, type GrantRegister } from '../app-api/grants.js';
import { validateAppsCommand, type AppInventory, type AppsReply } from './apps-contract.js';
import {
  REQUEST_KINDS, RequestError, validateRequest,
  type AppReply, type AppRequest, type PersonaBrief
} from '../app-api/api-contract.js';
import {
  appInfo, decide, loadApps, readManifests, readSourceRegister, withGrants,
  type AllowedGrants, type LoadedApp
} from './app-runtime.js';

export const APP_CHANNEL = 'app:request';
// A second channel, for the frame's own Settings surface rather than for an
// application (QGD-APP-0012). Separate because an application has no business
// enumerating the others: this one answers what loaded and what each holds.
export const APPS_INVENTORY_CHANNEL = 'apps:inventory';

// What the broker needs from the rest of the frame, injected rather than
// imported, so the decision path can be exercised without a window, a
// credential core or a network.
export interface AppBrokerPorts {
  // The grants the operator has allowed, read from the settings file
  // (QGD-ENG-0003: simple settings live there, so this answers before the
  // engine is up).
  allowed: () => AllowedGrants;
  // Personas, metadata only — callsign and name, never a credential
  // (QGD-CRD-0010).
  personas: () => Promise<readonly PersonaBrief[]>;
  // Fetch a registered source. The URL is resolved here from the register and
  // the connection is the credential core's (QGD-APP-0008, D-18, D-31).
  fetchSource: (url: string) => Promise<{ body: string; fresh: boolean }>;
  // Act with a credential and return the answer. The secret does not come
  // back (QGD-APP-0007).
  callService: (
    service: string, persona: string, operation: string, parameters: Readonly<Record<string, string>>
  ) => Promise<Readonly<Record<string, string>>>;
}

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
  let apps = [...result.loaded];

  const refusal = (error: string, refused?: string): AppReply =>
    refused === undefined ? { ok: false, error } : { ok: false, error, refused };

  async function serve(id: unknown, command: unknown): Promise<AppReply> {
    if (typeof id !== 'string') return refusal('No application was named.');
    // Re-read the allowed grants on every request, so a withdrawal takes
    // effect without a restart (QGD-APP-0012).
    const allowed = options.ports.allowed();
    const found = apps.find(app => app.manifest.id === id);
    if (!found) return refusal(`"${id}" is not a loaded application.`);
    const app = withGrants(found, register, allowed);
    apps = apps.map(entry => (entry.manifest.id === id ? app : entry));

    let request: AppRequest;
    try {
      request = validateRequest(command);
    } catch (error) {
      const field = error instanceof RequestError ? error.field : undefined;
      return refusal(`That request was refused: ${(error as Error).message}.${field ? ` (${field})` : ''}`);
    }

    const decision = decide(app, request, register);
    if (!decision.allowed) {
      // Logged as well as returned: the operator is told, and there is a
      // record of what asked for what (QGD-APP-0011).
      log.warn({ app: id, refused: decision.refused, kind: request.kind }, decision.why);
      return refusal(decision.why, decision.refused);
    }

    try {
      switch (request.kind) {
        case 'app.info':
          return { ok: true, kind: 'app.info', info: appInfo(app) };
        case 'persona.list':
          return { ok: true, kind: 'persona.list', personas: await options.ports.personas() };
        case 'source.fetch': {
          const url = sources.sources[request.source];
          // Decided already by the grant check — a source nobody registered
          // has no grant — so reaching here with no URL would be a register
          // that changed under a loaded application.
          if (url === undefined) return refusal(`"${request.source}" is not a registered source.`);
          const answer = await options.ports.fetchSource(url);
          return { ok: true, kind: 'source.fetch', body: answer.body, fresh: answer.fresh };
        }
        case 'service.request': {
          const answer = await options.ports.callService(
            request.service, request.persona, request.operation, request.parameters);
          return { ok: true, kind: 'service.request', answer };
        }
      }
    } catch (error) {
      // The message only. A thrown error from a service call is the one place
      // a secret could ride out in a stack (QGD-CRD-0006).
      const why = error instanceof Error ? error.message : 'That could not be done.';
      log.warn({ app: id, kind: request.kind }, why);
      return refusal(why);
    }
  }

  function inventory(): AppInventory {
    const allowed = options.ports.allowed();
    return {
      apps: apps.map(entry => {
        const app = withGrants(entry, register, allowed);
        const { id, name, tier, version } = app.manifest;
        return {
          id, name, tier, version,
          grants: app.manifest.grants.map(grantId => {
            const grant = findGrant(register, grantId);
            return {
              id: grantId,
              what: grant?.what ?? 'This capability is no longer one this product defines.',
              ...(grant?.notWhat === undefined ? {} : { notWhat: grant.notWhat }),
              needsOperator: grant?.needsOperator ?? true,
              held: app.held.includes(grantId)
            };
          })
        };
      }),
      refused: result.refused.map(entry => ({ source: entry.source, reason: entry.reason }))
    };
  }

  const inventoryHandler = (event: Electron.IpcMainInvokeEvent, command: unknown): AppsReply => {
    if (!allowsSender(event.senderFrame, event.sender.mainFrame, event.senderFrame?.url)) {
      return { ok: false, error: 'That request did not come from the application window.' };
    }
    if (!validateAppsCommand(command)) return { ok: false, error: 'That is not a request this product serves.' };
    return { ok: true, inventory: inventory() };
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
    loaded: () => apps,
    refused: () => result.refused
  };
}
