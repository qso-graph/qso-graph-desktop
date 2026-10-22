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
  import HeaderClock from '../ui/HeaderClock.svelte';
  import HomePage from './pages/HomePage.svelte';
  import PersonaPage from './pages/PersonaPage.svelte';
  import SettingsPage from './pages/SettingsPage.svelte';
  import StationsPage from './pages/StationsPage.svelte';
  import TroubleshootingPanel from './pages/TroubleshootingPanel.svelte';
  import PrivacyPanel from './pages/PrivacyPanel.svelte';
  import SetupPage from './pages/SetupPage.svelte';
  import { PAGES, isPageId, visiblePages, type ShellState, type ShellStore } from './shell-store.js';
  import type { HomeModel, HomeStore } from './home-store.js';
  import type { ThemeChoice } from '../main/settings-contract.js';
  import type { Level } from '../logging/logging.js';
  import type { ExportResult, ImportPreview, ImportResult } from '../personas/persona-contract.js';
  import type { FieldProblem, NamedReferences, ParkDraft, StationChoices, StationDraft } from '../storage/station-contract.js';

  interface Props {
    store: ShellStore;
    // Home's cards and pins (QGD-HOM-*).
    home: HomeStore;
    onChooseTheme: (choice: ThemeChoice) => Promise<boolean>;
    // Turning an extension off or on (QGD-HOM-0007).
    onSetExtension: (id: string, enabled: boolean) => Promise<boolean>;
    // Loading or updating one reference resource, when the operator asks.
    onUpdateReference: (resource: string) => Promise<string | undefined>;
    // Stations (QGD-STN-*).
    onSaveStation: (draft: StationDraft, makeDefault: boolean) => Promise<{ error: string; problems?: FieldProblem[] } | undefined>;
    onDeleteStation: (id: string) => Promise<string | undefined>;
    onSetActiveStation: (id: string | null) => Promise<string | undefined>;
    onStationFromPark: (reference: string) => Promise<ParkDraft | string>;
    onStationChoices: (entity: string | null, state: string | null) => Promise<StationChoices | undefined>;
    onLookUpParks: (references: string) => Promise<NamedReferences | undefined>;
    onCountiesAt: (area: { south: number; west: number; north: number; east: number }) => Promise<{ counties: string[]; sections: Record<string, string> } | string>;
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
    store, home, onChooseTheme, onSetExtension, onUpdateReference, onSetLevel, onExport,
    onSaveStation, onDeleteStation, onSetActiveStation, onStationFromPark, onStationChoices, onLookUpParks, onCountiesAt,
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

  let homeModel = $state<HomeModel>(untrack(() => home.get()));
  $effect(() => home.subscribe(next => { homeModel = next; }));
  // Home is "showing" only while it is the page on screen: only then are its
  // cards asked for (QGD-HOM-0005).
  $effect(() => { home.setVisible(shell.page === 'home'); });

  function navigate(id: string): void {
    if (isPageId(id)) store.set({ page: id });
  }

  // The active station's name, for the status bar (QGD-STN-0005).
  const activeStation = $derived.by(() => {
    const stations = shell.storage?.stations;
    return stations?.list.find(station => station.id === stations.active);
  });
  // The status bar names the location and its grid, which the retired Your
  // station card was the only place to show (KI7MT, 2026-10-22).
  const activeStationName = $derived.by(() => {
    if (!activeStation) return '';
    const grid = activeStation.place.MY_GRIDSQUARE ?? activeStation.place.MY_VUCC_GRIDS;
    return grid ? `${activeStation.name} · ${grid}` : activeStation.name;
  });

</script>

<header>
  <!-- A heads-up bar, not a title (KI7MT, 2026-10-22): the window's own title
       bar already names the application. The clock at the left, as it is
       always there; the right is kept for what extensions add, as a rig's
       frequency and mode (#43). -->
  <HeaderClock />
</header>
<div class="workspace">
  <Rail pages={visiblePages()} current={shell.page} onNavigate={navigate} />
  <main>
    <div class="page" hidden={shell.page !== 'home'}>
      <HomePage
        home={homeModel}
        onSavePins={pins => home.savePins(pins)}
        onDismissNotice={id => home.dismissNotice(id)}
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
    <div class="page" hidden={shell.page !== 'stations'}>
      <StationsPage
        stations={shell.storage?.stations}
        personaName={shell.activePersonaName}
        personaLabel={shell.activeCallsign}
        parksLoaded={shell.storage?.reference?.parks.state === 'loaded'}
        onSave={onSaveStation}
        onDelete={onDeleteStation}
        onSetActive={onSetActiveStation}
        onFromPark={onStationFromPark}
        onChoices={onStationChoices}
        onLookUpParks={onLookUpParks}
        {onCountiesAt}
      />
    </div>
    <div class="page" hidden={shell.page !== 'settings'}>
      <SettingsPage {version} themeChoice={shell.themeChoice} {onChooseTheme} extensions={shell.extensions} {onSetExtension} storage={shell.storage} {onUpdateReference} onOpenPrivacy={() => store.set({ privacy: true })} />
    </div>
  </main>
</div>
<StatusBar activeCallsign={shell.activeCallsign}
           activeStation={activeStationName}
           onOpenTroubleshooting={() => store.set({ troubleshooting: true })} />
{#if shell.troubleshooting}
  <TroubleshootingPanel storage={shell.storage}
                        logs={shell.logs} {onSetLevel} {onExport}
                        onClose={() => store.set({ troubleshooting: false })} />
{/if}
{#if shell.privacy}
  <PrivacyPanel {version} onClose={() => store.set({ privacy: false })} />
{/if}
