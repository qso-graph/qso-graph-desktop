// SPDX-License-Identifier: GPL-3.0-only
// Parks On the Air: QSO Graph Desktop's built-in extension for POTA, one
// destination with three tabs (QGD-HOM-0003): Near Me, Spots and Most Wanted.
// Its own extension, so its switch in Settings turns off POTA and nothing
// else (KI7MT, 2026-10-23: "On switch, the lights go out").
//
// It runs in the extension host (QGD-APP-0015) and reaches the core only
// through `context` (QGD-APP-0002): POTA's spots are fetched by the core from
// the registered source, and the park list, the places and the activation
// counts are the core's to answer. The core decides when each page is asked
// for (QGD-HOM-0005); this module only answers.
import type { ExtensionContext } from '../../../packages/extension-api/context.js';
import type { PotaPlace } from '../../../packages/extension-api/api-contract.js';
import { parksPage, parseSpots } from './parks.js';
import { activatePage } from './activate.js';
import { nearPage } from './near.js';

async function fetchBody(context: ExtensionContext, source: string, signal: AbortSignal): Promise<string | undefined> {
  const reply = await context.request({ kind: 'source.fetch', source }, { signal });
  return reply.ok && reply.kind === 'source.fetch' ? reply.body : undefined;
}

// Each location's program and entity (pota.places), or none.
async function placesFor(context: ExtensionContext, locations: readonly string[], signal: AbortSignal): Promise<readonly PotaPlace[]> {
  const codes = [...new Set(locations.filter(code => /^[A-Z0-9]{1,4}-[A-Z0-9]{1,8}$/.test(code)))].slice(0, 1000);
  if (codes.length === 0) return [];
  const reply = await context.request({ kind: 'pota.places', locations: codes }, { signal });
  return reply.ok && reply.kind === 'pota.places' ? reply.places : [];
}

export function activate(context: ExtensionContext): void {
  // Spots (QGD-HOM-0011): POTA's spots, once a minute while the
  // page is open, which is as often as POTA's spot list changes in practice
  // and the same restraint pota-mcp records. POTA states no request limit.
  context.subscriptions.push(context.pages.register('parks', async ({ signal }) => {
    const body = await fetchBody(context, 'pota-spots', signal);
    if (body === undefined) return { ok: false, reason: 'POTA could not be reached just now.' };
    const spots = parseSpots(body);
    if (!spots) return { ok: false, reason: "POTA's spots could not be read just now." };
    // ADIF's bands name each spot's band; without them the page still shows
    // the spots, and says how to get the bands.
    const reply = await context.request({ kind: 'adif.bands' }, { signal });
    // My Area, so the page starts on the operator's own locations (KI7MT,
    // 2026-10-23). Without it, the page starts on All, as before.
    const area = await context.request({ kind: 'area.get' }, { signal });
    // Program and Entity by name, from POTA's lists when they are
    // downloaded; without them the page has no such filters.
    const places = await placesFor(context, spots.flatMap(spot => (spot.location ?? '').split(',').map(value => value.trim())), signal);
    return parksPage(spots, new Date(), reply.ok && reply.kind === 'adif.bands' ? reply.bands : [],
      area.ok && area.kind === 'area.get' ? area.locations : [], places);
  }));
  // Near Me (QGD-HOM-0013): the parks nearest the active Location, from
  // POTA's park list on this computer, so it works with no internet.
  context.subscriptions.push(context.pages.register('near', async ({ signal }) => {
    const found = await context.request({ kind: 'pota.near' }, { signal });
    if (!found.ok) return { ok: false, reason: found.error };
    if (found.kind !== 'pota.near') return { ok: false, reason: "POTA's parks could not be read just now." };
    const station = await context.request({ kind: 'station.active' }, { signal });
    const places = await placesFor(context, found.parks.flatMap(park => park.locations.split(',').map(value => value.trim())), signal);
    const minute = new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString().replace('.000Z', 'Z');
    return nearPage(found.parks, minute, station.ok && station.kind === 'station.active' ? station.station : null, places, found.home);
  }));
  // Most Wanted (QGD-HOM-0014): My Area's parks activated least, from POTA's
  // own counts, which only its API has, so the page needs the internet.
  context.subscriptions.push(context.pages.register('wanted', async ({ signal }) => {
    const found = await context.request({ kind: 'pota.activations' }, { signal });
    if (!found.ok) return { ok: false, reason: found.error };
    if (found.kind !== 'pota.activations') return { ok: false, reason: 'POTA activations could not be read just now.' };
    const station = await context.request({ kind: 'station.active' }, { signal });
    const places = await placesFor(context, found.parks.flatMap(park => park.locations.split(',').map(value => value.trim())), signal);
    return activatePage(found.parks, found.fetchedAt, station.ok && station.kind === 'station.active' ? station.station : null, found.locations, places, found.home);
  }));
}
