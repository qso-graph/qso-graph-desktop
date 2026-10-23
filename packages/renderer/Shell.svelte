<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!--
  The shell: header, rail, pages, status bar.

  Every page stays mounted and is hidden rather than destroyed. app.ts attaches
  the Callsign screen's listeners once at startup, so a page rebuilt on each
  visit would come back with its markup intact and nothing wired to it — the
  rail would work and the screen would not. Hiding also keeps exactly one
  <main> and one <nav> in the document, which is what P3-axe needs.
-->
<script lang="ts">
  import type { AreaProgram } from '../storage/area-entry.js';
  import { untrack } from 'svelte';
  import Rail from '../ui/Rail.svelte';
  import StatusBar from '../ui/StatusBar.svelte';
  import HeaderClock from '../ui/HeaderClock.svelte';
  import HomePage from './pages/HomePage.svelte';
  import ExtensionPage from './pages/ExtensionPage.svelte';
  import { welcomeSteps } from './welcome.js';
  import CallsignsPage from './pages/CallsignsPage.svelte';
  import SettingsPage from './pages/SettingsPage.svelte';
  import StationsPage from './pages/StationsPage.svelte';
  import TroubleshootingPanel from './pages/TroubleshootingPanel.svelte';
  import WelcomeWindow from './pages/WelcomeWindow.svelte';
  import SetupPage from './pages/SetupPage.svelte';
  import { PAGES, isPageId, visiblePages, type ShellState, type ShellStore } from './shell-store.js';
  import type { HomeModel, HomeStore } from './home-store.js';
  import type { LinkCommand } from '../main/links-contract.js';
  import type { ThemeChoice } from '../main/settings-contract.js';
  import type { Level } from '../logging/logging.js';
  import type { ExportResult, ImportPreview, ImportResult } from '../callsigns/callsign-contract.js';
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
    onCloseWelcome: (hideForThisRelease: boolean) => void;
    onStationFromSummit: (reference: string) => Promise<ParkDraft | string>;
    // My Area (KI7MT, 2026-10-23).
    onAreaChoices: () => Promise<readonly AreaProgram[] | string>;
    onAreaDefault: () => Promise<string | undefined>;
    onSaveArea: (area: readonly string[]) => Promise<boolean>;
    // A document or a park's or summit's page, in the browser (QGD-SEC-0009).
    onOpenPage: (command: LinkCommand) => void;
    onCountiesAt: (area: { south: number; west: number; north: number; east: number }) => Promise<{ counties: string[]; sections: Record<string, string> } | string>;
    onSetLevel: (level: Level) => Promise<boolean>;
    onExport: () => Promise<string>;
    // Guided setup (QGD-PSN-0004). The services come from the store, because
    // they are read after the shell is mounted; the two actions are the real
    // ones, so nothing in setup is held in limbo.
    onCreateCallsign: (call: string, description: string) => Promise<string | undefined>;
    // Setup finishing: the Callsigns screen has to be drawn again, and only
    // the caller knows how — its markup is imperative, from P1.
    onFinishSetup: () => void;
    onSaveCredential: (service: string, values: Record<string, string>) => Promise<string | undefined>;
    onExportCallsigns: (passphrase: string) => Promise<ExportResult | string>;
    onInspectImport: (passphrase: string) => Promise<ImportPreview | string>;
    onApplyImport: (passphrase: string) => Promise<ImportResult | string>;
    version: string;
  }
  const {
    store, home, onChooseTheme, onSetExtension, onUpdateReference, onSetLevel, onExport,
    onSaveStation, onDeleteStation, onSetActiveStation, onStationFromPark, onStationChoices, onLookUpParks, onCountiesAt, onCloseWelcome, onStationFromSummit, onOpenPage, onAreaChoices, onAreaDefault, onSaveArea,
    onCreateCallsign, onSaveCredential, onFinishSetup,
    onExportCallsigns, onInspectImport, onApplyImport, version
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
  // The extension page on screen is the only one asked for; Home asks for
  // nothing. A page whose extension was turned off goes back to Home.
  $effect(() => {
    const key = shell.page === 'extension' ? shell.extensionPage : null;
    if (key !== null && !homeModel.available.some(page => page.key === key) && homeModel.available.length + homeModel.pins.length > 0) {
      store.set({ page: 'home', extensionPage: null });
      return;
    }
    home.openPage(key);
  });
  // Home drawn afresh each time it comes on screen (home-store.ts refresh).
  $effect(() => { if (shell.page === 'home') untrack(() => home.refresh()); });

  // A rail item is a core page's id, or "ext:" and an extension page's key.
  function navigate(id: string): void {
    if (isPageId(id)) store.set({ page: id, extensionPage: null });
    else if (id.startsWith('ext:')) openPage(id.slice(4));
  }
  // The tab last open in each area, for the session: a pin or rail item opens
  // its area where the operator left it (KI7MT, 2026-10-23).
  // Read only when a pin or rail item is pressed, so it need not be reactive.
  const lastTab: Record<string, string> = {};
  $effect(() => { const page = homeModel.page; if (page) lastTab[page.area] = page.key; });
  // From a pin or the rail: the area, on its last tab, or else its first
  // tab in the manifest's order (KI7MT, 2026-10-23: Parks On the Air opens
  // on Near Me). From a tab: that page.
  function openPage(key: string): void {
    const page = homeModel.available.find(entry => entry.key === key);
    if (!page) return;
    const inArea = homeModel.available.filter(entry => entry.area === page.area);
    const last = Object.hasOwn(lastTab, page.area) ? lastTab[page.area] : undefined;
    const first = inArea[0]?.key ?? key;
    const to = page.key !== page.area ? key : last && inArea.some(entry => entry.key === last) ? last : first;
    store.set({ page: 'extension', extensionPage: to });
  }
  function openTab(key: string): void {
    if (homeModel.available.some(page => page.key === key)) store.set({ page: 'extension', extensionPage: key });
  }
  // The rail: the core's pages, then the extension pages that ask for a rail
  // item, then Settings at the foot (KI7MT, 2026-10-22).
  const railPages = $derived.by(() => {
    const core = visiblePages();
    const extensions = homeModel.railPages.map(page => ({
      id: `ext:${page.key}`, label: page.name, icon: page.icon, hue: page.hue, description: page.description, placement: 'top' as const
    }));
    return [...core.filter(page => page.placement !== 'bottom'), ...extensions, ...core.filter(page => page.placement === 'bottom')];
  });
  const railCurrent = $derived(shell.page === 'extension' ? `ext:${homeModel.page?.area ?? shell.extensionPage}` : shell.page);
  const openExtension = $derived(homeModel.available.find(page => page.key === shell.extensionPage));

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
  <HeaderClock online={homeModel.online} reached={homeModel.reached} />
</header>
<div class="workspace">
  <Rail pages={railPages} current={railCurrent} onNavigate={navigate} />
  <main>
    <div class="page" hidden={shell.page !== 'home'}>
      <HomePage
        home={homeModel}
        onSavePins={pins => home.savePins(pins)}
        onDismissNotice={id => home.dismissNotice(id)}
        onOpenPage={openPage}
        platform={(globalThis as { callsigns?: { platform?: string } }).callsigns?.platform ?? 'darwin'}
        steps={welcomeSteps(!shell.firstRun, shell.storage, homeModel.available.length > 0)}
        onGo={place => {
          // Choose what to add: Settings, at its Extensions card.
          if (place === 'extensions') {
            store.set({ page: 'settings', extensionPage: null });
            requestAnimationFrame(() => document.getElementById('extensions-title')?.scrollIntoView({ block: 'start' }));
          } else store.set({ page: place, extensionPage: null });
        }}
        onWhatsNew={() => store.set({ welcome: true })}
        onDownloads={() => onOpenPage({ type: 'document', name: 'downloads' })}
        onContributing={() => onOpenPage({ type: 'document', name: 'contributing' })}
        onSite={name => onOpenPage({ type: 'site', name })}
        picking={shell.customizing}
        onPicking={open => store.set({ customizing: open })}
      />
    </div>
    <div class="page" hidden={shell.page !== 'extension'}>
      <ExtensionPage page={homeModel.page} extensionName={openExtension?.extensionName ?? ''} onTab={openTab}
        onOpenReference={(kind, reference) => onOpenPage({ type: 'reference', kind, reference })}
        onAsk={values => { if (shell.extensionPage) home.openPage(shell.extensionPage, values); }}
        onRefresh={() => { if (shell.extensionPage) home.refreshPage(shell.extensionPage); }}
        offline={!homeModel.online && homeModel.page?.network === true} />
    </div>
    <div class="page" hidden={shell.page !== 'callsigns'}>
      <!-- Guided setup is offered and never imposed (QGD-PSN-0004). The page
           underneath is the one P1 built and P3 was signed off with; a
           machine with no callsigns gets an offer above it, and the offer is
           what opens the flow. -->
      <!-- Guided setup is offered and never imposed (QGD-PSN-0004). The page
           underneath is the one P1 built and P3 was signed off with.

           Three things this structure is load-bearing for, all found on a
           clean account by KI7MT:

           1. .page is a ROW. An offer placed as a sibling of CallsignsPage
              became a third column and crushed the callsign form to a sliver.
              Hence the stack.
           2. CallsignsPage stays mounted and is hidden, never put inside an
              {#if}. That is this file's own rule, stated at the top, and it
              exists because app.ts drives P1's markup by hand: a component
              rebuilt under it loses that work silently. Toggling the offer
              rebuilt it once and took the "No callsigns yet" line with it.
           3. Hidden rather than destroyed also means select() can draw into
              the page the moment setup finishes, with no waiting for Svelte
              to put the markup back. -->
      {#if shell.setup}
        <SetupPage services={shell.services} {onCreateCallsign} {onSaveCredential} onDone={onFinishSetup} />
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
          <CallsignsPage {onExportCallsigns} {onInspectImport} {onApplyImport} />
        </div>
      </div>
    </div>
    <div class="page" hidden={shell.page !== 'stations'}>
      <StationsPage
        stations={shell.storage?.stations}
        callsignId={shell.activeCallsignId}
        callsignLabel={shell.activeCallsignLabel}
        parksLoaded={shell.storage?.reference?.parks.state === 'loaded'}
        summitsLoaded={shell.storage?.reference?.summits.state === 'loaded'}
        onFromSummit={onStationFromSummit}
        area={shell.area}
        {onAreaChoices}
        {onAreaDefault}
        {onSaveArea}
        onDownloadParks={() => { store.set({ page: 'settings', extensionPage: null }); void onUpdateReference('pota'); }}
        onSave={onSaveStation}
        onDelete={onDeleteStation}
        onSetActive={onSetActiveStation}
        onFromPark={onStationFromPark}
        onChoices={onStationChoices}
        onLookUpParks={onLookUpParks}
        {onCountiesAt}
        {onOpenPage}
      />
    </div>
    <div class="page" hidden={shell.page !== 'settings'}>
      <SettingsPage {version} themeChoice={shell.themeChoice} {onChooseTheme} extensions={shell.extensions} refusedExtensions={shell.refusedExtensions} {onSetExtension} storage={shell.storage} {onUpdateReference} onOpenDocument={name => onOpenPage({ type: 'document', name })} />
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
{#if shell.welcome}
  <WelcomeWindow {version} onClose={onCloseWelcome} />
{/if}
