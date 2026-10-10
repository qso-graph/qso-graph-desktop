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
  import Rail from '../ui/Rail.svelte';
  import StatusBar from '../ui/StatusBar.svelte';
  import HomePage from './pages/HomePage.svelte';
  import PersonaPage from './pages/PersonaPage.svelte';
  import SettingsPage from './pages/SettingsPage.svelte';
  import TroubleshootingPanel from './pages/TroubleshootingPanel.svelte';
  import SetupPage from './pages/SetupPage.svelte';
  import { PAGES, isPageId, visiblePages, type ShellState, type ShellStore } from './shell-store.js';
  import type { ThemeChoice } from '../main/settings-contract.js';
  import type { Level } from '../logging/logging.js';
  import type { ExportResult, ImportPreview, ImportResult } from '../personas/persona-contract.js';

  interface Props {
    store: ShellStore;
    onChooseTheme: (choice: ThemeChoice) => Promise<boolean>;
    onSetLevel: (level: Level) => Promise<boolean>;
    onExport: () => Promise<string>;
    // Guided setup (QGD-PSN-0004). The services come from the store, because
    // they are read after the shell is mounted; the two actions are the real
    // ones, so nothing in setup is held in limbo.
    onCreatePersona: (callsign: string, name: string) => Promise<string | undefined>;
    // Setup finishing: the Personas screen has to be drawn again, and only
    // the caller knows how — its markup is imperative, from P1.
    onFinishSetup: () => void;
    onSaveCredential: (service: string, values: Record<string, string>) => Promise<string | undefined>;
    onExportPersonas: (passphrase: string) => Promise<ExportResult | string>;
    onInspectImport: (passphrase: string) => Promise<ImportPreview | string>;
    onApplyImport: (passphrase: string) => Promise<ImportResult | string>;
    version: string;
  }
  const {
    store, onChooseTheme, onSetLevel, onExport,
    onCreatePersona, onSaveCredential, onFinishSetup,
    onExportPersonas, onInspectImport, onApplyImport, version
  }: Props = $props();

  // Named `shell`, not `state`: `$state` is both Svelte's rune and the
  // subscription syntax for a store called `state`, and with two rune calls in
  // one file svelte-check read the first as a subscription of the second.
  //
  // untrack, because reading a prop to seed state is not a reactive read and
  // Svelte is right to ask: the subscription below is what keeps it current.
  // Seeded rather than defaulted so the first frame is already correct.
  let shell = $state<ShellState>(untrack(() => store.get()));
  // The effect's return value is its cleanup, so the subscription follows the
  // component's life and a replaced store is re-subscribed rather than lost.
  // Not $derived: the store is plain TypeScript and not reactive, so there is
  // nothing for a derivation to track. An assignment from a subscription is
  // the documented way to bring outside state in.
  $effect(() => store.subscribe(next => { shell = next; }));

  function navigate(id: string): void {
    if (isPageId(id)) store.set({ page: id });
  }

  // Everything the rail offers except Home itself: the page is a way in, not a
  // way back to where you already are.
  const destinations = $derived(visiblePages().filter(page => page.id !== 'home'));
</script>

<header>
  <!-- The title centred, with the tower from the application icon beside it.
       Inline SVG rather than an image: markup is not an image resource, so
       img-src stays 'none' and packages/main/policy.ts still serves exactly three files
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
  <Rail pages={visiblePages()} current={shell.page} onNavigate={navigate} />
  <main>
    <div class="page" hidden={shell.page !== 'home'}>
      <HomePage
        {version}
        activePersona={shell.activePersona}
        storage={shell.storage}
        {destinations}
        onGo={navigate}
      />
    </div>
    <div class="page" hidden={shell.page !== 'personas'}>
      <!-- Guided setup is offered and never imposed (QGD-PSN-0004). The page
           underneath is the one P1 built and P3 was signed off with; a
           machine with no personas gets an offer above it, and the offer is
           what opens the flow. -->
      <!-- Guided setup is offered and never imposed (QGD-PSN-0004). The page
           underneath is the one P1 built and P3 was signed off with.

           Three things this structure is load-bearing for, all found on a
           clean account by KI7MT:

           1. .page is a ROW. An offer placed as a sibling of PersonaPage
              became a third column and crushed the persona form to a sliver.
              Hence the stack.
           2. PersonaPage stays mounted and is hidden, never put inside an
              {#if}. That is this file's own rule, stated at the top, and it
              exists because app.ts drives P1's markup by hand: a component
              rebuilt under it loses that work silently. Toggling the offer
              rebuilt it once and took the "No personas yet" line with it.
           3. Hidden rather than destroyed also means select() can draw into
              the page the moment setup finishes, with no waiting for Svelte
              to put the markup back. -->
      {#if shell.setup}
        <SetupPage services={shell.services} {onCreatePersona} {onSaveCredential} onDone={onFinishSetup} />
      {/if}
      <div class="page-stack" hidden={shell.setup}>
        {#if shell.firstRun && shell.services.length > 0}
          <section class="card offer" aria-labelledby="setup-offer-title">
            <h2 id="setup-offer-title">New to QSO Graph Desktop?</h2>
            <p>
              Setting up takes a callsign and nothing else. The services after
              that are optional and can be skipped.
            </p>
            <button type="button" id="begin-setup" onclick={() => store.beginSetup()}>Set up step by step</button>
          </section>
        {/if}
        <div class="page-row">
          <PersonaPage {onExportPersonas} {onInspectImport} {onApplyImport} />
        </div>
      </div>
    </div>
    <div class="page" hidden={shell.page !== 'settings'}>
      <SettingsPage themeChoice={shell.themeChoice} {onChooseTheme} />
    </div>
  </main>
</div>
<StatusBar activePersona={shell.activePersona}
           onOpenTroubleshooting={() => store.set({ troubleshooting: true })} />
{#if shell.troubleshooting}
  <TroubleshootingPanel storage={shell.storage}
                        logs={shell.logs} {onSetLevel} {onExport}
                        onClose={() => store.set({ troubleshooting: false })} />
{/if}
