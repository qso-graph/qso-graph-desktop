// SPDX-License-Identifier: GPL-3.0-or-later
// The shell's state, and the only channel between the Callsign screen's
// imperative code and the Svelte components that draw it.
//
// Plain TypeScript rather than a rune, so `tsc -p tsconfig.renderer.json`
// checks it and a test can drive it without a component tree. Shell.svelte
// draws it; navigation and app.ts both write through this store.
import type { PageWork, CloseChoice } from './page-work.js';
import { isSavedTabs } from '../main/settings-contract.js';
import type { IntegrationsView } from '../main/integrations-page-contract.js';
import type { ThemeChoice, UpdateTrack, SettingsTab } from '../main/settings-contract.js';
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
    // Named as hams see them in LoTW, QRZ, eQSL and their loggers:
    // the code keeps 'callsigns' and 'stations' as its own names.
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
  closeQuestion: readonly string[] | null;
  closeError: string;
  page: PageId | 'extension';
  // The extension page on screen ("extension/page"), when page is
  // 'extension'; null otherwise.
  extensionPage: string | null;
  // The area's own Settings tab is showing, rather than the page
  // (an extension's settings are in its area).
  extensionSettings: boolean;
  // Destination ids in display order, and most recently shown first.
  tabs: readonly string[];
  settingsTab: SettingsTab;
  tabMru: readonly string[];
  // An area's chosen inner page and Settings tab, kept for this session.
  extensionTabs: Readonly<Record<string, { readonly page: string; readonly settings: boolean }>>;
  // The active callsign's call alone, which is all the status bar names: the
  // description is the operator's own label and read as a second callsign
  // there. Empty when there is none.
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
  closeQuestion: null,
  closeError: '',
  page: 'home',
  extensionPage: null,
  extensionSettings: false,
  tabs: ['home'],
  settingsTab: 'general',
  tabMru: ['home'],
  extensionTabs: {},
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
  openExtension(key: string, area: string, settings?: boolean): void;
  showTab(id: string): void;
  closeTab(id: string): Promise<boolean>;
  closeOtherTabs(id: string): Promise<boolean>;
  closeAllTabs(): Promise<boolean>;
  registerWork(id: string, work: PageWork): () => void;
  setTabLabels(labels: Readonly<Record<string, string>>): void;
  answerClose(choice: CloseChoice): void;
  mayCloseWindow(): Promise<boolean>;
  withClosingTabs(ids: readonly string[], action: () => Promise<boolean>): Promise<boolean>;
  restoreTabs(saved: unknown, available: readonly { key: string; area: string }[]): void;
  reorderTab(id: string, target: string): void;
  // Entering and leaving guided setup, which the screens ask for rather than
  // reaching into the store for.
  beginSetup(): void;
  endSetup(): void;
  // Calls the listener immediately with the current state, so a subscriber
  // never renders a frame of defaults it has to correct.
  subscribe(listener: (state: ShellState) => void): () => void;
}

export function shownTab(state: ShellState): string {
  if (state.page !== 'extension') return state.page;
  return Object.keys(state.extensionTabs).find(id => state.extensionTabs[id]?.page === state.extensionPage)
    ?? `ext:${state.extensionPage}`;
}

export function createShellStore(initial: ShellState = INITIAL_SHELL): ShellStore {
  let state: ShellState = { ...initial };
  const listeners = new Set<(state: ShellState) => void>();
  function publish(next: ShellState): void {
    // Nothing is published when nothing moved, so re-reporting the same
    // active callsign on every list refresh does not redraw the shell.
    if ((Object.keys(next) as (keyof ShellState)[]).every(key => state[key] === next[key])) return;
    state = next;
    // A copy, so a listener that unsubscribes while being notified does not
    // change the set being iterated.
    for (const listener of [...listeners]) listener(state);
  }
  function choose(change: Partial<ShellState>, destination?: string): void {
    const next = { ...state, ...change };
    if (next.page !== 'extension') { next.extensionPage = null; next.extensionSettings = false; }
    const id = destination ?? shownTab(next);
    if (next.page === 'extension' && next.extensionPage !== null) {
      const previous = state.extensionTabs[id];
      if (previous?.page !== next.extensionPage || previous?.settings !== next.extensionSettings) {
        next.extensionTabs = { ...state.extensionTabs, [id]: { page: next.extensionPage, settings: next.extensionSettings } };
      }
    }
    if (!next.tabs.includes(id)) next.tabs = [...next.tabs, id];
    if (next.tabMru[0] !== id) next.tabMru = [id, ...next.tabMru.filter(tab => tab !== id)];
    publish(next);
  }
  function selection(id: string): Partial<ShellState> {
    if (isPageId(id)) return { page: id, extensionPage: null, extensionSettings: false };
    const saved = state.extensionTabs[id];
    return { page: 'extension', extensionPage: saved.page, extensionSettings: saved.settings };
  }
  function close(remaining: readonly string[]): void {
    const tabs = remaining.length > 0 ? remaining : ['home'];
    const recent = state.tabMru.filter(id => tabs.includes(id));
    const id = tabs.includes(shownTab(state)) ? shownTab(state) : recent[0] ?? tabs[0];
    choose({ ...selection(id), tabs, tabMru: recent });
  }
  const work = new Map<string, Set<PageWork>>();
  let answering: ((choice: CloseChoice) => void) | undefined;
  let closing = false;
  let labels: Readonly<Record<string, string>> = {};
  const nameOf = (id: string) => PAGES.find(page => page.id === id)?.label ?? labels[id] ?? 'Extension';
  async function check(ids: readonly string[]): Promise<boolean> {
    const dirty = ids.flatMap(id => [...(work.get(id) ?? [])].filter(page => page.isDirty()).map(page => ({ id, page })));
    if (dirty.length === 0) return true;
    choose(selection(dirty[0].id));
    dirty[0].page.reveal?.();
    const choice = await new Promise<CloseChoice>(resolve => {
      answering = resolve;
      publish({ ...state, closeQuestion: [...new Set(dirty.map(entry => entry.id))].map(nameOf), closeError: '' });
    });
    answering = undefined;
    publish({ ...state, closeQuestion: null });
    if (choice === 'cancel') return false;
    if (choice === 'save') {
      for (const { id, page } of dirty) {
        choose(selection(id));
        page.reveal?.();
        try {
          if (await page.save() === true && !page.isDirty()) continue;
        } catch { /* A failed or unknown save keeps the draft. */ }
        publish({ ...state, closeError: 'The changes could not be confirmed saved. The tab is still open.' });
        return false;
      }
      // A later save may have left time for another draft to change.
      const changed = ids.flatMap(id => [...(work.get(id) ?? [])].map(page => ({ id, page })))
        .find(entry => entry.page.isDirty());
      if (changed) {
        choose(selection(changed.id)); changed.page.reveal?.();
        publish({ ...state, closeError: 'There are still unsaved changes. The tabs are still open.' });
        return false;
      }
    }
    return true;
  }
  async function runClose(ids: readonly string[], action?: () => Promise<boolean>, windowOnly = false): Promise<boolean> {
    if (closing) return false;
    if (ids.length === 0 && !action) return true;
    closing = true;
    try {
      publish({ ...state, closeError: '' });
      // No await on the clean path: existing tab operations remain immediate.
      if (ids.some(id => [...(work.get(id) ?? [])].some(page => page.isDirty())) && !await check(ids)) return false;
      if (action && await action() !== true) return false;
      if (!windowOnly) {
        for (const id of ids) for (const page of work.get(id) ?? []) page.discard();
        close(state.tabs.filter(id => !ids.includes(id)));
      }
      return true;
    } catch {
      publish({ ...state, closeError: 'The tabs could not be closed. Try again.' });
      return false;
    } finally { closing = false; }
  }
  choose({});
  return {
    get: () => state,
    beginSetup() { this.set({ setup: true }); },
    endSetup() { this.set({ setup: false }); },
    openExtension(key, area, settings = false) {
      choose({ page: 'extension', extensionPage: key, extensionSettings: settings }, `ext:${area}`);
    },
    showTab(id) { if (state.tabs.includes(id)) choose(selection(id)); },
    closeTab(id) { return runClose(state.tabs.includes(id) ? [id] : []); },
    closeOtherTabs(id) { return runClose(state.tabs.includes(id) ? state.tabs.filter(tab => tab !== id) : []); },
    closeAllTabs() { return runClose([...state.tabs]); },
    registerWork(id, page) {
      const participants = work.get(id) ?? new Set<PageWork>();
      participants.add(page); work.set(id, participants);
      return () => { participants.delete(page); if (participants.size === 0) work.delete(id); };
    },
    setTabLabels(next) { labels = next; },
    answerClose(choice) { answering?.(choice); },
    mayCloseWindow() { return runClose([...state.tabs], undefined, true); },
    withClosingTabs(ids, action) { return runClose(ids, action); },
    restoreTabs(saved, available) {
      if (!isSavedTabs(saved)) return;
      const areas = new Set(available.map(page => page.area));
      const restored = saved.filter(id => isPageId(id) || areas.has(id.slice(4)));
      const extensionTabs = { ...state.extensionTabs };
      for (const id of restored) if (!isPageId(id) && !extensionTabs[id]) {
        const page = available.find(page => page.area === id.slice(4));
        if (page) extensionTabs[id] = { page: page.key, settings: false };
      }
      publish({ ...state, tabs: [...new Set([...restored, ...state.tabs])], extensionTabs });
    },
    reorderTab(id, target) {
      const from = state.tabs.indexOf(id);
      const to = state.tabs.indexOf(target);
      if (from < 0 || to < 0 || from === to) return;
      const tabs = [...state.tabs];
      tabs.splice(from, 1);
      tabs.splice(to, 0, id);
      publish({ ...state, tabs });
    },
    set(change) {
      choose(change);
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => { listeners.delete(listener); };
    }
  };
}
