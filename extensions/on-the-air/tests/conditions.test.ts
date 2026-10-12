// SPDX-License-Identifier: GPL-3.0-only
// P8-conditions: Conditions reports what solar-mcp reports for the same
// recorded NOAA responses (QGD-HOM-0008). tests/fixtures/noaa/README.md says
// where the files and the expected answers came from.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateCardAnswer } from '../../../packages/extension-api/cards.js';
import { bandOutlook, conditionsCard, parseConditions } from '../src/conditions.js';

const fixture = (name: string, file: string) => readFileSync(`tests/fixtures/noaa/${name}/${file}`, 'utf8');
const bodies = (name: string) => ({ flux: fixture(name, '10cm-flux.json'), kp: fixture(name, 'noaa-planetary-k-index.json'), scales: fixture(name, 'noaa-scales.json') });
const expected = (name: string) => JSON.parse(fixture(name, 'expected.json'));
// The recorded responses, pinned. solar-mcp checks the same files against these
// sums from its side (solar-mcp tests/test_fixtures_noaa.py), so either side
// changing them fails a test on both.
const PINNED: Record<string, string> = {
  'quiet/10cm-flux.json': '2138583f6f96a59ab0c9f43cfec454b0cd844cccfaa36c1f3631c2d413d20858',
  'storm/10cm-flux.json': '47463078883fd10daee99f72e16d6ee2cf29cf974f8a35133ce4c5443be4a0ce',
  'quiet/noaa-planetary-k-index.json': '9eb4122adc5d795965b528c70a766cfaab2f4f389d9364bccdf0bb22a0fdd239',
  'storm/noaa-planetary-k-index.json': 'ea45dc16d611a72645a1a2a39297e0c8bfa4e2c417235e311bb4c9c7264460cb',
  'quiet/noaa-scales.json': '62c3233ad19470a76e19c9205b02419c3d7340e2f8205373d10b24621576d4c4',
  'storm/noaa-scales.json': 'f2d1b143dc4d726c0ff35a745ba9f64e4e775d20c07d54753c0879fc04539b79',
};

describe('P8-conditions: the same answers as solar-mcp (QGD-HOM-0008)', () => {
  for (const name of ['quiet', 'storm']) {
    it(`reads the ${name} responses as solar-mcp does`, () => {
      const want = expected(name);
      const got = parseConditions(bodies(name));
      expect(got).toBeDefined();
      expect(got!.sfi).toBe(want.sfi);
      expect(got!.kp).toBe(want.kp);
      // Exactly as solar-mcp reports them: since solar-mcp 0.3.0 both prefix
      // every level, so a storm reads G2 on both sides.
      expect(got!.scales).toEqual({ R: want.noaa_r_scale, S: want.noaa_s_scale, G: want.noaa_g_scale });
      expect(got!.bands).toEqual(want.bands);
    });
  }

  it('reads exactly the recorded responses solar-mcp reads', () => {
    for (const [path, digest] of Object.entries(PINNED)) {
      expect(createHash('sha256').update(readFileSync(`tests/fixtures/noaa/${path}`)).digest('hex'), path).toBe(digest);
    }
  });

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
