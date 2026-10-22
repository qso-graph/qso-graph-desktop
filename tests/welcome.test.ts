// SPDX-License-Identifier: GPL-3.0-only
// Home's welcome: the getting-started steps (KI7MT, 2026-10-22), each ticked
// when done and all of them gone once every one is.
import { describe, expect, it } from 'vitest';
import { welcomeSteps } from '../packages/renderer/welcome.js';
import type { StorageStatus } from '../packages/storage/storage-contract.js';

const loaded = { state: 'loaded' as const };
const missing = { state: 'not loaded' as const };
function storage(locations: number, adif: boolean): StorageStatus {
  return {
    state: 'ready',
    stations: { list: Array.from({ length: locations }, (_, i) => ({ id: `${i}`, name: `L${i}`, place: {} })), defaults: {}, active: null, checked: true },
    reference: { adif: adif ? loaded : missing, parks: missing, programs: missing, locations: missing, summits: missing, refreshing: false, resources: [] }
  } as unknown as StorageStatus;
}

describe('the welcome\'s getting-started steps', () => {
  it('waits for storage rather than drawing steps it may withdraw', () => {
    expect(welcomeSteps(false, undefined)).toBeUndefined();
  });

  it('lists the three in order on a new install, none done', () => {
    expect(welcomeSteps(false, storage(0, false))?.map(step => [step.id, step.done]))
      .toEqual([['callsign', false], ['location', false], ['adif', false]]);
  });

  it('ticks each as it is done, and shows none once all are', () => {
    expect(welcomeSteps(true, storage(1, false))?.map(step => step.done)).toEqual([true, true, false]);
    expect(welcomeSteps(true, storage(2, true))).toEqual([]);
  });
});
