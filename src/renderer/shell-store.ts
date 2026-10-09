// SPDX-License-Identifier: GPL-3.0-only
// The shell's state, and the only channel between the Persona screen's
// imperative code and the Svelte components that draw it.
//
// Plain TypeScript rather than a rune, so `tsc -p tsconfig.renderer.json`
// checks it and a test can drive it without a component tree. Shell.svelte is
// the one subscriber; app.ts is the one writer.
import type { ThemeChoice } from '../settings-contract.js';
import type { LogsStatus } from '../logs-contract.js';
import type { EngineStatus } from '../engine-contract.js';

// The rail's items. Each carries the Font Awesome icon key it draws, the
// short label shown under it, a longer description for the tooltip, and where
// it sits. Settings is at the bottom, which is where an application with a
// rail conventionally puts it — it is not one of the places you work, it is
// where you go to change how the places you work behave.
export const PAGES = [
  {
    id: 'home',
    label: 'Home',
    icon: 'home',
    description: 'What this is, and what it is doing',
    placement: 'top'
  },
  {
    id: 'personas',
    label: 'Personas',
    icon: 'personas',
    description: 'Station personas and the credentials saved for each',
    placement: 'top'
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: 'settings',
    description: 'Appearance, and the logs this Mac keeps',
    placement: 'bottom'
  }
] as const;

export type PageId = (typeof PAGES)[number]['id'];

export function isPageId(value: unknown): value is PageId {
  return typeof value === 'string' && PAGES.some(page => page.id === value);
}

export interface ShellState {
  page: PageId;
  // Who the active persona is — "W1AW · Home station" — and empty when there
  // is none. Not the sentence: the status bar and Home say it differently, and
  // a string formatted for one of them read wrong in the other.
  activePersona: string;
  themeChoice: ThemeChoice;
  // Undefined until the main process has answered. The Logs page shows that it
  // is still reading rather than a level that might be wrong.
  logs: LogsStatus | undefined;
  // Undefined until the engine has been asked. It is started in the background
  // and the shell never waits for it (QGD-ENG-0003).
  engine: EngineStatus | undefined;
}

export const INITIAL_SHELL: ShellState = {
  // The application opens on Home. Nothing there reads a credential, which is
  // half of why it is the right place to open (QGD-CRD-0009).
  page: 'home',
  activePersona: '',
  themeChoice: 'system',
  logs: undefined,
  engine: undefined
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
