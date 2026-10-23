// SPDX-License-Identifier: GPL-3.0-only
// Parks On the Air (QGD-HOM-0011), against a made-up spot list in POTA's
// shape (tests/fixtures/pota), checked by the core's own validator.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validatePageAnswer } from '../../../packages/extension-api/pages.js';
import { frequencyText, parksPage, parseSpots } from '../src/parks.js';

const body = readFileSync('tests/fixtures/pota/activator.json', 'utf8');
const NOW = new Date('2026-10-11T19:00:00Z');

describe('Parks On the Air', () => {
  it('reads POTA\'s spots, and leaves out one with no call, no frequency, or marked invalid', () => {
    const spots = parseSpots(body)!;
    expect(spots.map(spot => spot.activator)).toEqual(['KI7MT', 'N0CALL/P', 'KI7MT/M']);
    expect(spots[1]).toMatchObject({ reference: 'CA-0002', kHz: 7185.5, mode: 'SSB', park: 'Made-up Park Two with brackets' });
  });

  it('refuses what is not a spot list, rather than drawing an empty one', () => {
    expect(parseSpots('<html>maintenance</html>')).toBeUndefined();
    expect(parseSpots('{"spots": []}')).toBeUndefined();
    expect(parseSpots('[]')).toEqual([]);
  });

  it('draws newest first, with the park\'s name, the frequency in MHz and the time in UTC', () => {
    const answer = validatePageAnswer(parksPage(parseSpots(body)!, NOW));
    if (!answer.ok) throw new Error('not ok');
    const table = answer.data.sections.find(section => section.shape === 'table');
    if (!table || table.shape !== 'table' || !('rows' in table)) throw new Error('no table');
    expect(table.columns).toEqual(['Activator', 'Park', 'Frequency', 'UTC']);
    expect(table.rows).toEqual([
      ['KI7MT', 'US-0001 Made-up Park One', '14.062 CW', '18:52'],
      ['KI7MT/M', 'GB-0003 Made-up Park Three', '28.074 FT8', '18:45'],
      ['N0CALL/P', 'CA-0002 Made-up Park Two with brackets', '7.186 SSB', '18:40']
    ]);
    expect(answer.data.observedAt).toBe('2026-10-11T18:52:00Z');
    expect(answer.data.sections[0]).toEqual({ shape: 'figures', figures: [{ label: 'Activators', value: '3' }, { label: 'Parks', value: '3' }] });
  });

  it('says so in words when no one is spotted', () => {
    expect(parksPage([], NOW)).toMatchObject({ ok: true, data: { sections: [{ shape: 'alert', text: expect.stringMatching(/No one is spotted/) }] } });
  });

  it('shows the newest 60, and says how many there were', () => {
    const many = Array.from({ length: 75 }, (_, i) => ({ activator: 'KI7MT', reference: `US-${String(i).padStart(4, '0')}`, kHz: 14062, at: new Date(NOW.getTime() - i * 60_000) }));
    const answer = validatePageAnswer(parksPage(many, NOW));
    if (!answer.ok) throw new Error('not ok');
    expect(answer.data.sections.at(-1)).toEqual({ shape: 'alert', level: 'info', text: 'The newest 60 of 75 spots are shown.' });
  });

  it('writes a frequency as a ham reads it off a spot', () => {
    expect(frequencyText({ activator: 'KI7MT', reference: 'US-0001', kHz: 3573, at: NOW, mode: 'FT8' })).toBe('3.573 FT8');
    expect(frequencyText({ activator: 'KI7MT', reference: 'US-0001', kHz: 50313, at: NOW })).toBe('50.313');
  });
});
