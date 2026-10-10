// SPDX-License-Identifier: GPL-3.0-only
// The shell's state, and the only channel between the Persona screen's
// imperative code and the Svelte components that draw it.
//
// Plain TypeScript rather than a rune, so `tsc -p tsconfig.renderer.json`
// checks it and a test can drive it without a component tree. Shell.svelte is
// the one subscriber; app.ts is the one writer.
import type { ThemeChoice } from '../main/settings-contract.js';
import type { AppInventory } from '../main/apps-contract.js';
import type { LogsStatus } from '../main/logs-contract.js';
import type { EngineStatus } from '../engine/engine-contract.js';
import type { ServiceSummary } from '../personas/service-contract.js';

// The rail's items. Each carries the Font Awesome icon key it draws, the
// short label shown under it, a longer description for the tooltip, and where
// it sits. Settings is at the bottom, which is where an application with a
// rail conventionally puts it — it is not one of the places you work, it is
// where you go to change how the places you work behave.
// A build-time constant, false unless QG_DESKTOP_PROOFS=1 (vite.config.mjs).
// Rollup drops everything behind it from a release bundle, which is half of
// how QGD-APP-0014.1 is enforced — the other half is that proofs/ is not in
// electron-builder's files list.
declare const __QG_PROOFS__: boolean;
export const PROOFS_ENABLED: boolean = typeof __QG_PROOFS__ === 'boolean' ? __QG_PROOFS__ : false;

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
    id: 'apps',
    label: 'Apps',
    icon: 'apps',
    description: 'The applications demonstrating the app API and its grants',
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

// What the rail offers. The Apps entry is absent from a release, so the
// approved screenshot baselines (QGD-PRT-0103) do not move: they are captured
// from an ordinary build, which has no proofs in it.
export function visiblePages(): readonly (typeof PAGES)[number][] {
  return PAGES.filter(page => page.id !== 'apps' || PROOFS_ENABLED);
}

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
  // Which applications loaded and what each holds, for the Settings surface
  // (QGD-APP-0012). Undefined until the main process has answered.
  apps: AppInventory | undefined;
  // Why the inventory could not be read, when it could not. Undefined while it
  // is still being asked for, and cleared when an answer arrives.
  appsProblem: string | undefined;
  // Whether the operator is in guided setup (QGD-PSN-0004). It is offered,
  // never imposed: the Personas page a machine with no personas shows is the
  // one P1 built and P3 was signed off with, and guided setup is a thing to
  // accept from it. Replacing that page was the first version of this, and
  // five suites caught it — rightly, because "the P1 persona workflow
  // unchanged inside the shell" is part of what KI7MT signed off.
  setup: boolean;
  // Whether this machine has no personas yet, which is when the offer is
  // worth making. Read from the personas, not assumed at start.
  firstRun: boolean;
  // The services setup walks (QGD-PSN-0002), read from the register once the
  // persona service answers. Here rather than handed to the shell at mount,
  // because it arrives afterwards: an array passed as a prop and filled in
  // later is a prop that was empty when it mattered, which is what the first
  // version of this did — setup had a callsign step and no services at all.
  services: ServiceSummary[];
}

export const INITIAL_SHELL: ShellState = {
  // The application opens on Home. Nothing there reads a credential, which is
  // half of why it is the right place to open (QGD-CRD-0009).
  page: 'home',
  activePersona: '',
  themeChoice: 'system',
  logs: undefined,
  engine: undefined,
    apps: undefined,
    appsProblem: undefined,
  // Both decided once the personas have been read, not before: a shell that
  // opened on an offer and then withdrew it would flash it at somebody who
  // already has personas.
  setup: false,
  firstRun: false,
  services: []
};

export interface ShellStore {
  get(): ShellState;
  set(change: Partial<ShellState>): void;
  // Entering and leaving guided setup, which the screens ask for rather than
  // reaching into the store for.
  beginSetup(): void;
  endSetup(): void;
  // Calls the listener immediately with the current state, so a subscriber
  // never renders a frame of defaults it has to correct.
  subscribe(listener: (state: ShellState) => void): () => void;
}

export function createShellStore(initial: ShellState = INITIAL_SHELL): ShellStore {
  let state: ShellState = { ...initial };
  const listeners = new Set<(state: ShellState) => void>();
  return {
    get: () => state,
    beginSetup() { this.set({ setup: true }); },
    endSetup() { this.set({ setup: false }); },
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
