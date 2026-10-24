// SPDX-License-Identifier: GPL-3.0-only
// Turning an extension off and on (QGD-HOM-0007).
//
// On is recorded in settings.json, so it holds across restarts; an extension
// not recorded as on is off, which is how a new install starts (KI7MT,
// 2026-10-23). Off is told to the supervisor, which deactivates the extension
// and starts it no more. Home listens and drops its cards; turned on again,
// its cards come back to the pins they held, which were kept
// (settings-contract.ts), and one turned on for the first time is pinned
// (onTurnedOn).
//
// No Electron here: the settings file and the supervisor are passed in, so it
// runs under unit tests.
import type { Supervisor } from './extension-host-supervisor.js';

export interface EnablementDeps {
  // The ids of the extensions that loaded. Only those can be switched.
  loaded: () => readonly string[];
  readOn: () => readonly string[];
  // Saves the list; false when the file could not be written.
  writeOn: (on: readonly string[]) => boolean;
  supervisor: Pick<Supervisor, 'setEnabled'>;
  // After an extension is turned on and recorded, as main pins its
  // destinations.
  onTurnedOn?: (id: string) => void;
}

export function createEnablement(deps: EnablementDeps) {
  const listeners = new Set<() => void>();
  // One change at a time, in the order asked: a quick off-on-off ends off.
  let queue: Promise<unknown> = Promise.resolve();

  const isOn = (id: string): boolean => deps.readOn().includes(id);

  return {
    isOn,
    // Every extension the settings file does not say is on, told to the
    // supervisor as off before anything asks for a card.
    async start(): Promise<void> {
      for (const id of deps.loaded()) if (!isOn(id)) await deps.supervisor.setEnabled(id, false);
    },
    set(id: string, enabled: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
      const run = queue.then(async (): Promise<{ ok: true } | { ok: false; error: string }> => {
        if (!deps.loaded().includes(id)) return { ok: false, error: 'There is no such extension.' };
        const on = deps.readOn().filter(entry => entry !== id);
        if (enabled) on.push(id);
        if (!deps.writeOn(on)) return { ok: false, error: 'The change could not be saved.' };
        // Recorded first, then acted on: if the application stops in between,
        // it starts next time as the operator chose.
        await deps.supervisor.setEnabled(id, enabled);
        if (enabled) deps.onTurnedOn?.(id);
        for (const listener of listeners) listener();
        return { ok: true };
      });
      queue = run.catch(() => undefined);
      return run;
    },
    onChange(listener: () => void): () => void {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    }
  };
}

export type Enablement = ReturnType<typeof createEnablement>;
