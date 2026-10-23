// SPDX-License-Identifier: GPL-3.0-only
// On the Air: QSO Graph Desktop's built-in extension for Home's pages about
// what is happening on the air now (QGD-HOM-0007).
//
// It runs in the extension host (QGD-APP-0015) and reaches the core only
// through `context` (QGD-APP-0002): NOAA's data is fetched by the core from
// the sources the register names. The core decides when each page is asked
// for (QGD-HOM-0005); this module only answers. Your station, its other page,
// was retired on 2026-10-22 (KI7MT): the header carries the clock and the
// status bar the callsign and location (QGD-FRM-0014); sunrise and sunset
// move to the Astro extension.
import type { ExtensionContext } from '../../../packages/extension-api/context.js';
import type { PageAnswer } from '../../../packages/extension-api/pages.js';
import { conditionsPage, parseConditions } from './conditions.js';
import { parksPage, parseSpots } from './parks.js';
import { activatePage } from './activate.js';

const UNREACHABLE: PageAnswer = { ok: false, reason: 'NOAA could not be reached just now.' };
const UNREADABLE: PageAnswer = { ok: false, reason: "NOAA's data could not be read just now." };

async function fetchBody(context: ExtensionContext, source: string, signal: AbortSignal): Promise<string | undefined> {
  const reply = await context.request({ kind: 'source.fetch', source }, { signal });
  return reply.ok && reply.kind === 'source.fetch' ? reply.body : undefined;
}

export function activate(context: ExtensionContext): void {
  context.subscriptions.push(context.pages.register('conditions', async ({ signal }) => {
    const [flux, kp, scales] = await Promise.all(
      ['noaa-flux', 'noaa-kp', 'noaa-scales'].map(source => fetchBody(context, source, signal)));
    if (flux === undefined || kp === undefined || scales === undefined) return UNREACHABLE;
    const conditions = parseConditions({ flux, kp, scales });
    return conditions ? conditionsPage(conditions) : UNREADABLE;
  }));
  // Parks On the Air (QGD-HOM-0011): POTA's spots, once a minute while the
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
    return parksPage(spots, new Date(), reply.ok && reply.kind === 'adif.bands' ? reply.bands : [],
      area.ok && area.kind === 'area.get' ? area.locations : []);
  }));
  // Parks Near Me (QGD-HOM-0013): My Area's parks with their activation
  // counts, from reference data on this computer, so it works at camp.
  context.subscriptions.push(context.pages.register('activate', async ({ signal }) => {
    const found = await context.request({ kind: 'pota.activations' }, { signal });
    if (!found.ok) return { ok: false, reason: found.error };
    if (found.kind !== 'pota.activations') return { ok: false, reason: 'POTA activations could not be read just now.' };
    const station = await context.request({ kind: 'station.active' }, { signal });
    return activatePage(found.parks, found.fetchedAt, station.ok && station.kind === 'station.active' ? station.station : null, found.locations);
  }));
}
