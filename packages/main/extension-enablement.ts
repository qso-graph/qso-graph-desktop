// SPDX-License-Identifier: GPL-3.0-only
// Turning an extension off and on (QGD-HOM-0007).
//
// Off is recorded in settings.json, so it holds across restarts, and is told
// to the supervisor, which deactivates the extension and starts it no more.
// Home listens and drops its cards; turned on again, its cards come back to
// the pins they held, which were kept (settings-contract.ts).
//
// No Electron here: the settings file and the supervisor are passed in, so it
// runs under unit tests.
import type { Supervisor } from './extension-host-supervisor.js';

export interface EnablementDeps {
  // The ids of the extensions that loaded. Only those can be switched.
  loaded: () => readonly string[];
  readOff: () => readonly string[];
  // Saves the list; false when the file could not be written.
  writeOff: (off: readonly string[]) => boolean;
  supervisor: Pick<Supervisor, 'setEnabled'>;
}

export function createEnablement(deps: EnablementDeps) {
  const listeners = new Set<() => void>();
  // One change at a time, in the order asked: a quick off-on-off ends off.
  let queue: Promise<unknown> = Promise.resolve();

  const isOn = (id: string): boolean => !deps.readOff().includes(id);

  return {
    isOn,
    // What the settings file says is off, told to the supervisor before
    // anything asks for a card.
    async start(): Promise<void> {
      const loaded = new Set(deps.loaded());
      for (const id of deps.readOff()) if (loaded.has(id)) await deps.supervisor.setEnabled(id, false);
    },
    set(id: string, enabled: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
      const run = queue.then(async (): Promise<{ ok: true } | { ok: false; error: string }> => {
        if (!deps.loaded().includes(id)) return { ok: false, error: 'There is no such extension.' };
        const off = deps.readOff().filter(entry => entry !== id);
        if (!enabled) off.push(id);
        if (!deps.writeOff(off)) return { ok: false, error: 'The change could not be saved.' };
        // Recorded first, then acted on: if the application stops in between,
        // it starts next time as the operator chose.
        await deps.supervisor.setEnabled(id, enabled);
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
