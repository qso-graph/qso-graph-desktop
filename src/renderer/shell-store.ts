// SPDX-License-Identifier: GPL-3.0-only
// The shell's state, and the only channel between the Persona screen's
// imperative code and the Svelte components that draw it.
//
// Plain TypeScript rather than a rune, so `tsc -p tsconfig.renderer.json`
// checks it and a test can drive it without a component tree. Shell.svelte is
// the one subscriber; app.ts is the one writer.
import type { ThemeChoice } from '../settings-contract.js';
import type { LogsStatus } from '../logs-contract.js';

// The rail's items, in the order it shows them. QGD-LOG-0013 puts the Logs page
// inside Settings, so it is not a third rail item.
export const PAGES = [
  { id: 'personas', label: 'Personas' },
  { id: 'settings', label: 'Settings' }
] as const;

export type PageId = (typeof PAGES)[number]['id'];

export function isPageId(value: unknown): value is PageId {
  return typeof value === 'string' && PAGES.some(page => page.id === value);
}

export interface ShellState {
  page: PageId;
  // Already formatted for display: the status bar draws what it is given and
  // decides nothing, so there is one place the wording lives (app.ts).
  activePersona: string;
  themeChoice: ThemeChoice;
  // Undefined until the main process has answered. The Logs page shows that it
  // is still reading rather than a level that might be wrong.
  logs: LogsStatus | undefined;
}

export const INITIAL_SHELL: ShellState = {
  page: 'personas',
  activePersona: 'No active persona',
  themeChoice: 'system',
  logs: undefined
};

export interface ShellStore {
  get(): ShellState;
  set(change: Partial<ShellState>): void;
  // Calls the listener immediately with the current state, so a subscriber
  // never renders a frame of defaults it has to correct.
  subscribe(listener: (state: ShellState) => void): () => void;
}

export function createShellStore(initial: ShellState = INITIAL_SHELL): ShellStore {
  let state: ShellState = { ...initial };
  const listeners = new Set<(state: ShellState) => void>();
  return {
    get: () => state,
    set(change) {
      const next: ShellState = { ...state, ...change };
      // Nothing is published when nothing moved, so re-reporting the same
      // active persona on every list refresh does not redraw the shell.
      if ((Object.keys(change) as (keyof ShellState)[]).every(key => state[key] === next[key])) return;
      state = next;
      // A copy, so a listener that unsubscribes while being notified does not
      // change the set being iterated.
      for (const listener of [...listeners]) listener(state);
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => { listeners.delete(listener); };
    }
  };
}
