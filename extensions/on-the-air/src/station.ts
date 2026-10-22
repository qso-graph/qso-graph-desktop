// SPDX-License-Identifier: GPL-3.0-only
// Your station (QGD-HOM-0009): UTC first, because ham radio is talked about in
// UTC, then local time, the callsign being operated as, the active station,
// and sunrise and sunset there, on the operator's local clock.
//
// Pure: a clock, a persona and a station in, a card answer out. No network:
// the sun is worked out here (sun.ts) from the station's position, which the
// core gives as decimal degrees and never with the station's address.
import type { CardAnswer, Figure } from '../../../packages/extension-api/cards.js';
import type { PersonaBrief, StationBrief } from '../../../packages/extension-api/api-contract.js';
import { sunDay } from './sun.js';

const two = (value: number) => String(value).padStart(2, '0');
const utc = (time: Date) => `${two(time.getUTCHours())}:${two(time.getUTCMinutes())}`;
// Sunrise and sunset are read on the operator's own clock, the computer's
// local time, as the Local figure is: at home, portable or at a park the
// computer is where the operator is; operating remote, the events are still
// the station's, read on the clock in front of them (KI7MT, 2026-10-22: UTC
// made no sense for these).
const local = (time: Date) => `${two(time.getHours())}:${two(time.getMinutes())}`;

export function stationCard(now: Date, persona: PersonaBrief | null, station: StationBrief | null): CardAnswer {
  const observedAt = new Date(Math.floor(now.getTime() / 60_000) * 60_000).toISOString().replace('.000Z', 'Z');
  const figures: Figure[] = [
    { label: 'UTC', value: utc(now) },
    { label: 'Local', value: local(now) }
  ];
  let sunNote: string | undefined;
  if (station && station.latitude !== undefined && station.longitude !== undefined) {
    const day = sunDay(now, station.latitude, station.longitude);
    if (day.sunrise) figures.push({ label: 'Sunrise', value: local(day.sunrise), unit: 'local' });
    if (day.sunset) figures.push({ label: 'Sunset', value: local(day.sunset), unit: 'local' });
    if (day.allDay) sunNote = day.allDay === 'up' ? 'The sun does not set there today.' : 'The sun does not rise there today.';
  } else if (station) {
    sunNote = 'Sunrise and sunset need the station\'s grid. Add it in Stations.';
  }
  return {
    ok: true,
    data: {
      version: 1,
      observedAt,
      sections: [
        { shape: 'figures', figures },
        { shape: 'items', items: [
          persona
            ? { title: 'Operating as', detail: persona.callsign }
            : { title: 'Operating as', detail: 'No persona is active yet.' },
          station
            ? { title: 'Station', detail: station.grid ? `${station.name} · ${station.grid}` : station.name }
            : { title: 'Station', detail: 'No station is active. Choose one in Stations.' },
          ...(sunNote ? [{ title: 'Sun', detail: sunNote }] : [])
        ] }
      ]
    }
  };
}
