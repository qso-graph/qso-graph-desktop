// SPDX-License-Identifier: GPL-3.0-only
// The getting-started steps on Home's welcome (KI7MT, 2026-10-22): each one
// a place to go, ticked when done, all of them gone once every one is.
// Worked out from what the window already has; nothing is fetched.
import type { StorageStatus } from '../storage/storage-contract.js';

export interface WelcomeStep {
  readonly id: 'callsign' | 'location' | 'adif';
  readonly label: string;
  readonly done: boolean;
}

// Undefined until storage has answered, so a list is never drawn and then
// withdrawn a moment later.
export function welcomeSteps(hasCallsign: boolean, storage: StorageStatus | undefined): WelcomeStep[] | undefined {
  if (!storage?.stations || !storage.reference) return undefined;
  const steps: WelcomeStep[] = [
    { id: 'callsign', label: 'Add your callsign', done: hasCallsign },
    { id: 'location', label: 'Add a location', done: storage.stations.list.length > 0 },
    { id: 'adif', label: 'Download ADIF definitions', done: storage.reference.adif.state === 'loaded' }
  ];
  return steps.every(step => step.done) ? [] : steps;
}
