// SPDX-License-Identifier: GPL-3.0-only
// On the Air: QSO Graph Desktop's built-in extension for Home's cards about
// what is happening on the air now (QGD-HOM-0007).
//
// It runs in the extension host (QGD-APP-0015) and reaches the core only
// through `context` (QGD-APP-0002): NOAA's data is fetched by the core from
// the sources the register names, the persona comes from the API under the
// persona:list grant, and the active station under station:active. The core decides when each card is asked for
// (QGD-HOM-0005); this module only answers.
import type { ExtensionContext } from '../../../packages/extension-api/context.js';
import type { CardAnswer } from '../../../packages/extension-api/cards.js';
import { conditionsCard, parseConditions } from './conditions.js';
import { stationCard } from './station.js';

const UNREACHABLE: CardAnswer = { ok: false, reason: 'NOAA could not be reached just now.' };
const UNREADABLE: CardAnswer = { ok: false, reason: "NOAA's data could not be read just now." };

async function fetchBody(context: ExtensionContext, source: string, signal: AbortSignal): Promise<string | undefined> {
  const reply = await context.request({ kind: 'source.fetch', source }, { signal });
  return reply.ok && reply.kind === 'source.fetch' ? reply.body : undefined;
}

export function activate(context: ExtensionContext): void {
  context.subscriptions.push(context.cards.register('conditions', async ({ signal }) => {
    const [flux, kp, scales] = await Promise.all(
      ['noaa-flux', 'noaa-kp', 'noaa-scales'].map(source => fetchBody(context, source, signal)));
    if (flux === undefined || kp === undefined || scales === undefined) return UNREACHABLE;
    const conditions = parseConditions({ flux, kp, scales });
    return conditions ? conditionsCard(conditions) : UNREADABLE;
  }));

  context.subscriptions.push(context.cards.register('your-station', async ({ signal }) => {
    // Asked together: neither depends on the other, and a refusal of one
    // leaves the card drawing the rest.
    const [personaReply, stationReply] = await Promise.all([
      context.request({ kind: 'persona.active' }, { signal }),
      context.request({ kind: 'station.active' }, { signal })
    ]);
    const persona = personaReply.ok && personaReply.kind === 'persona.active' ? personaReply.persona : null;
    const station = stationReply.ok && stationReply.kind === 'station.active' ? stationReply.station : null;
    return stationCard(new Date(), persona, station);
  }));
}
