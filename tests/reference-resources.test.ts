// SPDX-License-Identifier: GPL-3.0-only
// QGD-REF-0017: what Settings says about each reference resource.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { problemOf, summarize } from '../packages/storage/reference-resources.js';
import type { ReferenceStatus, RefreshOutcome } from '../packages/storage/reference.js';

const register = JSON.parse(readFileSync('data/reference-sources.json', 'utf8'));
const DAY = 86_400_000;
const NOW = Date.parse('2026-10-12T12:00:00Z');
const at = (ms: number) => new Date(ms).toISOString();
const loaded = (fetched: number, version?: string) =>
  ({ state: 'loaded', fetchedAt: at(fetched), rows: 1, contentSha256: 'x'.repeat(64), ...(version ? { version } : {}) }) as const;
const held = (potaFetched: number, adifVersion = register.adif.version): ReferenceStatus => ({
  adif: loaded(NOW - DAY, adifVersion),
  pota: { parks: loaded(potaFetched), programs: loaded(potaFetched), locations: loaded(potaFetched) }
}) as unknown as ReferenceStatus;
const pota = (status: ReferenceStatus, checks: Record<string, string | undefined> = {}, problems = new Map<string, string>()) =>
  summarize({ register, held: status, checks, problems, updating: undefined, now: NOW }).find(resource => resource.id === 'pota')!;

describe('QGD-REF-0017: out of date, measured from when a source last answered', () => {
  it('lists the register\'s resources in its order', () => {
    expect(summarize({ register, held: held(NOW), checks: {}, problems: new Map(), updating: 'adif', now: NOW })
      .map(resource => [resource.id, resource.updating])).toEqual([['adif', true], ['pota', false]]);
  });

  it('is out of date once the oldest fetch passes the refresh interval', () => {
    expect(pota(held(NOW - 2 * DAY)).due).toBe(true);
    expect(pota(held(NOW - 1000)).due).toBe(false);
  });

  it('is current again after an Update that found every list unchanged (a 304 is an answer)', () => {
    const checked = at(NOW - 1000);
    const summary = pota(held(NOW - 5 * DAY), { 'pota-parks': checked, 'pota-programs': checked, 'pota-locations': checked });
    expect(summary.due).toBe(false);
  });

  it('stays out of date while any one list has not answered', () => {
    const checked = at(NOW - 1000);
    expect(pota(held(NOW - 5 * DAY), { 'pota-parks': checked, 'pota-programs': checked }).due).toBe(true);
  });

  it('says ADIF is out of date when this release pins a newer version', () => {
    const adif = summarize({ register, held: held(NOW, '3.1.6'), checks: {}, problems: new Map(), updating: undefined, now: NOW })[0];
    expect(adif.due).toBe(true);
  });

  it('carries the last attempt\'s problem, and offers Update again', () => {
    const summary = pota(held(NOW - 1000), {}, new Map([['pota', 'Could not be reached.']]));
    expect(summary.problem).toBe('Could not be reached.');
    expect(summary.due).toBe(true);
  });

  it('never calls a resource that was never loaded out of date', () => {
    const none = { adif: { state: 'not loaded' }, pota: { parks: { state: 'not loaded' }, programs: { state: 'not loaded' }, locations: { state: 'not loaded' } } } as unknown as ReferenceStatus;
    for (const resource of summarize({ register, held: none, checks: {}, problems: new Map(), updating: undefined, now: NOW })) {
      expect(resource.state).toBe('not loaded');
      expect(resource.due).toBe(false);
    }
  });
});

describe('the last attempt\'s problem, in words a person can act on', () => {
  const base = { adif: { state: 'current' }, pota: { parks: { state: 'loaded' }, programs: { state: 'loaded' }, locations: { state: 'loaded' } }, built: true, status: {} } as unknown as RefreshOutcome;
  it('is none when it worked', () => { expect(problemOf('pota', base)).toBeUndefined(); });
  it('names the source that could not be reached', () => {
    const outcome = { ...base, pota: { ...base.pota, programs: { state: 'kept', failure: { kind: 'fetch' } } } } as unknown as RefreshOutcome;
    expect(problemOf('pota', outcome)).toMatch(/could not be reached/i);
    expect(problemOf('adif', outcome)).toBeUndefined();
  });
  it('says which other resource to update when the build was deferred', () => {
    expect(problemOf('pota', { ...base, deferred: true } as RefreshOutcome)).toMatch(/Update ADIF definitions/);
  });
});
