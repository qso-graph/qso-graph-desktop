<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!--
  Settings. Appearance is here now; the Logs page QGD-LOG-0013 puts in Settings
  lands with the level switch and the export action that drive it, rather than
  as a heading with nothing behind it.
-->
<script lang="ts">
  import PageLayout from '../../ui/PageLayout.svelte';
  import ThemeChoice from '../../ui/ThemeChoice.svelte';
  import LogsPage from './LogsPage.svelte';
  import MovePersonasPage from './MovePersonasPage.svelte';
  import EnginePage from './EnginePage.svelte';
  import type { ThemeChoice as Choice } from '../../main/settings-contract.js';
  import type { LogsStatus } from '../../main/logs-contract.js';
  import type { AppInventory } from '../../main/apps-contract.js';
  import type { Level } from '../../logging/logging.js';
  import type { EngineStatus } from '../../engine/engine-contract.js';
  import type { ExportResult, ImportPreview, ImportResult } from '../../personas/persona-contract.js';

  interface Props {
    themeChoice: Choice;
    onChooseTheme: (choice: Choice) => Promise<boolean>;
    logs: LogsStatus | undefined;
    onSetLevel: (level: Level) => Promise<boolean>;
    onExport: () => Promise<string>;
    engine: EngineStatus | undefined;
    onStartEngine: () => Promise<void>;
    onStopEngine: () => Promise<void>;
    // What loaded and what each application holds, and how a grant is allowed
    // or withdrawn (QGD-APP-0012). Undefined until the main process has
    // answered, like the engine and the logs.
    apps: AppInventory | undefined;
    appsProblem: string | undefined;
    onSetGrant: (app: string, grant: string, allow: boolean) => Promise<boolean>;
    onExportPersonas: (passphrase: string) => Promise<ExportResult | string>;
    onInspectImport: (passphrase: string) => Promise<ImportPreview | string>;
    onApplyImport: (passphrase: string) => Promise<ImportResult | string>;
  }
  const {
    themeChoice, onChooseTheme, logs, onSetLevel, onExport,
    engine, onStartEngine, onStopEngine,
    apps, appsProblem, onSetGrant,
    onExportPersonas, onInspectImport, onApplyImport
  }: Props = $props();

  // Which grant is being written, so the one control that is working says so
  // and the others stay usable.
  let writing = $state('');
  let grantProblem = $state('');

  async function setGrant(
    app: string, grant: string, allow: boolean, control: HTMLInputElement
  ) {
    writing = `${app}:${grant}`;
    grantProblem = '';
    try {
      // The control shows what is held, not what was attempted.
      //
      // The browser has already moved the checkbox by the time this runs, and
      // `checked={grant.held}` does not rewrite the DOM when the value it was
      // given has not changed — so a refused withdrawal left an unticked box
      // beside an application that still held the grant. Restored by hand, the
      // same way ThemeChoice restores its select for the same reason.
      const held = allow;
      if (!await onSetGrant(app, grant, allow)) {
        grantProblem = 'That could not be saved. Nothing changed.';
        control.checked = !held;
      }
    } finally {
      writing = '';
    }
  }
</script>

<PageLayout eyebrow="PREFERENCES" title="Settings">
  <section class="card" aria-labelledby="appearance-title">
    <h2 id="appearance-title">Appearance</h2>
    <ThemeChoice choice={themeChoice} onChoose={onChooseTheme} />
  </section>

  <!--
    QGD-APP-0012: the operator can see what each application has been granted
    and withdraw it, and a withdrawal takes effect without a restart. An
    application starts with nothing; a grant the register marks as needing
    nobody is held as soon as it is asked for, and is shown rather than offered,
    because there is no decision to make about it.
  -->
  <section class="card" aria-labelledby="apps-title">
    <h2 id="apps-title">Applications</h2>
    {#if appsProblem}
      <p class="field-error" role="status" id="apps-unavailable">{appsProblem}</p>
    {:else if apps === undefined}
      <p class="hint" id="apps-reading">Reading which applications are installed…</p>
    {:else if apps.apps.length === 0 && apps.refused.length === 0}
      <p class="hint" id="apps-none">No applications are installed yet.</p>
    {:else}
      {#each apps.apps as app (app.id)}
        <div class="app">
          <h3 id="app-{app.id}">{app.name}</h3>
          <p class="hint">{app.tier}, version {app.version}</p>
          {#if app.grants.length === 0}
            <p class="hint">It asked for nothing, so there is nothing to allow.</p>
          {:else}
            <ul class="grants" aria-labelledby="app-{app.id}">
              {#each app.grants as grant (grant.id)}
                <li>
                  {#if grant.needsOperator}
                    <label>
                      <input
                        type="checkbox"
                        id="grant-{app.id}-{grant.id}"
                        checked={grant.held}
                        disabled={writing !== ''}
                        onchange={(event) => setGrant(app.id, grant.id, event.currentTarget.checked, event.currentTarget)}
                      />
                      <span class="grant-id">{grant.id}</span>
                    </label>
                  {:else}
                    <span class="grant-id" id="grant-{app.id}-{grant.id}">{grant.id}</span>
                    <span class="always">always allowed</span>
                  {/if}
                  <span class="what">{grant.what}</span>
                  {#if grant.notWhat}<span class="not-what">{grant.notWhat}</span>{/if}
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      {/each}
      {#if apps.refused.length > 0}
        <h3 id="apps-refused-title">Not loaded</h3>
        <ul class="refused" aria-labelledby="apps-refused-title">
          {#each apps.refused as entry (entry.source)}
            <li><span class="grant-id">{entry.source}</span><span class="what">{entry.reason}</span></li>
          {/each}
        </ul>
      {/if}
    {/if}
    {#if grantProblem}<p class="field-error" role="status" id="apps-problem">{grantProblem}</p>{/if}
  </section>
  <EnginePage status={engine} onStart={onStartEngine} onStop={onStopEngine} />
  <MovePersonasPage onExport={onExportPersonas} onInspect={onInspectImport} onImport={onApplyImport} />
  <LogsPage status={logs} {onSetLevel} {onExport} />
</PageLayout>

<style>
  .app { margin-top: 16px; }
  .app h3 { margin: 0 0 2px; }
  .grants, .refused { list-style: none; padding: 0; margin: 8px 0 0; display: flex; flex-direction: column; gap: 10px; }
  .grants li, .refused li { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 2px 10px; align-items: baseline; }
  .grants label { display: flex; align-items: baseline; gap: 8px; }
  .grant-id { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.9rem; }
  .always { color: var(--ink-muted); font-size: 0.85rem; }
  .what, .not-what { grid-column: 1 / -1; color: var(--ink-muted); font-size: 0.9rem; }
</style>
