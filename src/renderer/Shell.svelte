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

  interface Props {
    store: ShellStore;
    onChooseTheme: (choice: ThemeChoice) => void;
  }
  const { store, onChooseTheme }: Props = $props();

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
  <div class="brand"><span class="mark" aria-hidden="true">QG</span><strong>QG Desktop</strong></div>
  <span class="platform">Your station on this Mac</span>
</header>
<div class="workspace">
  <Rail pages={PAGES} current={state.page} onNavigate={navigate} />
  <main>
    <div class="page" hidden={state.page !== 'personas'}>
      <PersonaPage />
    </div>
    <div class="page" hidden={state.page !== 'settings'}>
      <SettingsPage themeChoice={state.themeChoice} {onChooseTheme} />
    </div>
  </main>
</div>
<StatusBar activePersona={state.activePersona} />
