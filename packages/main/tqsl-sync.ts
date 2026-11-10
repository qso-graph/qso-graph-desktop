// SPDX-License-Identifier: GPL-3.0-or-later
import type { NativeLotwCommand, NativeTqslEntry } from '../callsign-core/native.js';
import { isTqslPreview, TQSL_READ_REFUSED } from '../callsigns/lotw-contract.js';
import { lotwLocations } from './lotw-locations.js';
import type { Station, StationsBackup } from '../storage/station-contract.js';

export interface TqslSyncRow extends NativeTqslEntry { resultName: string; offered: boolean; checked: boolean }
export interface TqslSyncPlan { folder: string; locations: TqslSyncRow[] }
export interface TqslSyncResult extends TqslSyncPlan { status: 'completed' | 'cancelled'; added: number }
export interface TqslSyncPorts {
  core: (command: NativeLotwCommand) => Promise<unknown>;
  existing: () => Promise<StationsBackup | string>;
  check: (backup: StationsBackup) => Promise<string | undefined>;
  add: (backup: StationsBackup, names: string[]) => Promise<number | string>;
  confirm: (plan: TqslSyncPlan, signal?: AbortSignal) => Promise<number[] | undefined>;
}
// Fixed messages the operator may see: each says what to do next. Anything else
// is replaced by the broker's general message.
export const TQSL_SYNC_MESSAGES: readonly string[] = [
  TQSL_READ_REFUSED,
  'Finish the open Sync from TQSL dialog first.',
  'Finish the open LoTW dialog first.',
  'Desktop Locations could not be read.',
  'TQSL locations could not be inspected.',
  'The Sync selection was refused.',
  'Locations changed or could not be saved. Sync from TQSL again.'
];
const backup = (stations: Station[]): StationsBackup => ({ stations, defaults: {}, active: null });
export function createTqslSync(ports: TqslSyncPorts) {
  let busy = false;
  return async (signal?: AbortSignal): Promise<TqslSyncResult> => {
    if (busy) throw new Error('Finish the open Sync from TQSL dialog first.');
    busy = true;
    const aborted = new Error('Sync cancelled.');
    const checkAbort = () => { if (signal?.aborted) throw aborted; };
    const empty: TqslSyncResult = { status: 'cancelled', folder: '', locations: [], added: 0 };
    try {
      checkAbort();
      const here = await ports.existing();
      checkAbort();
      if (typeof here === 'string') throw new Error('Desktop Locations could not be read.');
      const value = await ports.core({ op: 'syncInspect', existing: here.stations.map(s => ({ name: s.name, place: { ...s.place }, park: s.lotwPark ?? '' })) });
      checkAbort();
      if (!isTqslPreview(value)) throw new Error('TQSL locations could not be inspected.');
      const taken = here.stations.map(s => s.name);
      const stations = new Map<number, Station>();
      const plan: TqslSyncPlan = { folder: value.folder, locations: [] };
      for (const [index, entry] of value.locations.entries()) {
        const offered = entry.status === 'new' || entry.status === 'differs';
        const row: TqslSyncRow = { ...entry, resultName: entry.name, offered: false, checked: false };
        if (offered) {
          const mapped = lotwLocations([entry], taken);
          const station = mapped.stations[0];
          const problem = station ? await ports.check(backup([station])) : mapped.skipped[0]?.reason;
          checkAbort();
          if (!station || problem) {
            row.status = 'refused';
            row.reason = mapped.skipped[0]?.reason ?? (problem && problem.length <= 4096 && Array.from(problem).every(c => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127)
              ? problem : 'The place fields do not pass Desktop Location checks.');
          } else {
            row.resultName = station.name; row.offered = true; row.checked = entry.status === 'new';
            stations.set(index, station); taken.push(station.name);
          }
        }
        plan.locations.push(row);
      }
      // A native dialog can outlive its requester. Abort releases the gate and
      // ignores late answers; the dialog also destroys its window on abort.
      let stop = () => {};
      const cancelled = new Promise<never>((_resolve, reject) => { stop = () => reject(aborted); });
      signal?.addEventListener('abort', stop, { once: true });
      let selected: number[] | undefined;
      try { checkAbort(); selected = await Promise.race([ports.confirm(structuredClone(plan), signal), cancelled]); }
      finally { signal?.removeEventListener('abort', stop); }
      checkAbort();
      if (selected === undefined) return { ...plan, status: 'cancelled', added: 0 };
      if (!Array.isArray(selected) || selected.length > stations.size || new Set(selected).size !== selected.length || selected.some(i => !Number.isSafeInteger(i) || !stations.has(i))) throw new Error('The Sync selection was refused.');
      const chosen = selected.map(i => stations.get(i)!);
      let added = 0;
      if (chosen.length) {
        checkAbort();
        const result = await ports.add(backup(chosen), here.stations.map(s => s.name));
        if (typeof result !== 'number') throw new Error('Locations changed or could not be saved. Sync from TQSL again.');
        added = result;
      }
      return { ...plan, status: 'completed', added };
    } catch (error) {
      if (error === aborted) return empty;
      throw error;
    } finally { busy = false; }
  };
}
