<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!--
  The shell: header, rail, pages, status bar.

  Every page stays mounted and is hidden rather than destroyed. app.ts attaches
  the Persona screen's listeners once at startup, so a page rebuilt on each
  visit would come back with its markup intact and nothing wired to it — the
  rail would work and the screen would not. Hiding also keeps exactly one
  <main> and one <nav> in the document, which is what P3-axe needs.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import Rail from './ui/Rail.svelte';
  import StatusBar from './ui/StatusBar.svelte';
  import PersonaPage from './pages/PersonaPage.svelte';
  import SettingsPage from './pages/SettingsPage.svelte';
  import { PAGES, isPageId, type ShellState, type ShellStore } from './shell-store.js';
  import type { ThemeChoice } from '../settings-contract.js';
  import type { Level } from '../logging.js';

  interface Props {
    store: ShellStore;
    onChooseTheme: (choice: ThemeChoice) => Promise<boolean>;
    onSetLevel: (level: Level) => Promise<boolean>;
    onExport: () => Promise<string>;
    onStartEngine: () => Promise<void>;
    onStopEngine: () => Promise<void>;
  }
  const { store, onChooseTheme, onSetLevel, onExport, onStartEngine, onStopEngine }: Props = $props();

  // untrack, because reading a prop to seed state is not a reactive read and
  // Svelte is right to ask: the subscription below is what keeps it current.
  // Seeded rather than defaulted so the first frame is already correct.
  let state = $state<ShellState>(untrack(() => store.get()));
  // The effect's return value is its cleanup, so the subscription follows the
  // component's life and a replaced store is re-subscribed rather than lost.
  // Not $derived: the store is plain TypeScript and not reactive, so there is
  // nothing for a derivation to track. An assignment from a subscription is
  // the documented way to bring outside state in.
  $effect(() => store.subscribe(next => { state = next; }));

  function navigate(id: string): void {
    if (isPageId(id)) store.set({ page: id });
  }
</script>

<header>
  <!-- The title centred, with the tower from the application icon beside it.
       Inline SVG rather than an image: markup is not an image resource, so
       img-src stays 'none' and src/policy.ts still serves exactly three files
       (QGD-SEC-0008, QGD-PRC-0006). It draws in currentColor, so it takes the
       theme rather than needing a light copy and a dark one. -->
  <span class="brand">
    <svg class="app-mark" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"
         fill="none" stroke="currentColor" stroke-width="1.5"
         stroke-linecap="round" stroke-linejoin="round">
      <!-- A lattice tower: two legs and two crossbars. A plain triangle read
           as the letter A at this size. -->
      <path d="M9.4 21 L11.1 10.6 M14.6 21 L12.9 10.6" />
      <path d="M10.2 16.6 H13.8" />
      <path d="M9.7 19 H14.3" />
      <path d="M12 10.6 V7.8" />
      <!-- The bolt is filled rather than stroked; a thin zigzag turns to mush
           at 20px. -->
      <path d="M17.2 2.6 L13.4 7.9 L16.3 7.9 L14.9 13.4 L19.1 7.6 L16.2 7.6 Z"
            fill="currentColor" stroke="none" />
    </svg>
    <strong class="app-title">QSO Graph Desktop</strong>
  </span>
</header>
<div class="workspace">
  <Rail pages={PAGES} current={state.page} onNavigate={navigate} />
  <main>
    <div class="page" hidden={state.page !== 'personas'}>
      <PersonaPage />
    </div>
    <div class="page" hidden={state.page !== 'settings'}>
      <SettingsPage themeChoice={state.themeChoice} {onChooseTheme} logs={state.logs} {onSetLevel} {onExport}
                    engine={state.engine} {onStartEngine} {onStopEngine} />
    </div>
  </main>
</div>
<StatusBar activePersona={state.activePersona} />
