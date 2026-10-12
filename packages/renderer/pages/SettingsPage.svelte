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
    - export and import of personas: the Personas page, beside the personas
      they are about. Bitwarden's desktop client keeps vault export under the
      application menu rather than in preferences.

  What is left is appearance, the extensions, the reference data, and
  Storage when QG Sync is built.

  Reference data: one row per resource the register lists, each with its own
  Load or Update (KI7MT, 2026-10-11). Nothing is fetched at start, and someone
  who never uses a resource never downloads it. The list is the register's, so
  a new resource (EME, meteor scatter) appears here without a new screen.

  Extensions: one switch each, as VS Code's Disable and Podman Desktop's
  extension toggle. Turning one off takes its cards off Home and out of
  "Customize your pins"; turning it on brings them back to the pins they
  held (QGD-HOM-0007). Grants are not shown here (QGD-APP-0012.1).
-->
<script lang="ts">
  import PageLayout from '../../ui/PageLayout.svelte';
  import ThemeChoice from '../../ui/ThemeChoice.svelte';
  import type { ThemeChoice as Choice } from '../../main/settings-contract.js';
  import type { ExtensionSwitch } from '../shell-store.js';
  import type { ResourceSummary, StorageStatus } from '../../storage/storage-contract.js';

  interface Props {
    themeChoice: Choice;
    onChooseTheme: (choice: Choice) => Promise<boolean>;
    // Undefined while the main process has not answered.
    extensions?: readonly ExtensionSwitch[];
    onSetExtension?: (id: string, enabled: boolean) => Promise<boolean>;
    storage?: StorageStatus;
    onUpdateReference?: (resource: string) => Promise<string | undefined>;
  }
  const {
    themeChoice, onChooseTheme, extensions, onSetExtension = () => Promise.resolve(false),
    storage, onUpdateReference = () => Promise.resolve('The update could not be started.')
  }: Props = $props();

  const resources = $derived(storage?.state === 'ready' ? storage.reference?.resources : undefined);
  const busy = $derived(storage?.reference?.refreshing === true);
  let referenceFailure = $state('');

  // "Updated today", "yesterday" or "N days ago", from the oldest fetch.
  function age(resource: ResourceSummary): string {
    if (!resource.fetchedAt) return '';
    const days = Math.floor((Date.now() - Date.parse(resource.fetchedAt)) / 86_400_000);
    return days <= 0 ? 'updated today' : days === 1 ? 'updated yesterday' : `updated ${days} days ago`;
  }

  function stateWords(resource: ResourceSummary): string {
    if (resource.updating) return resource.state === 'loaded' ? 'Updating…' : 'Loading…';
    if (resource.state === 'not loaded') return 'Not loaded';
    return resource.due ? `Out of date, ${age(resource)}` : `Loaded, ${age(resource)}`;
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

<PageLayout eyebrow="PREFERENCES" title="Settings">
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
            <button type="button" class="secondary" disabled={busy}
              aria-label="{resource.state === 'loaded' ? 'Update' : 'Load'} {resource.name}"
              onclick={() => { void load(resource); }}>{resource.state === 'loaded' ? 'Update' : 'Load'}</button>
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
                {#if extension.cards.length > 0}
                  <span class="hint">Cards: {extension.cards.join(', ')}</span>
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
  </section>
</PageLayout>
