// SPDX-License-Identifier: GPL-3.0-only
// Serving one application request, and answering what loaded.
//
// Split out of extension-broker.ts, which imports Electron's `ipcMain` at module
// scope — so nothing behind that import can be reached by a unit test. The
// same reason extension-runtime.ts exists: a decision that needs a window, a
// credential core and a network to exercise is a decision that gets tested
// once.
//
// What this file makes testable is the seam rather than the decision.
// extension-runtime.ts answers *whether* a request is allowed; this answers what
// happens either way — that the allowed grants are read again on every
// request so a withdrawal needs no restart (`QGD-APP-0012`), that a permitted
// request reaches the one port it names and no other, and that a refused one
// reaches none of them.
//
// Those three were proven end to end by the proof extensions until
// 2026-10-10. They are proven here now, and the end-to-end demonstration is
// the first application that does ham work (`QGD-APP-0014`).
import {
  RequestError, validateRequest, type ExtensionReply, type ExtensionRequest, type PersonaBrief
} from '../extension-api/api-contract.js';
import {
  extensionInfo, decide, withGrants, type AllowedGrants, type LoadedExtension
} from './extension-runtime.js';
import { findGrant, type GrantRegister } from '../extension-api/grants.js';
import type { ExtensionInventory } from './extensions-contract.js';

// What serving needs from the rest of the core, injected rather than
// imported, so the path can be exercised without a window, a credential core
// or a network.
export interface ExtensionBrokerPorts {
  // The grants the operator has allowed, read from the settings file
  // (QGD-ENG-0003: simple settings live there, so this answers before the
  // engine is up).
  allowed: () => AllowedGrants;
  // Personas, metadata only — callsign and name, never a credential
  // (QGD-CRD-0010).
  personas: () => Promise<readonly PersonaBrief[]>;
  // Fetch a registered source. The URL is resolved by the caller from the
  // register and the connection is the credential core's (QGD-APP-0008, D-18,
  // D-31).
  fetchSource: (url: string) => Promise<{ body: string; fresh: boolean }>;
  // Act with a credential and return the answer. The secret does not come
  // back (QGD-APP-0007).
  callService: (
    service: string, persona: string, operation: string, parameters: Readonly<Record<string, string>>
  ) => Promise<Readonly<Record<string, string>>>;
}

// Only what is used, so a test can pass a recorder instead of the real logger.
export interface ServeLog {
  warn: (fields: Record<string, unknown>, message: string) => void;
}

export interface ServeDeps {
  readonly register: GrantRegister;
  readonly sources: Readonly<Record<string, string>>;
  readonly ports: ExtensionBrokerPorts;
  readonly log: ServeLog;
  // Held by the caller because the held grants are refreshed in place as
  // requests arrive. Correctness does not depend on that — withGrants is
  // computed fresh from `allowed()` every time — but it is kept rather than
  // changed, because a refactor that also changes behaviour is two changes
  // reported as one.
  extensions: LoadedExtension[];
  readonly refused: readonly { id: string | undefined; source: string; reason: string }[];
}

export const refusal = (error: string, refused?: string): ExtensionReply =>
  refused === undefined ? { ok: false, error } : { ok: false, error, refused };

export function createServe(deps: ServeDeps) {
  return async function serve(id: unknown, command: unknown): Promise<ExtensionReply> {
    if (typeof id !== 'string') return refusal('No application was named.');
    // Re-read the allowed grants on every request, so a withdrawal takes
    // effect without a restart (QGD-APP-0012).
    const allowed = deps.ports.allowed();
    const found = deps.extensions.find(extension => extension.manifest.id === id);
    if (!found) return refusal(`"${id}" is not a loaded application.`);
    const extension = withGrants(found, deps.register, allowed);
    deps.extensions = deps.extensions.map(entry => (entry.manifest.id === id ? extension : entry));

    let request: ExtensionRequest;
    try {
      request = validateRequest(command);
    } catch (error) {
      const field = error instanceof RequestError ? error.field : undefined;
      return refusal(`That request was refused: ${(error as Error).message}.${field ? ` (${field})` : ''}`);
    }

    const decision = decide(extension, request, deps.register);
    if (!decision.allowed) {
      // Logged as well as returned: the operator is told, and there is a
      // record of what asked for what (QGD-APP-0011).
      deps.log.warn({ extension: id, refused: decision.refused, kind: request.kind }, decision.why);
      return refusal(decision.why, decision.refused);
    }

    try {
      switch (request.kind) {
        case 'extension.info':
          return { ok: true, kind: 'extension.info', info: extensionInfo(extension) };
        case 'persona.list':
          return { ok: true, kind: 'persona.list', personas: await deps.ports.personas() };
        case 'source.fetch': {
          const url = deps.sources[request.source];
          // Decided already by the grant check — a source nobody registered
          // has no grant — so reaching here with no URL would be a register
          // that changed under a loaded application.
          if (url === undefined) return refusal(`"${request.source}" is not a registered source.`);
          const answer = await deps.ports.fetchSource(url);
          return { ok: true, kind: 'source.fetch', body: answer.body, fresh: answer.fresh };
        }
        case 'service.request': {
          const answer = await deps.ports.callService(
            request.service, request.persona, request.operation, request.parameters);
          return { ok: true, kind: 'service.request', answer };
        }
      }
    } catch (error) {
      // The message only. A thrown error from a service call is the one place
      // a secret could ride out in a stack (QGD-CRD-0006).
      const why = error instanceof Error ? error.message : 'That could not be done.';
      deps.log.warn({ extension: id, kind: request.kind }, why);
      return refusal(why);
    }
  };
}

export function buildInventory(deps: ServeDeps): ExtensionInventory {
  const allowed = deps.ports.allowed();
  return {
    extensions: deps.extensions.map(entry => {
      const extension = withGrants(entry, deps.register, allowed);
      const { id, name, tier, version } = extension.manifest;
      return {
        id, name, tier, version,
        grants: extension.manifest.grants.map(grantId => {
          const grant = findGrant(deps.register, grantId);
          return {
            id: grantId,
            what: grant?.what ?? 'This capability is no longer one this product defines.',
            ...(grant?.notWhat === undefined ? {} : { notWhat: grant.notWhat }),
            needsOperator: grant?.needsOperator ?? true,
            held: extension.held.includes(grantId)
          };
        })
      };
    }),
    refused: deps.refused.map(entry => ({ source: entry.source, reason: entry.reason }))
  };
}
