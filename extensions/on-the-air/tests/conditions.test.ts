// SPDX-License-Identifier: GPL-3.0-only
// P8-conditions: Conditions reports what solar-mcp reports for the same
// recorded NOAA responses (QGD-HOM-0008). tests/fixtures/noaa/README.md says
// where the files and the expected answers came from.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validatePageAnswer } from '../../../packages/extension-api/pages.js';
import { BAND_STATUSES, bandOutlook, conditionsPage, outlookRows, parseConditions } from '../src/conditions.js';

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
      expect(got!.a).toBe(want.a_index);
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

  it('draws a page that passes the core\'s own check, with no alert on a quiet day', () => {
    const page = validatePageAnswer(conditionsPage(parseConditions(bodies('quiet'))!));
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(page.data.sections.map(section => section.shape)).toEqual(['figures', 'table']);
    expect(page.data.observedAt).toMatch(/^2026-10-1\dT\d{2}:\d{2}:\d{2}Z$/);
  });

  it('shows the bands as Band | Status | Comment, every status on the scale (BAND-OUTLOOK.md)', () => {
    const page = validatePageAnswer(conditionsPage(parseConditions(bodies('quiet'))!));
    if (!page.ok) throw new Error('expected a page');
    const table = page.data.sections.find(section => section.shape === 'table');
    if (!table || table.shape !== 'table') throw new Error('no table');
    expect(table.columns).toEqual(['Band', 'Status', 'Comment']);
    expect(table.rows[0]).toEqual(['160m', 'Good', 'Quiet night conditions']);
    expect(table.rows.map(row => row[0])).toEqual(['160m', '80m', '40m', '30m', '20m', '17m', '15m', '12m', '10m', '6m']);
    // Each row is solar-mcp's own answer, split: status and comment rejoin to
    // exactly what solar-mcp 0.3.0 said for these files.
    const want = JSON.parse(readFileSync('tests/fixtures/noaa/quiet/expected.json', 'utf8')).bands as Record<string, string>;
    expect(table.rows).toEqual(outlookRows(want).map(row => [row.band, row.status, row.comment]));
    for (const [band, status, comment] of table.rows) {
      expect(want[band].toLowerCase()).toBe(`${status} — ${comment}`.toLowerCase());
    }
  });

  // Each band's rule in BAND-OUTLOOK.md, just below and at every threshold,
  // the same cases solar-mcp's tests hold it to.
  it.each([
    [100, 2.9, '160m', 'Good'],
    [100, 3.0, '160m', 'Fair'],
    [100, 4.9, '160m', 'Fair'],
    [100, 5.0, '160m', 'Poor'],
    [100, 3.9, '80m', 'Good'],
    [100, 4.0, '80m', 'Fair'],
    [100, 5.0, '80m', 'Poor'],
    [100, 4.9, '40m', 'Good'],
    [100, 5.0, '40m', 'Fair'],
    [60, 8.0, '30m', 'Good'],
    [99, 1.0, '20m', 'Fair'],
    [100, 1.0, '20m', 'Good'],
    [149, 1.0, '20m', 'Good'],
    [150, 1.0, '20m', 'Excellent'],
    [89, 1.0, '17m', 'Poor'],
    [90, 1.0, '17m', 'Fair'],
    [119, 1.0, '17m', 'Fair'],
    [120, 1.0, '17m', 'Good'],
    [79, 1.0, '15m', 'Poor'],
    [80, 1.0, '15m', 'Fair'],
    [99, 1.0, '15m', 'Fair'],
    [100, 1.0, '15m', 'Good'],
    [139, 1.0, '15m', 'Good'],
    [140, 1.0, '15m', 'Excellent'],
    [119, 1.0, '12m', 'Poor'],
    [120, 1.0, '12m', 'Fair'],
    [149, 1.0, '12m', 'Fair'],
    [150, 1.0, '12m', 'Good'],
    [99, 1.0, '10m', 'Poor'],
    [100, 1.0, '10m', 'Fair'],
    [129, 1.0, '10m', 'Fair'],
    [130, 1.0, '10m', 'Good'],
    [159, 1.0, '10m', 'Good'],
    [160, 1.0, '10m', 'Excellent'],
    [200, 0.0, '6m', 'Sporadic']
  ] as const)('SFI %d, K %d: %s is %s', (sfi, kp, band, status) => {
    expect(bandOutlook(sfi, kp)[band].split(' — ')[0]).toBe(status);
  });

  it('keeps a band\'s status in a storm and says so in the comment', () => {
    expect(bandOutlook(150, 5)['20m']).toBe('Excellent — degraded by geomagnetic storm');
    expect(bandOutlook(150, 4.9)['20m']).toBe('Excellent — strong F-layer, long openings');
  });

  it('grades every band, at every flux and K index, on the five words of the scale', () => {
    for (const sfi of [60, 85, 95, 110, 125, 135, 145, 155, 170]) {
      for (const kp of [0, 3, 4, 5, 8]) {
        const bands = bandOutlook(sfi, kp);
        const rows = outlookRows(bands);
        expect(rows.length, `SFI ${sfi}, K ${kp}`).toBe(Object.keys(bands).length);
        for (const row of rows) expect(BAND_STATUSES).toContain(row.status);
      }
    }
    expect(outlookRows({ '20m': 'Marvellous — no such word' })).toEqual([]);
  });

  it('leads with a warning when a storm is declared', () => {
    const page = validatePageAnswer(conditionsPage(parseConditions(bodies('storm'))!));
    if (!page.ok) throw new Error('expected a page');
    expect(page.data.sections[0]).toEqual({ shape: 'alert', level: 'warning', text: 'G2 geomagnetic storm (moderate).' });
  });

  it('calls a strong storm severe', () => {
    const conditions = { ...parseConditions(bodies('storm'))!, scales: { R: 'R3', S: 'S0', G: 'G2' }, scaleText: { R: 'strong', S: '', G: 'moderate' } };
    const page = conditionsPage(conditions);
    if (!page.ok) throw new Error('expected a page');
    expect(page.data.sections[0]).toMatchObject({ shape: 'alert', level: 'severe' });
  });

  it('keeps what worked when one feed has no usable value, as solar-mcp does, and has no outlook without both', () => {
    const noFlux = parseConditions({ ...bodies('quiet'), flux: '[{"flux":0}]' })!;
    expect(noFlux.sfi).toBeUndefined();
    expect(noFlux.kp).toBe(1.67);
    expect(noFlux.bands).toBeUndefined();
    const page = validatePageAnswer(conditionsPage(noFlux));
    if (!page.ok) throw new Error('expected a page');
    expect(JSON.stringify(page)).toContain('"label":"Solar flux","value":"not read"');
    expect(page.data.sections.some(section => section.shape === 'table')).toBe(false);
    // Neither feed: no conditions at all.
    expect(parseConditions({ ...bodies('quiet'), flux: 'not json', kp: '[]' })).toBeUndefined();
  });

  it('treats NOAA\'s -9999 as no value, as solar-mcp does', () => {
    const kp = JSON.parse(bodies('quiet').kp);
    kp[kp.length - 1].Kp = -9999;
    expect(parseConditions({ ...bodies('quiet'), kp: JSON.stringify(kp) })!.kp).toBeUndefined();
  });

  it('dates each reading by its own feed, and the page by the newest (KI7MT, 2026-10-22)', () => {
    const got = parseConditions(bodies('quiet'))!;
    // The recorded flux is the 20:00 daily reading; the K index's last row is 18:00.
    expect(got.sfiAt).toBe('2026-10-11T20:00:00Z');
    expect(got.kpAt).toBe('2026-10-11T18:00:00Z');
    expect(got.observedAt).toBe('2026-10-11T20:00:00Z');
    const page = validatePageAnswer(conditionsPage(got));
    if (!page.ok) throw new Error('expected a page');
    const figures = page.data.sections.find(section => section.shape === 'figures');
    if (!figures || figures.shape !== 'figures') throw new Error('no figures');
    expect(figures.figures.slice(0, 3).map(figure => [figure.label, figure.observedAt])).toEqual([
      ['Solar flux', got.sfiAt], ['K index', got.kpAt], ['A index', got.kpAt]
    ]);
    // The flux is the number alone (KI7MT, 2026-10-22).
    expect(figures.figures[0].unit).toBeUndefined();
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
    const page = conditionsPage(got);
    expect(JSON.stringify(page)).not.toContain('radio blackout');
  });

  it('keeps solar-mcp\'s band table at its boundaries', () => {
    expect(bandOutlook(70, 1)['15m']).toMatch(/^Poor/);
    expect(bandOutlook(90, 1)['15m']).toMatch(/^Fair/);
    expect(bandOutlook(120, 1)['15m']).toMatch(/^Good/);
    expect(bandOutlook(150, 1)['15m']).toMatch(/^Excellent/);
    expect(bandOutlook(150, 4)['80m']).toMatch(/^Fair/);
  });
});

describe('the A index, as solar-mcp reads it', () => {
  const flux = JSON.stringify([{ TimeStamp: '2026-10-11 20:00:00', Flux: 122 }]);
  const scales = JSON.stringify({ 0: { R: { Scale: '0' }, S: { Scale: '0' }, G: { Scale: '0' } } });
  it('reads a_running from the list format, where it is the fourth column', () => {
    const kp = JSON.stringify([['time_tag', 'Kp', 'Kp_fraction', 'a_running', 'station_count'], ['2026-10-11 18:00:00.000', '2.00', '2', '7', '8']]);
    expect(parseConditions({ flux, kp, scales })!.a).toBe(7);
  });
  it('keeps the K index and says the A index was not read when a row has none', () => {
    const kp = JSON.stringify([{ time_tag: '2026-10-11T15:00:00', Kp: 1.33 }, { time_tag: '2026-10-11T18:00:00', Kp: 1.67 }]);
    const got = parseConditions({ flux, kp, scales })!;
    expect(got.kp).toBe(1.67);
    expect(got.a).toBeUndefined();
    const figures = (conditionsPage(got) as { data: { sections: { shape: string; figures?: { label: string; value: string }[] }[] } }).data.sections
      .find(section => section.shape === 'figures')!.figures!;
    expect(figures.find(figure => figure.label === 'A index')!.value).toBe('not read');
  });
});

