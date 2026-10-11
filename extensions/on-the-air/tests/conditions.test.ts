// SPDX-License-Identifier: GPL-3.0-only
// P8-conditions: Conditions reports what solar-mcp reports for the same
// recorded NOAA responses (QGD-HOM-0008). tests/fixtures/noaa/README.md says
// where the files and the expected answers came from.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateCardAnswer } from '../../../packages/extension-api/cards.js';
import { bandOutlook, conditionsCard, parseConditions } from '../src/conditions.js';

const fixture = (name: string, file: string) => readFileSync(`tests/fixtures/noaa/${name}/${file}`, 'utf8');
const bodies = (name: string) => ({ flux: fixture(name, '10cm-flux.json'), kp: fixture(name, 'noaa-planetary-k-index.json'), scales: fixture(name, 'noaa-scales.json') });
const expected = (name: string) => JSON.parse(fixture(name, 'expected.json'));
// solar-mcp prefixes only a "0" scale; the card prefixes every level.
const prefixed = (scale: string, letter: string) => (/^\d$/.test(scale) ? `${letter}${scale}` : scale);

describe('P8-conditions: the same answers as solar-mcp (QGD-HOM-0008)', () => {
  for (const name of ['quiet', 'storm']) {
    it(`reads the ${name} responses as solar-mcp does`, () => {
      const want = expected(name);
      const got = parseConditions(bodies(name));
      expect(got).toBeDefined();
      expect(got!.sfi).toBe(want.sfi);
      expect(got!.kp).toBe(want.kp);
      expect(got!.scales).toEqual({ R: prefixed(want.noaa_r_scale, 'R'), S: prefixed(want.noaa_s_scale, 'S'), G: prefixed(want.noaa_g_scale, 'G') });
      expect(got!.bands).toEqual(want.bands);
    });
  }

  it('draws a card that passes the core\'s own check, with no alert on a quiet day', () => {
    const card = validateCardAnswer(conditionsCard(parseConditions(bodies('quiet'))!));
    expect(card.ok).toBe(true);
    if (!card.ok) return;
    expect(card.data.sections.map(section => section.shape)).toEqual(['figures', 'items']);
    expect(card.data.observedAt).toMatch(/^2026-10-1\dT\d{2}:\d{2}:\d{2}Z$/);
  });

  it('leads with a warning when a storm is declared', () => {
    const card = validateCardAnswer(conditionsCard(parseConditions(bodies('storm'))!));
    if (!card.ok) throw new Error('expected a card');
    expect(card.data.sections[0]).toEqual({ shape: 'alert', level: 'warning', text: 'G2 geomagnetic storm (moderate).' });
  });

  it('calls a strong storm severe', () => {
    const conditions = { ...parseConditions(bodies('storm'))!, scales: { R: 'R3', S: 'S0', G: 'G2' }, scaleText: { R: 'strong', S: '', G: 'moderate' } };
    const card = conditionsCard(conditions);
    if (!card.ok) throw new Error('expected a card');
    expect(card.data.sections[0]).toMatchObject({ shape: 'alert', level: 'severe' });
  });

  it('keeps what worked when one feed has no usable value, as solar-mcp does, and has no outlook without both', () => {
    const noFlux = parseConditions({ ...bodies('quiet'), flux: '[{"flux":0}]' })!;
    expect(noFlux.sfi).toBeUndefined();
    expect(noFlux.kp).toBe(1.67);
    expect(noFlux.bands).toBeUndefined();
    const card = validateCardAnswer(conditionsCard(noFlux));
    if (!card.ok) throw new Error('expected a card');
    expect(JSON.stringify(card)).toContain('"label":"Solar flux","value":"not read"');
    expect(card.data.sections.some(section => section.shape === 'items')).toBe(false);
    // Neither feed: no conditions at all.
    expect(parseConditions({ ...bodies('quiet'), flux: 'not json', kp: '[]' })).toBeUndefined();
  });

  it('treats NOAA\'s -9999 as no value, as solar-mcp does', () => {
    const kp = JSON.parse(bodies('quiet').kp);
    kp[kp.length - 1].Kp = -9999;
    expect(parseConditions({ ...bodies('quiet'), kp: JSON.stringify(kp) })!.kp).toBeUndefined();
  });

  it('dates the card by the oldest feed it rests on', () => {
    const got = parseConditions(bodies('quiet'))!;
    const kp = JSON.parse(bodies('quiet').kp);
    expect(got.observedAt).toBe(`${kp[kp.length - 1].time_tag}Z`);
  });

  it('strips the NUL padding NOAA sometimes sends, as solar-mcp does', () => {
    expect(parseConditions({ ...bodies('quiet'), flux: `${bodies('quiet').flux}\0\0` })!.sfi).toBe(122);
  });

  it('refuses a time that does not exist rather than inventing one', () => {
    const flux = JSON.stringify([{ flux: 122, time_tag: '2026-02-30T21:00:00' }]);
    const kp = JSON.stringify([{ time_tag: '2026-02-30T21:00:00', Kp: 2 }, { time_tag: '2026-02-30T21:00:00', Kp: 2 }]);
    expect(parseConditions({ ...bodies('quiet'), flux, kp })).toBeUndefined();
  });

  it('does not show a reading it cannot date, rather than let it borrow another feed\'s time', () => {
    const kp = JSON.parse(bodies('quiet').kp);
    kp[kp.length - 1].time_tag = '2026-02-30T21:00:00';
    const got = parseConditions({ ...bodies('quiet'), kp: JSON.stringify(kp) })!;
    expect(got.kp).toBeUndefined();
    expect(got.bands).toBeUndefined();
    expect(got.observedAt).toBe('2026-10-11T20:00:00Z');
  });

  it('refuses a scale filed under the wrong letter', () => {
    const scales = JSON.parse(bodies('quiet').scales);
    scales['0'].R.Scale = 'S3';
    const got = parseConditions({ ...bodies('quiet'), scales: JSON.stringify(scales) })!;
    expect(got.scales.R).toBe('unknown');
    const card = conditionsCard(got);
    expect(JSON.stringify(card)).not.toContain('radio blackout');
  });

  it('keeps solar-mcp\'s band table at its boundaries', () => {
    expect(bandOutlook(70, 1)['15m']).toMatch(/^Poor/);
    expect(bandOutlook(90, 1)['15m']).toMatch(/^Fair/);
    expect(bandOutlook(120, 1)['15m']).toMatch(/^Good/);
    expect(bandOutlook(150, 1)['15m']).toMatch(/^Excellent/);
    expect(bandOutlook(150, 4)['80m']).toMatch(/^Fair/);
  });
});
