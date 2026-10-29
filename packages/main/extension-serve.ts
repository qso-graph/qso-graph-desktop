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
  RequestError, validateRequest, type ExtensionReply, type ExtensionRequest, type ActivationPark, type NearPark, type PotaPlace, type AdifBand, type AdifEntry, type AdifList, type CallsignBrief, type StationBrief
} from '../extension-api/api-contract.js';
import {
  extensionInfo, decide, withGrants, type AllowedGrants, type LoadedExtension
} from './extension-runtime.js';
import { findGrant, type GrantRegister } from '../extension-api/grants.js';
import type { ExtensionInventory } from './extensions-contract.js';
import type { IntegrationEvent } from '../extension-api/integration-events.js';

// What serving needs from the rest of the core, injected rather than
// imported, so the path can be exercised without a window, a credential core
// or a network.
export interface ExtensionBrokerPorts {
  // The grants the operator has allowed, read from the settings file
  // (QGD-ENG-0003: simple settings live there, so this answers before the
  // engine is up).
  allowed: () => AllowedGrants;
  // The callsigns, metadata only — id, call and description, never a
  // credential (QGD-CRD-0010).
  callsigns: () => Promise<readonly CallsignBrief[]>;
  // Fetch a registered source. The URL is resolved by the caller from the
  // register and the connection is the credential core's (QGD-APP-0008, D-18,
  // D-31).
  // The active callsign, or none (QGD-CRD-0010).
  activeCallsign: () => Promise<CallsignBrief | null>;
  // The active station: name, grid and position only, never its address
  // (QGD-STN-0003).
  activeStation: () => Promise<StationBrief | null>;
  // ADIF's definitions searched by the frame (reference:read).
  adifSearch: (query: string) => Promise<readonly AdifEntry[]>;
  adifList: (name: string) => Promise<AdifList | null>;
  adifBands: () => Promise<readonly AdifBand[]>;
  area: () => Promise<readonly string[]>;
  // My Area's parks with their activations, from reference data (QGD-REF-0019).
  potaPlaces: (locations: readonly string[]) => Promise<readonly PotaPlace[]>;
  potaNear: () => Promise<{ parks: readonly NearPark[]; home?: PotaPlace }>;
  potaActivations: () => Promise<{ parks: readonly ActivationPark[]; fetchedAt: string; locations: readonly string[]; home?: PotaPlace }>;
  fetchSource: (url: string) => Promise<{ body: string; fresh: boolean }>;
  // Act with a credential and return the answer. The secret does not come
  // back (QGD-APP-0007).
  callService: (
    service: string, callsign: string, operation: string, parameters: Readonly<Record<string, string>>
  ) => Promise<Readonly<Record<string, string>>>;
  // An adapter's events, checked, for the consumers that are on; how many
  // they went to (QGD-INT-0021). The adapter's id is the channel's, never
  // the extension's word.
  integrationEvents: (adapter: string, events: readonly IntegrationEvent[], malformed: number) => number;
  // An adapter's one reply, to a sender it heard (QGD-INT-0009); a sentence
  // when it is refused.
  integrationReply: (adapter: string, to: string, bytes: Uint8Array) => Promise<string | undefined>;
  // A live page of this extension's changed: asked again if it is open.
  pageChanged: (extension: string, page: string) => void;
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
        case 'callsign.list':
          return { ok: true, kind: 'callsign.list', callsigns: await deps.ports.callsigns() };
        case 'callsign.active':
          return { ok: true, kind: 'callsign.active', callsign: await deps.ports.activeCallsign() };
        case 'station.active':
          return { ok: true, kind: 'station.active', station: await deps.ports.activeStation() };
        case 'adif.search':
          return { ok: true, kind: 'adif.search', entries: await deps.ports.adifSearch(request.query) };
        case 'adif.list':
          return { ok: true, kind: 'adif.list', list: await deps.ports.adifList(request.name) };
        case 'adif.bands':
          return { ok: true, kind: 'adif.bands', bands: await deps.ports.adifBands() };
        case 'area.get':
          return { ok: true, kind: 'area.get', locations: await deps.ports.area() };
        case 'pota.near': {
          const { parks, home } = await deps.ports.potaNear();
          return { ok: true, kind: 'pota.near', parks, ...(home ? { home } : {}) };
        }
        case 'pota.places':
          return { ok: true, kind: 'pota.places', places: await deps.ports.potaPlaces(request.locations) };
        case 'pota.activations': {
          const { parks, fetchedAt, locations, home } = await deps.ports.potaActivations();
          return { ok: true, kind: 'pota.activations', parks, fetchedAt, locations, ...(home ? { home } : {}) };
        }
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
            request.service, request.callsign, request.operation, request.parameters);
          return { ok: true, kind: 'service.request', answer };
        }
        case 'integration.events':
          return { ok: true, kind: 'integration.events', consumers: deps.ports.integrationEvents(id, request.events, request.malformed ?? 0) };
        case 'integration.reply': {
          const refused = await deps.ports.integrationReply(id, request.to, Buffer.from(request.bytes, 'base64'));
          return refused === undefined ? { ok: true, kind: 'integration.reply' } : refusal(refused);
        }
        case 'page.changed': {
          // Its own page, and a live one: any other is not its to announce.
          const page = extension.manifest.contributes.pages.find(entry => entry.id === request.page);
          if (!page?.live) return refusal(`"${request.page}" is not a live page of this extension.`);
          deps.ports.pageChanged(id, page.id);
          return { ok: true, kind: 'page.changed' };
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

// `off` is the operator's list of extensions turned off (QGD-HOM-0007).
export function buildInventory(deps: ServeDeps, off: readonly string[] = []): ExtensionInventory {
  const allowed = deps.ports.allowed();
  return {
    extensions: deps.extensions.map(entry => {
      const extension = withGrants(entry, deps.register, allowed);
      const { id, name, tier, version } = extension.manifest;
      return {
        id, name, tier, version,
        pages: extension.manifest.contributes.pages.map(page => page.name),
        enabled: !off.includes(id),
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
    // A reason can quote what a manifest held, markup and all: made plain and
    // bounded here, as the window's check requires, so one bad manifest
    // cannot cost Settings the whole list (Codex review, 2026-10-23).
    refused: deps.refused.map(entry => ({
      source: entry.source,
      reason: entry.reason.replace(/[<>]/g, '').slice(0, 400).trim() || 'It could not be loaded.'
    }))
  };
}
