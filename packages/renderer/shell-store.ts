// SPDX-License-Identifier: GPL-3.0-only
// The shell's state, and the only channel between the Callsign screen's
// imperative code and the Svelte components that draw it.
//
// Plain TypeScript rather than a rune, so `tsc -p tsconfig.renderer.json`
// checks it and a test can drive it without a component tree. Shell.svelte is
// the one subscriber; app.ts is the one writer.
import type { IntegrationsView } from '../main/integrations-page-contract.js';
import type { ThemeChoice, UpdateTrack } from '../main/settings-contract.js';
import type { UpdateState } from '../main/update-contract.js';
import type { UpdateLine, WhatsNewNotes } from '../main/whats-new-contract.js';
import type { LogsStatus } from '../main/logs-contract.js';
import type { StorageStatus } from '../storage/storage-contract.js';
import type { ServiceSummary } from '../callsigns/service-contract.js';

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
    // Each place's hue (style.css --hue-*), used wherever it appears.
    hue: 'general',
    description: 'What this is, and what it is doing',
    placement: 'top'
  },
  {
    id: 'callsigns',
    // Named as hams see them in LoTW, QRZ, eQSL and their loggers (KI7MT,
    // 2026-10-22): the code keeps 'callsigns' and 'stations' as its own names.
    label: 'Callsigns',
    icon: 'callsigns',
    hue: 'callsigns',
    description: 'Your callsigns and the logins saved for each',
    placement: 'top'
  },
  {
    id: 'stations',
    label: 'Locations',
    icon: 'stations',
    hue: 'locations',
    description: 'Where you operate from: home, a park, a summit, the car',
    placement: 'top'
  },
  {
    // Integrations (QGD-PRT-0113): core, and always on the rail, as
    // Callsigns and Locations are. It hears nothing until an adapter is on.
    id: 'integrations',
    label: 'Integrations',
    icon: 'integrations',
    hue: 'general',
    description: 'What is listening for the programs your station runs, such as WSJT-X',
    placement: 'top'
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: 'settings',
    hue: 'settings',
    description: 'Appearance, and how this application behaves',
    placement: 'bottom'
  }
] as const;

// What the rail offers. Every page, for now: the filter that used to hide the
// demonstration applications went with them (QGD-APP-0014). It stays a
// function because the rail will be filtered again when applications are
// installed rather than built in.
export function visiblePages(): readonly (typeof PAGES)[number][] {
  return [...PAGES];
}

export type PageId = (typeof PAGES)[number]['id'];

export function isPageId(value: unknown): value is PageId {
  return typeof value === 'string' && PAGES.some(page => page.id === value);
}

export interface ShellState {
  // A core page, or 'extension' for an extension's page, named below.
  page: PageId | 'extension';
  // The extension page on screen ("extension/page"), when page is
  // 'extension' (KI7MT, 2026-10-22); null otherwise.
  extensionPage: string | null;
  // The area's own Settings tab is showing, rather than the page (KI7MT,
  // 2026-10-24: an extension's settings are in its area).
  extensionSettings: boolean;
  // The active callsign's call alone, which is all the status bar names: the
  // description is the operator's own label and read as a second callsign
  // there (KI7MT, 2026-10-22). Empty when there is none.
  activeCallsign: string;
  // Its id, which is how a callsign is keyed, so a station can be made its
  // default (QGD-STN-0005). Empty when there is none.
  activeCallsignId: string;
  // The call and the description, "W1AW · Home", where both are wanted.
  activeCallsignLabel: string;
  themeChoice: ThemeChoice;
  // Undefined until the main process has answered. The Logs page shows that it
  // is still reading rather than a level that might be wrong.
  logs: LogsStatus | undefined;
  // Undefined until storage has answered or pushed its first status. It is
  // started in the background and the shell never waits for it (QGD-ENG-0003).
  storage: StorageStatus | undefined;
  // Whether Troubleshooting is open (QGD-LOG-0013, QGD-FRM-0012).
  //
  // In the store rather than local to the shell, because what it shows is
  // fetched: the logs are read while it is open, and app.ts owns that lifecycle by reading this
  // store. Kept local, the panel showed "Reading the log settings…" for ever
  // unless Settings happened to have been visited first — the logs were polled
  // while `page === 'settings'`, which is where they used to be shown. Found
  // in review.
  troubleshooting: boolean;
  // After an update or going back, Home's one line: the version it came from
  // (null when not known); null otherwise, and once it is closed (QGD-FRM-0016).
  updateLine: UpdateLine | null;
  // What's new, while it is open: undefined notes while they are read.
  whatsNew: { notes?: WhatsNewNotes } | null;
  // Whether "Customize your pins" is open, from Home or the Setup menu.
  customizing: boolean;
  // Whether the operator is in guided setup (QGD-PSN-0004). It is offered,
  // never imposed: the Callsigns page a machine with no callsigns shows is the
  // one P1 built and P3 was signed off with, and guided setup is a thing to
  // accept from it. Replacing that page was the first version of this, and
  // five suites caught it — rightly, because "the P1 callsign workflow
  // unchanged inside the shell" is part of what KI7MT signed off.
  setup: boolean;
  // Whether this machine has no callsigns yet, which is when the offer is
  // worth making. Read from the callsigns, not assumed at start.
  firstRun: boolean;
  // The services setup walks (QGD-PSN-0002), read from the register once the
  // callsign service answers. Here rather than handed to the shell at mount,
  // because it arrives afterwards: an array passed as a prop and filled in
  // later is a prop that was empty when it mattered, which is what the first
  // version of this did — setup had a callsign step and no services at all.
  services: ServiceSummary[];
  // The extensions that loaded, for Settings' switches (QGD-HOM-0007).
  // Undefined until the main process has answered.
  extensions: ExtensionSwitch[] | undefined;
  // Extensions that did not load, by folder, with why (QGD-APP-0011).
  refusedExtensions: readonly { readonly folder: string; readonly reason: string }[];
  // What Integrations is listening on (QGD-INT-0010): undefined until the
  // main process has answered, then pushed when it changes.
  integrations: IntegrationsView | undefined;
  // My Area as saved (settings-contract.ts): empty means the Location's own.
  area: readonly string[];
  // Updates (QGD-FRM-0019): what the updater last said, undefined until it
  // has, and the two settings as saved.
  update: UpdateState | undefined;
  updateCheck: boolean;
  updateTrack: UpdateTrack;
}

export interface ExtensionSwitch {
  readonly id: string;
  readonly name: string;
  // The cards it offers, named, so the switch says what it takes away.
  readonly pages: readonly string[];
  readonly enabled: boolean;
}

export const INITIAL_SHELL: ShellState = {
  // The application opens on Home. Nothing there reads a credential, which is
  // half of why it is the right place to open (QGD-CRD-0009).
  page: 'home',
  extensionPage: null,
  extensionSettings: false,
  activeCallsign: '',
  activeCallsignId: '',
  activeCallsignLabel: '',
  themeChoice: 'dark',
  logs: undefined,
  storage: undefined,
  // Both decided once the callsigns have been read, not before: a shell that
  // opened on an offer and then withdrew it would flash it at somebody who
  // already has callsigns.
  troubleshooting: false,
  updateLine: null,
  whatsNew: null,
  customizing: false,
  setup: false,
  firstRun: false,
  services: [],
  extensions: undefined,
  refusedExtensions: [],
  integrations: undefined,
  area: [],
  update: undefined,
  updateCheck: true,
  updateTrack: 'stable'
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
      // active callsign on every list refresh does not redraw the shell.
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
