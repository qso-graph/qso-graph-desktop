// SPDX-License-Identifier: GPL-3.0-only
// P8-your-station: UTC first, local time, the callsign; with no persona it
// says so; and it needs no network (QGD-HOM-0009).
import { describe, expect, it } from 'vitest';
import { validateCardAnswer } from '../../../packages/extension-api/cards.js';
import { stationCard } from '../src/station.js';

describe('P8-your-station (QGD-HOM-0009)', () => {
  const now = new Date('2026-10-11T18:05:42Z');

  it('shows UTC first, then local time, then the callsign', () => {
    const card = validateCardAnswer(stationCard(now, { name: 'Home', callsign: 'W1AW' }));
    if (!card.ok) throw new Error('expected a card');
    const [figures, items] = card.data.sections;
    expect(figures).toMatchObject({ shape: 'figures' });
    if (figures.shape !== 'figures' || items.shape !== 'items') throw new Error('shapes');
    expect(figures.figures[0]).toEqual({ label: 'UTC', value: '18:05' });
    expect(figures.figures[1].label).toBe('Local');
    expect(items.items).toEqual([{ title: 'Operating as', detail: 'W1AW' }]);
    expect(card.data.observedAt).toBe('2026-10-11T18:05:00Z');
  });

  it('says so when no persona is active', () => {
    const card = stationCard(now, null);
    expect(JSON.stringify(card)).toContain('No persona is active yet.');
  });
});
