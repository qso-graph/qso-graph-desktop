<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!--
  Settings: the operator's preferences, and nothing else.

  It held five sections until 2026-10-10 — appearance, a per-grant permission
  list for three demonstration applications, the database's internal state, an
  encrypted export tool and a log viewer with level and retention controls.
  Four of those were the core describing itself. An operator opening Settings
  wants to change how the product behaves, not to read what the database is
  doing.

  Where each went, and the reference it follows:

    - the grant list: nowhere. An official application's grants are what the
      application is, so a per-capability choice offers no decision and
      teaches the operator to agree (`QGD-APP-0012.1`). VS Code has no
      per-permission screen at all; it asks once whether a publisher is
      trusted.
    - the database: Troubleshooting, as a Storage section (`QGD-FRM-0012`).
      It was a status-bar indicator until the bundled PostgreSQL went on
      2026-10-10; with nothing to start or stop, it needs none.
    - the logs, the level and the support bundle: Troubleshooting on the
      status bar (`QGD-LOG-0013`), which is where Podman Desktop puts its
      Logs tab and its "collect logs as .zip".
    - export and import of callsigns: the Callsigns page, beside the callsigns
      they are about. Bitwarden's desktop client keeps vault export under the
      application menu rather than in preferences.

  What is left is updates, appearance, the extensions, the reference data,
  back up and restore, and Storage when QG Sync is built.

  Reference data: one row per resource the register lists, each with its own
  Download, then Update (KI7MT, 2026-10-11 and #37). The first press fetches
  it from its source, so it is a download; "Load" undersold that and "Sync"
  implies two-way. ADIF offers Update only when this release pins a newer ADIF
  version; POTA, whose lists change daily, always. Nothing is fetched at start,
  and someone who never uses a resource never downloads it. The list is the register's, so
  a new resource (EME, meteor scatter) appears here without a new screen.

  Extensions: one switch each, as VS Code's Disable and Podman Desktop's
  extension toggle. Turning one off takes its cards off Home and out of
  "Customize your pins"; turning it on brings them back to the pins they
  held (QGD-HOM-0007). Grants are not shown here (QGD-APP-0012.1).
-->
<script lang="ts">
  import { FONT_AWESOME_CREDIT } from '../../main/attribution.js';
  import MoveCallsignsPage from './MoveCallsignsPage.svelte';
  import UpdatesCard from './UpdatesCard.svelte';
  import type { UpdateTrack } from '../../main/settings-contract.js';
  import type { UpdateState } from '../../main/update-contract.js';
  import type { ExportResult, ImportPreview, ImportResult } from '../../callsigns/callsign-contract.js';
  import PageLayout from '../../ui/PageLayout.svelte';
  import ThemeChoice from '../../ui/ThemeChoice.svelte';
  import type { ThemeChoice as Choice } from '../../main/settings-contract.js';
  import type { ExtensionSwitch } from '../shell-store.js';
  import type { ResourceSummary, StorageStatus } from '../../storage/storage-contract.js';
  import type { DocumentName } from '../../main/links-contract.js';

  // The project's documents, each kept once in the repository (QGD-FRM-0015).
  const ABOUT_DOCUMENTS: readonly (readonly [DocumentName, string])[] = [
    ['privacy', 'Privacy'], ['security', 'Security'], ['attributions', 'Attributions'], ['contributors', 'Contributors']
  ];

  interface Props {
    // For About (KI7MT, 2026-10-22: moved here from Home).
    version?: string;
    themeChoice: Choice;
    onChooseTheme: (choice: Choice) => Promise<boolean>;
    // Undefined while the main process has not answered.
    extensions?: readonly ExtensionSwitch[];
    // Extensions that did not load, so a missing one says why (QGD-APP-0011).
    refusedExtensions?: readonly { readonly folder: string; readonly reason: string }[];
    onSetExtension?: (id: string, enabled: boolean) => Promise<boolean>;
    storage?: StorageStatus;
    onUpdateReference?: (resource: string) => Promise<string | undefined>;
    // Opens one of Help's windows (QGD-FRM-0015).
    // Opens one of the project's documents in the browser (QGD-FRM-0015).
    onOpenDocument?: (name: DocumentName) => void;
    // Back up and restore (KI7MT, 2026-10-23: a housekeeping action, in
    // Settings and Tools, not a destination of its own).
    onBackup?: () => Promise<ExportResult | string>;
    onInspectBackup?: () => Promise<ImportPreview | string>;
    onRestore?: (replace: boolean) => Promise<ImportResult | string>;
    // Updates (QGD-FRM-0019).
    update?: UpdateState;
    updateCheck?: boolean;
    updateTrack?: UpdateTrack;
    onSetUpdateCheck?: (on: boolean) => Promise<boolean>;
    onSetUpdateTrack?: (track: UpdateTrack) => Promise<boolean>;
    onCheckUpdates?: () => void;
    onRestartToUpdate?: () => void;
    onOpenRelease?: () => void;
  }
  const {
    version = '', themeChoice, onChooseTheme, extensions, refusedExtensions = [], onSetExtension = () => Promise.resolve(false),
    storage, onUpdateReference = () => Promise.resolve('The update could not be started.'),
    onOpenDocument = () => {},
    onBackup = () => Promise.resolve('Backing up is not available here.'),
    onInspectBackup = () => Promise.resolve('Restoring is not available here.'),
    onRestore = () => Promise.resolve('Restoring is not available here.'),
    update, updateCheck = true, updateTrack = 'stable',
    onSetUpdateCheck, onSetUpdateTrack, onCheckUpdates, onRestartToUpdate, onOpenRelease
  }: Props = $props();

  const resources = $derived(storage?.state === 'ready' ? storage.reference?.resources : undefined);
  const busy = $derived(storage?.reference?.refreshing === true);
  let referenceFailure = $state('');

  // "Updated today", "yesterday" or "N days ago", from the oldest fetch.
  // When it was last updated, as a date-time group in UTC, as hams give
  // times (KI7MT, 2026-10-22: "updated today" said too little).
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function lastUpdated(resource: ResourceSummary): string {
    if (!resource.fetchedAt) return '';
    const at = new Date(resource.fetchedAt);
    if (Number.isNaN(at.getTime())) return '';
    const two = (value: number) => String(value).padStart(2, '0');
    return ` Last updated ${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]} ${at.getUTCFullYear()} `
      + `${two(at.getUTCHours())}:${two(at.getUTCMinutes())} UTC.`;
  }

  function stateWords(resource: ResourceSummary): string {
    if (resource.updating) return resource.state === 'loaded' ? 'Updating…' : 'Downloading…';
    if (resource.state === 'not loaded') return 'Not downloaded';
    if (resource.available) return `ADIF ${resource.version ?? ''} installed. ADIF ${resource.available} is available.`;
    const installed = resource.version ? `, ADIF ${resource.version}` : '';
    return `${resource.due ? 'Out of date' : 'Downloaded'}${installed}.${lastUpdated(resource)}`;
  }

  // Download while it is not on this computer, Update once it is and an
  // update could bring something new, and nothing otherwise.
  function action(resource: ResourceSummary): string | undefined {
    if (resource.state === 'not loaded') return 'Download';
    return resource.updatable ? 'Update' : undefined;
  }

  async function load(resource: ResourceSummary): Promise<void> {
    referenceFailure = '';
    const refused = await onUpdateReference(resource.id);
    if (refused) referenceFailure = `${resource.name}: ${refused}`;
  }

  // The switch being changed, so it cannot be flipped again before the main
  // process has answered; and the last failure, said in words.
  let saving = $state<string | undefined>();
  let failure = $state('');

  async function flip(extension: ExtensionSwitch, control: HTMLInputElement): Promise<void> {
    saving = extension.id;
    failure = '';
    const done = await onSetExtension(extension.id, !extension.enabled);
    saving = undefined;
    if (!done) {
      // The browser moved the switch when it was clicked, and an unchanged
      // prop does not move it back, so it is put back here: the switch shows
      // what was recorded, not what was clicked.
      control.checked = extension.enabled;
      failure = `${extension.name} could not be turned ${extension.enabled ? 'off' : 'on'}.`;
    }
  }
</script>

<PageLayout eyebrow="PREFERENCES" title="Settings" hue="settings">
  <!-- About, first on the page, as macOS has About This Mac (KI7MT,
       2026-10-22: moved from Home, and at the top of Settings): the version,
       and what the application sends anywhere, said precisely, because it
       reaches out on its own for reference data and pinned cards
       (QGD-REF-0001, QGD-REF-0009). Help → About and the macOS application
       menu's About open this card (KI7MT, 2026-10-24), so it carries the
       attribution CC BY 4.0 requires for the icons (QGD-REP-0005). -->
  <section class="card" aria-labelledby="about-title">
    <h2 id="about-title">About QSO Graph Desktop</h2>
    <dl class="facts">
      <dt>Version</dt>
      <dd id="about-version">{version}</dd>
    </dl>
    <p class="hint" id="about-privacy">
      Everything you enter stays on this computer. Nothing of yours is sent anywhere
      until you ask. The app fetches reference data (ADIF definitions, POTA parks, SOTA
      summits) when you download or update it, the data your pinned cards show, and,
      while Check for updates is on, whether there is a newer version. Nothing else.
    </p>
    <div class="about-links">
      {#each ABOUT_DOCUMENTS as [name, label] (name)}
        <button type="button" class="secondary" id={`open-${name}`} onclick={() => onOpenDocument(name)}>{label}</button>
      {/each}
    </div>
    <p class="hint about-credit" id="about-credit">QSO Graph contributors. GPL-3.0-or-later.<br>{#each FONT_AWESOME_CREDIT.split('\n') as line, i (i)}{line}<br>{/each}</p>
  </section>

  <UpdatesCard {update} check={updateCheck} track={updateTrack}
    onSetCheck={onSetUpdateCheck} onSetTrack={onSetUpdateTrack} onCheckNow={onCheckUpdates}
    onRestart={onRestartToUpdate} {onOpenRelease} />

  <section class="card" aria-labelledby="appearance-title">
    <h2 id="appearance-title">Appearance</h2>
    <ThemeChoice choice={themeChoice} onChoose={onChooseTheme} />
  </section>

  <section class="card" aria-labelledby="settings-reference-title">
    <h2 id="settings-reference-title">Reference data</h2>
    {#if resources === undefined}
      <p class="hint">Reading the reference data…</p>
    {:else}
      <ul class="extension-list">
        {#each resources as resource (resource.id)}
          <li class="extension-row reference-row" data-resource={resource.id}>
            <span class="extension-text">
              <span class="extension-name">{resource.name}</span>
              <span class="hint">{resource.what}. From {resource.owner}, {resource.size}.</span>
              <span class="hint reference-state">{stateWords(resource)}</span>
              {#if resource.problem && !resource.updating}<span class="extension-error reference-problem" role="status">{resource.problem}</span>{/if}
            </span>
            {#if action(resource)}
              <button type="button" class="secondary" disabled={busy}
                aria-label="{action(resource)} {resource.name}"
                onclick={() => { void load(resource); }}>{action(resource)}</button>
            {/if}
          </li>
        {/each}
      </ul>
      {#if referenceFailure}<p class="extension-error" role="alert">{referenceFailure}</p>{/if}
      <p class="hint">Fetched only when you ask. Nothing is downloaded at start.</p>
    {/if}
  </section>

  <section class="card" aria-labelledby="extensions-title">
    <h2 id="extensions-title">Extensions</h2>
    {#if extensions === undefined}
      <p class="hint">Reading the extensions…</p>
    {:else if extensions.length === 0}
      <p class="hint">No extensions are installed.</p>
    {:else}
      <ul class="extension-list">
        {#each extensions as extension (extension.id)}
          <li class="extension-row">
            <label class="extension-switch">
              <span class="extension-text">
                <span class="extension-name">{extension.name}</span>
                {#if extension.pages.length > 0}
                  <span class="hint">Pages: {extension.pages.join(', ')}</span>
                {/if}
              </span>
              <input type="checkbox" role="switch" checked={extension.enabled}
                disabled={saving !== undefined}
                data-extension={extension.id}
                onchange={event => { void flip(extension, event.currentTarget); }} />
            </label>
          </li>
        {/each}
      </ul>
      {#if failure}<p class="extension-error" role="alert">{failure}</p>{/if}
    {/if}
    {#if refusedExtensions.length > 0}
      <h3 class="extension-refused-title">Not loaded</h3>
      <ul class="extension-refused" id="extensions-refused">
        {#each refusedExtensions as entry, i (i)}<li><span class="extension-name">{entry.folder}</span> <span class="hint">{entry.reason}</span></li>{/each}
      </ul>
    {/if}
  </section>

  <MoveCallsignsPage onExport={onBackup} onInspect={onInspectBackup} onImport={onRestore} />
</PageLayout>
