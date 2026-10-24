<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!--
  QGD-LOG-0013: the Logs page Settings carries. It drives behaviour that
  already exists — QGD-LOG-0009 to QGD-LOG-0012 — and implements none of it.

  The level shown is the level in force, read back from the main process after
  every change, so a raise that was refused or that has already expired is
  displayed as what it is rather than as what was asked for.
-->
<script lang="ts">
  import Field, { type ControlAttributes } from '../../ui/Field.svelte';
  import { LOG_LEVELS, type LogsStatus } from '../../main/logs-contract.js';
  import { isLevel, type Level } from '../../logging/logging.js';

  interface Props {
    status: LogsStatus | undefined;
    onSetLevel: (level: Level) => Promise<boolean>;
    // Answers with the line to show. The wording lives with the caller, which
    // is the one place that knows what actually happened.
    onExport: () => Promise<string>;
  }
  const { status, onSetLevel, onExport }: Props = $props();

  let failed = $state(false);
  let exporting = $state(false);
  let exportResult = $state('');

  const revertAfter = $derived(
    status ? Math.round(status.revertAfterMs / 60_000) : 0
  );

  async function levelChanged(event: Event & { currentTarget: HTMLSelectElement }): Promise<void> {
    const select = event.currentTarget;
    const value = select.value;
    if (!isLevel(value) || !status) { select.value = status?.level ?? ''; return; }
    const saved = await onSetLevel(value);
    failed = !saved;
    // Same rule as the theme control: the select shows what is in force, and
    // the browser has already moved it.
    if (!saved) select.value = status.level;
  }

  async function exportDiagnostics(): Promise<void> {
    exporting = true;
    exportResult = '';
    try {
      exportResult = await onExport();
    } finally {
      exporting = false;
    }
  }
</script>

<section class="card" aria-labelledby="logs-title">
  <h2 id="logs-title">Logs</h2>

  {#if status}
    <Field
      id="log-level"
      label="Detail level"
      hint={`Normally ${status.defaultLevel}. More detail than that turns itself off again after ${revertAfter} minutes and when QSO Graph Desktop restarts, so it cannot be left on by accident.`}
      error={failed ? 'The level could not be saved. It is unchanged.' : undefined}
    >
      {#snippet control({ describedBy, invalid }: ControlAttributes)}
        <select id="log-level" value={status.level} onchange={levelChanged} aria-describedby={describedBy} aria-invalid={invalid}>
          {#each LOG_LEVELS as level (level)}
            <option value={level}>{level}</option>
          {/each}
        </select>
      {/snippet}
    </Field>

    <div class="credential-test">
      <button id="export-diagnostics" class="secondary" type="button" disabled={exporting} onclick={exportDiagnostics}>
        Export diagnostics
      </button>
      <p id="export-result" role="status">{exportResult}</p>
    </div>
    <p class="hint">
      Writes one archive of the logs where you choose. The logs never record a
      password or key, and the archive is checked for them again as it is
      written. Nothing is sent anywhere — you decide who gets it.
    </p>
    <p class="hint">Logs are kept in <span id="log-directory">{status.directory}</span></p>
  {:else}
    <p class="hint">Reading the log settings…</p>
  {/if}
</section>
