// SPDX-License-Identifier: GPL-3.0-or-later
import { basename } from 'node:path';
import type { NativeLotwCommand, NativeLotwPreview } from '../callsign-core/native.js';
import { isLotwPreview, isLotwSummary } from '../callsigns/lotw-contract.js';
import type { ExtensionRequest, LotwManageKind, LotwManageResult } from '../extension-api/api-contract.js';
import type { Station, StationsBackup } from '../storage/station-contract.js';
import { lotwLocations } from './lotw-locations.js';

export interface LotwManagePorts {
  core: (command: NativeLotwCommand) => Promise<unknown>;
  choose: (backup: boolean, signal?: AbortSignal) => Promise<string | undefined>;
  password: (label: string, signal?: AbortSignal) => Promise<string | undefined>;
  confirm: (file: string, preview: NativeLotwPreview, locations: readonly Station[], skipped: readonly { name: string; reason: string }[], deleting: boolean, signal?: AbortSignal) => Promise<{ accepted: boolean; locations: boolean }>;
  existing: () => Promise<StationsBackup | string>;
  check: (backup: StationsBackup) => Promise<string | undefined>;
  add: (backup: StationsBackup, expectedNames: string[]) => Promise<number | string>;
}
const cancelled = (): LotwManageResult => ({ status: 'cancelled', certificates: [], roots: 0, signedQsos: 0, deleted: 0, locations: 0, skippedLocations: [] });
const backup = (stations: Station[]): StationsBackup => ({ stations, defaults: {}, active: null });
const refused = () => new Error('The LoTW operation could not be completed. Inspect the file again.');

export function createLotwManage(ports: LotwManagePorts) {
  let busy = false;
  return async (request: Extract<ExtensionRequest, { kind: LotwManageKind }>, signal?: AbortSignal): Promise<LotwManageResult> => {
    if (busy) throw new Error('Finish the open LoTW dialog first.');
    busy = true;
    let token: string | undefined;
    let submitted = false;
    const aborted = new Error('LoTW operation cancelled.');
    const checkAbort = () => { if (signal?.aborted) throw aborted; };
    // Native dialogs may outlive a request. Stop waiting and ignore their late
    // answers; keep core calls ordered so cleanup follows any inspect/unlock.
    const prompt = async <T>(open: () => Promise<T>): Promise<T> => {
      checkAbort();
      let stop: () => void = () => {};
      const cancellation = new Promise<never>((_resolve, reject) => { stop = () => reject(aborted); });
      signal?.addEventListener('abort', stop, { once: true });
      try { return await Promise.race([open(), cancellation]); }
      finally { signal?.removeEventListener('abort', stop); }
    };
    try {
      checkAbort();
      const deleting = request.kind === 'lotw.delete';
      const file = deleting ? '' : await prompt(() => ports.choose(request.kind === 'lotw.restore', signal));
      checkAbort();
      if (file === undefined) return cancelled();
      submitted = true;
      let value = await ports.core(deleting ? { op: 'inspectDelete', certificate: request.certificate } : { op: 'inspect', path: file, format: request.kind === 'lotw.restore' ? 'backup' : 'certificate' });
      if (!isLotwPreview(value)) throw refused();
      token = value.token;
      checkAbort();
      if (value.needsPassword) {
        let password = await prompt(() => ports.password(`Unlock ${basename(file)}`, signal));
        checkAbort();
        if (typeof password === 'undefined') return cancelled();
        try { value = await ports.core({ op: 'unlock', token, index: 0, password }); } finally { password = undefined; }
        checkAbort();
        if (!isLotwPreview(value) || value.token !== token || value.needsPassword) throw refused();
      }
      if (!isLotwPreview(value)) throw refused();
      for (let index = 0; index < value.certificates.length; index += 1) {
        const cert = value.certificates[index];
        if (!cert.needsPassword || cert.disposition === 'refused') continue;
        let password = await prompt(() => ports.password(`Unlock ${cert.call}, serial ${cert.serial}`, signal));
        checkAbort();
        if (typeof password === 'undefined') return cancelled();
        try { value = await ports.core({ op: 'unlock', token, index, password }); } finally { password = undefined; }
        checkAbort();
        if (!isLotwPreview(value) || value.token !== token || value.certificates[index]?.needsPassword) throw refused();
      }
      if (!isLotwPreview(value)) throw refused();
      const here = value.locations.length ? await ports.existing() : { stations: [], defaults: {}, active: null };
      checkAbort();
      if (typeof here === 'string') throw refused();
      const expected = here.stations.map(s => s.name);
      const planned = lotwLocations(value.locations, expected);
      const checked: Station[] = [];
      for (const station of planned.stations) {
        const problem = await ports.check(backup([station]));
        checkAbort();
        if (problem) planned.skipped.push({ name: station.name, reason: 'The place fields do not pass Desktop Location checks.' });
        else checked.push(station);
      }
      const inspected = value;
      const decision = await prompt(() => ports.confirm(basename(file), inspected, checked, [...planned.skipped], deleting, signal));
      checkAbort();
      if (!decision.accepted) return cancelled();
      if (decision.locations && checked.length) {
        const current = await ports.existing();
        checkAbort();
        if (typeof current === 'string' || JSON.stringify(current.stations.map(s => s.name).sort()) !== JSON.stringify([...expected].sort())) throw refused();
      }
      // Token consumed here, also on commit failure. No request can reuse its confirmation.
      const result = await ports.core({ op: 'commit', token });
      token = undefined;
      if (!isLotwSummary(result)) throw refused();
      submitted = false;
      if (result.status === 'conflict') return { ...cancelled(), status: 'conflict' };
      let locations = 0;
      if (decision.locations && checked.length) {
        let added: number | string;
        try { added = await ports.add(backup(checked), expected); } catch { added = 'Locations could not be saved.'; }
        if (typeof added === 'number') locations = added;
        else planned.skipped.push(...checked.map(s => ({ name: s.name, reason: 'Locations changed or could not be saved. Restore the backup again to add this Location.' })));
      } else planned.skipped.push(...checked.map(s => ({ name: s.name, reason: 'Location import was not selected.' })));
      return { status: 'completed', certificates: result.certificates.map(c => ({ call: c.call, serial: c.serial, disposition: c.disposition, reason: c.reason })), roots: result.roots, signedQsos: result.signedQsos, deleted: result.deleted, locations, skippedLocations: planned.skipped };
    } catch (error) {
      if (error === aborted) return cancelled();
      throw error;
    } finally {
      if (typeof token !== 'undefined') { try { await ports.core({ op: 'cancel', token }); } catch { /* Plan may already have been consumed by a refused password or commit. */ } }
      else if (submitted) { try { await ports.core({ op: 'discard' }); } catch { /* Queued after a late inspect; worker exit also drops the plan. */ } }
      busy = false;
    }
  };
}
