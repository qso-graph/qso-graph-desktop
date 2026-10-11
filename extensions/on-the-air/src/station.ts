// SPDX-License-Identifier: GPL-3.0-only
// Your station (QGD-HOM-0009): UTC first, because ham radio is talked about in
// UTC, then local time, then the callsign being operated as. Nothing about
// where the station is: that waits for Stations (qso-graph-desktop#36).
//
// Pure: a clock and a persona in, a card answer out. No network.
import type { CardAnswer } from '../../../packages/extension-api/cards.js';
import type { PersonaBrief } from '../../../packages/extension-api/api-contract.js';

const two = (value: number) => String(value).padStart(2, '0');

export function stationCard(now: Date, persona: PersonaBrief | null): CardAnswer {
  const observedAt = new Date(Math.floor(now.getTime() / 60_000) * 60_000).toISOString().replace('.000Z', 'Z');
  return {
    ok: true,
    data: {
      version: 1,
      observedAt,
      sections: [
        { shape: 'figures', figures: [
          { label: 'UTC', value: `${two(now.getUTCHours())}:${two(now.getUTCMinutes())}` },
          { label: 'Local', value: `${two(now.getHours())}:${two(now.getMinutes())}` }
        ] },
        { shape: 'items', items: [
          persona
            ? { title: 'Operating as', detail: persona.callsign }
            : { title: 'Operating as', detail: 'No persona is active yet.' }
        ] }
      ]
    }
  };
}
