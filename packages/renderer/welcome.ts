// SPDX-License-Identifier: GPL-3.0-only
// The getting-started steps on Home's welcome (KI7MT, 2026-10-22): each one
// a place to go, ticked when done. The reference data in the order it is
// needed: ADIF's definitions, which every location is checked against, then
// POTA's parks and SOTA's summits, which only those who chase or activate
// them need, so they are optional. The list goes once every step that is not
// optional is done: an operator who never goes portable is not asked for
// ever.
// Worked out from what the window already has; nothing is fetched.
import type { StorageStatus } from '../storage/storage-contract.js';

export interface WelcomeStep {
  readonly id: 'callsign' | 'location' | 'extensions' | 'adif' | 'parks' | 'summits';
  readonly label: string;
  readonly done: boolean;
  readonly optional: boolean;
}

// Undefined until storage has answered, so a list is never drawn and then
// withdrawn a moment later.
// `anyExtensionOn`: every extension starts off (KI7MT, 2026-10-23), so
// choosing what to add is a step of its own, done once one is on.
export function welcomeSteps(hasCallsign: boolean, storage: StorageStatus | undefined, anyExtensionOn = false): WelcomeStep[] | undefined {
  if (!storage?.stations || !storage.reference) return undefined;
  const reference = storage.reference;
  const steps: WelcomeStep[] = [
    { id: 'callsign', label: 'Add your callsign', done: hasCallsign, optional: false },
    { id: 'location', label: 'Add a location', done: storage.stations.list.length > 0, optional: false },
    { id: 'extensions', label: 'Choose what to add', done: anyExtensionOn, optional: false },
    { id: 'adif', label: 'Download ADIF definitions', done: reference.adif.state === 'loaded', optional: false },
    { id: 'parks', label: 'Download POTA parks', done: reference.parks.state === 'loaded', optional: true },
    { id: 'summits', label: 'Download SOTA summits', done: reference.summits.state === 'loaded', optional: true }
  ];
  return steps.every(step => step.done || step.optional) ? [] : steps;
}
