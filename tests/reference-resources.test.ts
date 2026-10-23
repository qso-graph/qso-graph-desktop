// SPDX-License-Identifier: GPL-3.0-only
// QGD-REF-0017: what Settings says about each reference resource.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { problemOf, summarize } from '../packages/storage/reference-resources.js';
import { isStorageStatus } from '../packages/storage/storage-contract.js';
import { RESOURCES_ADIF_AVAILABLE, RESOURCES_LOADED, RESOURCES_NOT_LOADED } from '../packages/renderer/pages/reference-fixtures.js';
import type { ReferenceStatus, RefreshOutcome } from '../packages/storage/reference.js';

const register = JSON.parse(readFileSync('data/reference-sources.json', 'utf8'));
const DAY = 86_400_000;
const NOW = Date.parse('2026-10-12T12:00:00Z');
const at = (ms: number) => new Date(ms).toISOString();
const loaded = (fetched: number, version?: string) =>
  ({ state: 'loaded', fetchedAt: at(fetched), rows: 1, contentSha256: 'x'.repeat(64), ...(version ? { version } : {}) }) as const;
const held = (potaFetched: number, adifVersion = register.adif.version): ReferenceStatus => ({
  adif: loaded(NOW - DAY, adifVersion),
  pota: { parks: loaded(potaFetched), programs: loaded(potaFetched), locations: loaded(potaFetched) },
  sota: { summits: { state: 'not loaded' } },
  activations: {}
}) as unknown as ReferenceStatus;
const pota = (status: ReferenceStatus, checks: Record<string, string | undefined> = {}, problems = new Map<string, string>()) =>
  summarize({ register, held: status, checks, problems, updating: undefined, now: NOW }).find(resource => resource.id === 'pota')!;

describe('QGD-REF-0017: out of date, measured from when a source last answered', () => {
  it('lists the register\'s resources in its order', () => {
    expect(summarize({ register, held: held(NOW), checks: {}, problems: new Map(), updating: 'adif', now: NOW })
      .map(resource => [resource.id, resource.updating])).toEqual([['adif', true], ['pota', false], ['activations', false], ['sota', false]]);
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
});

describe('#37: Update is offered only when it could bring something new', () => {
  const adifOf = (version: string) =>
    summarize({ register, held: held(NOW, version), checks: {}, problems: new Map(), updating: undefined, now: NOW })[0];

  it('offers no ADIF Update while the installed version is the pinned one', () => {
    const adif = adifOf(register.adif.version);
    expect(adif.updatable).toBe(false);
    expect(adif.version).toBe(register.adif.version);
    expect(adif.available).toBeUndefined();
  });

  it('offers ADIF Update, and names the version, once the pinned version moves', () => {
    const moved = { ...register, adif: { ...register.adif, version: '9.9.9' } };
    const adif = summarize({ register: moved, held: held(NOW, register.adif.version), checks: {}, problems: new Map(), updating: undefined, now: NOW })[0];
    expect(adif.updatable).toBe(true);
    expect(adif.version).toBe(register.adif.version);
    expect(adif.available).toBe('9.9.9');
  });

  it('always offers POTA an Update once downloaded, as its lists change daily', () => {
    expect(pota(held(NOW - 1000)).updatable).toBe(true);
    expect(pota(held(NOW - 1000)).version).toBeUndefined();
  });

  it('carries the last attempt\'s problem, and offers Update again', () => {
    const summary = pota(held(NOW - 1000), {}, new Map([['pota', 'Could not be reached.']]));
    expect(summary.problem).toBe('Could not be reached.');
    expect(summary.due).toBe(true);
  });

  it('never calls a resource that was never loaded out of date', () => {
    const none = { adif: { state: 'not loaded' }, pota: { parks: { state: 'not loaded' }, programs: { state: 'not loaded' }, locations: { state: 'not loaded' } }, sota: { summits: { state: 'not loaded' } }, activations: {} } as unknown as ReferenceStatus;
    for (const resource of summarize({ register, held: none, checks: {}, problems: new Map(), updating: undefined, now: NOW })) {
      expect(resource.state).toBe('not loaded');
      expect(resource.due).toBe(false);
      expect(resource.updatable).toBe(false);
    }
  });
});

describe('the last attempt\'s problem, in words a person can act on', () => {
  const base = { adif: { state: 'current' }, pota: { parks: { state: 'loaded' }, programs: { state: 'loaded' }, locations: { state: 'loaded' } }, sota: { summits: { state: 'not asked' } }, activations: {}, built: true, status: {} } as unknown as RefreshOutcome;
  it('is none when it worked', () => { expect(problemOf('pota', base)).toBeUndefined(); });
  it('names the source that could not be reached', () => {
    const outcome = { ...base, pota: { ...base.pota, programs: { state: 'kept', failure: { kind: 'fetch' } } } } as unknown as RefreshOutcome;
    expect(problemOf('pota', outcome)).toMatch(/could not be reached/i);
    expect(problemOf('adif', outcome)).toBeUndefined();
  });
  it('says which other resource to update when the build was deferred', () => {
    expect(problemOf('pota', { ...base, deferred: true } as RefreshOutcome)).toMatch(/Download ADIF definitions/);
  });
});

describe('#37: the window checks the versions it is sent', () => {
  const status = (resources: unknown[]) => ({
    state: 'ready',
    reference: { adif: { state: 'loaded' }, parks: { state: 'loaded' }, programs: { state: 'loaded' }, locations: { state: 'loaded' }, summits: { state: 'not loaded' }, refreshing: false, resources }
  });
  // The register as shipped, through the window's own check, in every state
  // Settings can show it in. A size four words too long was refused, so no
  // status reached the window at all: Settings sat on "Reading the reference
  // data…" and every page waited on storage (KI7MT, 2026-10-23).
  it('passes every resource the register ships, as the window checks it', () => {
    for (const updating of [undefined, 'activations']) {
      const resources = summarize({ register, held: held(NOW), checks: {}, problems: new Map([['activations', 'Could not be reached. What was loaded before is kept; try again later.']]),
        updating, now: NOW });
      expect(resources.map(resource => resource.id)).toEqual(register.resources.map((entry: { id: string }) => entry.id));
      for (const resource of resources) expect(isStorageStatus(status([resource])), resource.id).toBe(true);
    }
    for (const fixture of [...RESOURCES_LOADED, ...RESOURCES_NOT_LOADED]) expect(isStorageStatus(status([fixture])), fixture.id).toBe(true);
  });

  it('takes a version and an available version', () => {
    expect(isStorageStatus(status(RESOURCES_ADIF_AVAILABLE))).toBe(true);
  });
  it.each(['3', '3.1.7.1.2', '3.1.<b>', '3.1.7 ', '', 3.17, '1234.1'])('refuses the version %j', (version) => {
    expect(isStorageStatus(status([{ ...RESOURCES_ADIF_AVAILABLE[0], version }]))).toBe(false);
    expect(isStorageStatus(status([{ ...RESOURCES_ADIF_AVAILABLE[0], available: version }]))).toBe(false);
  });
  it('refuses a summary without updatable', () => {
    const { updatable: _, ...without } = RESOURCES_ADIF_AVAILABLE[0]!;
    expect(isStorageStatus(status([without]))).toBe(false);
  });
});

describe('SOTA summits, a resource of one list (QGD-REF-0018)', () => {
  const sotaHeld = (fetched: number): ReferenceStatus => ({ ...held(NOW), sota: { summits: loaded(fetched) } }) as unknown as ReferenceStatus;
  const sota = (status: ReferenceStatus, checks: Record<string, string | undefined> = {}) =>
    summarize({ register, held: status, checks, problems: new Map(), updating: undefined, now: NOW }).find(resource => resource.id === 'sota')!;

  it('is not loaded until downloaded, and then can always be updated', () => {
    expect(sota(held(NOW))).toMatchObject({ state: 'not loaded', due: false, updatable: false });
    expect(sota(sotaHeld(NOW - 1000))).toMatchObject({ state: 'loaded', due: false, updatable: true });
  });

  it('is out of date after a day, and current again once its list answers', () => {
    expect(sota(sotaHeld(NOW - 2 * DAY)).due).toBe(true);
    expect(sota(sotaHeld(NOW - 2 * DAY), { 'sota-summits': at(NOW - 1000) }).due).toBe(false);
  });

  it('names its own list when it could not be reached', () => {
    const base = { adif: { state: 'not asked' }, pota: { parks: { state: 'not asked' }, programs: { state: 'not asked' }, locations: { state: 'not asked' } },
      sota: { summits: { state: 'kept', failure: { kind: 'fetch' } } }, activations: {}, built: false, status: {} } as unknown as RefreshOutcome;
    expect(problemOf('sota', base)).toMatch(/could not be reached/i);
    expect(problemOf('pota', base)).toBeUndefined();
  });
});


describe('POTA activations, a list for each location of My Area (QGD-REF-0019)', () => {
  const summary = (activations: Record<string, unknown>, checks: Record<string, string | undefined> = {}) =>
    summarize({ register, held: { ...held(NOW), activations } as unknown as ReferenceStatus, checks, problems: new Map(), updating: undefined, now: NOW })
      .find(resource => resource.id === 'activations')!;

  it('is not loaded until a location is downloaded, and then can always be updated', () => {
    expect(summary({})).toMatchObject({ state: 'not loaded', updatable: false, due: false });
    expect(summary({ 'US-ID': loaded(NOW - 1000) })).toMatchObject({ state: 'loaded', updatable: true, due: false });
  });

  it('is out of date once any location is a day old', () => {
    expect(summary({ 'US-ID': loaded(NOW - 1000), 'US-OR': loaded(NOW - 2 * DAY) }).due).toBe(true);
    expect(summary({ 'US-ID': loaded(NOW - 1000), 'US-OR': loaded(NOW - 2 * DAY) }, { 'pota-activations-US-OR': at(NOW - 1000) }).due).toBe(false);
  });

  it('says to choose My Area when there is none to download for', () => {
    const outcome = { adif: { state: 'not asked' }, pota: {}, sota: {}, activations: {}, noArea: true, built: false, status: {} } as unknown as RefreshOutcome;
    expect(problemOf('activations', outcome)).toMatch(/My Area/);
    const unreachable = { ...outcome, noArea: undefined, activations: { 'US-ID': { state: 'kept', failure: { kind: 'fetch' } } } } as unknown as RefreshOutcome;
    expect(problemOf('activations', unreachable)).toMatch(/Could not be reached/);
  });
});
