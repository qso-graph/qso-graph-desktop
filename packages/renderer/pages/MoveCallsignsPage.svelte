<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!--
  Moving callsigns and Locations to another computer (QGD-PSN-0007 to
  QGD-PSN-0011). Logins do not move (KI7MT, 2026-10-23: "the Callsigns and
  Locations are what we can manage. Users still manage their credentials"):
  each service is listed again on the other computer, and its login is
  entered there. A restore is onto a clean slate: what is here is removed
  first, never merged.

  Two things this screen is careful about:

  **The passphrase is the only key there is.** It is not stored, not
  defaulted, and not recoverable — so an export asks for it twice, and says
  plainly that losing it loses the file. A product that let someone export
  their credentials behind a passphrase they mistyped has given them a file
  that looks like a backup and is not one.

  **An import says what it would do before it does it.** Choosing a file shows
  what is in it and which callsigns it would overwrite; nothing changes until
  that is confirmed. The file is chosen and read by the main process — a
  renderer never touches one (QGD-PSN-0011).
-->
<script lang="ts">
  import Field, { type ControlAttributes } from '../../ui/Field.svelte';
  import type { ExportResult, ImportPreview, ImportResult } from '../../callsigns/callsign-contract.js';

  interface Props {
    onExport: (passphrase: string) => Promise<ExportResult | string>;
    onInspect: (passphrase: string) => Promise<ImportPreview | string>;
    onImport: (passphrase: string, replace: boolean) => Promise<ImportResult | string>;
  }
  const { onExport, onInspect, onImport }: Props = $props();

  let exportPassphrase = $state('');
  let exportAgain = $state('');
  let exporting = $state(false);
  let exportResult = $state('');

  let importPassphrase = $state('');
  let inspecting = $state(false);
  let importing = $state(false);
  let preview = $state<ImportPreview | undefined>(undefined);
  let importResult = $state('');
  // Said yes to removing what is here first (a clean slate).
  let removeFirst = $state(false);
  const hasHere = $derived(preview !== undefined && (preview.here.length > 0 || preview.locationsHere > 0));

  // Said before the button is pressed, not after (QGD-CRD-0011).
  const exportWhy = $derived(
    exportPassphrase.length === 0 ? 'Enter a passphrase to export.'
    : exportAgain.length === 0 ? 'Enter the passphrase a second time.'
    : exportPassphrase !== exportAgain ? 'The two passphrases are not the same.'
    : ''
  );
  const canExport = $derived(exportWhy === '' && !exporting);
  const canInspect = $derived(importPassphrase.length > 0 && !inspecting && !importing);

  async function runExport() {
    exporting = true;
    exportResult = '';
    try {
      const answer = await onExport(exportPassphrase);
      exportResult = typeof answer === 'string'
        ? answer
        : `Exported ${answer.bytes.toLocaleString()} bytes to ${answer.written}. ` +
          'It can only be opened with that passphrase.';
      if (typeof answer !== 'string') { exportPassphrase = ''; exportAgain = ''; }
    } finally {
      exporting = false;
    }
  }

  async function runInspect() {
    inspecting = true;
    importResult = '';
    preview = undefined;
    try {
      const answer = await onInspect(importPassphrase);
      if (typeof answer === 'string') importResult = answer;
      else { preview = answer; removeFirst = false; }
    } finally {
      inspecting = false;
    }
  }

  async function runImport() {
    importing = true;
    try {
      const answer = await onImport(importPassphrase, removeFirst);
      importResult = typeof answer === 'string'
        ? answer
        : `Restored ${answer.callsigns} callsign${answer.callsigns === 1 ? '' : 's'} ` +
          `and ${answer.locations} Location${answer.locations === 1 ? '' : 's'}. Enter each service's login on the Callsigns page.`;
      if (typeof answer !== 'string') { preview = undefined; importPassphrase = ''; }
    } finally {
      importing = false;
    }
  }
</script>

{#snippet exportKey({ describedBy, invalid }: ControlAttributes)}
  <input id="export-passphrase" type="password" autocomplete="new-password"
    bind:value={exportPassphrase} aria-describedby={describedBy} aria-invalid={invalid} />
{/snippet}

{#snippet exportKeyAgain({ describedBy, invalid }: ControlAttributes)}
  <input id="export-passphrase-again" type="password" autocomplete="new-password"
    bind:value={exportAgain} aria-describedby={describedBy} aria-invalid={invalid} />
{/snippet}

{#snippet importKey({ describedBy, invalid }: ControlAttributes)}
  <input id="import-passphrase" type="password" autocomplete="current-password"
    bind:value={importPassphrase} aria-describedby={describedBy} aria-invalid={invalid} />
{/snippet}

<section class="card" aria-labelledby="move-title">
  <h2 id="move-title">Move callsigns and Locations to another computer</h2>
  <p class="hint">
    One encrypted file holding your callsigns, the services each one uses, and
    your Locations. Logins are not in it: enter them again on the other
    computer. Nothing is sent anywhere — the file goes where you choose.
  </p>

  <h3>Export</h3>
  <Field
    id="export-passphrase"
    label="Passphrase"
    hint="The only key to the file. It is not stored here and cannot be recovered: if you lose it, nobody can open the file, including you."
    control={exportKey}
  />
  <Field id="export-passphrase-again" label="Passphrase again" error={exportWhy} control={exportKeyAgain} />
  <!-- Spaced from the line above it, which may be a field's message
       (KI7MT, 2026-10-22: it sat right under "Enter a passphrase to
       export."). -->
  <button type="button" class="after-field" class:working={exporting} disabled={!canExport} onclick={runExport}
  >{exporting ? 'Exporting…' : 'Export…'}</button>
  <p id="export-callsigns-result" role="status">{exportResult}</p>

  <h3>Import</h3>
  <Field
    id="import-passphrase"
    label="Passphrase of the file"
    hint="The passphrase the file was made with."
    control={importKey}
  />
  <button
    type="button"
    class:working={inspecting}
    disabled={!canInspect}
    aria-describedby={canInspect ? undefined : 'import-why'}
    onclick={runInspect}
  >{inspecting ? 'Opening…' : 'Choose a file…'}</button>
  {#if !canInspect && !inspecting && !importing}
    <p class="hint" id="import-why">Enter the passphrase the file was made with.</p>
  {/if}

  {#if preview}
    <div class="preview">
      <p>
        This file was made on {preview.created.slice(0, 10)} and holds
        {preview.callsigns} callsign{preview.callsigns === 1 ? '' : 's'} and
        {preview.locations.length} Location{preview.locations.length === 1 ? '' : 's'}.
      </p>
      {#if preview.arriving.length}<p>Callsigns: {preview.arriving.join(', ')}</p>{/if}
      {#if preview.locations.length}<p>Locations: {preview.locations.join(', ')}</p>{/if}
      {#if preview.logins > 0}
        <p class="hint">It also holds {preview.logins} login{preview.logins === 1 ? '' : 's'} from an earlier release, which are not restored: enter them again.</p>
      {/if}
      {#if hasHere}
        <!-- A clean slate, never a merge (KI7MT, 2026-10-23). -->
        <p class="overwrite">
          This computer already has
          {#if preview.here.length}{preview.here.length} callsign{preview.here.length === 1 ? '' : 's'} ({preview.here.join(', ')}){/if}{#if preview.here.length && preview.locationsHere} and {/if}{#if preview.locationsHere}{preview.locationsHere} Location{preview.locationsHere === 1 ? '' : 's'}{/if}.
          A restore removes them first, with the logins saved for those callsigns.
        </p>
        <label class="checkbox-row"><input type="checkbox" id="restore-remove-first" bind:checked={removeFirst} /> Remove them, then restore</label>
      {/if}
      <button type="button" class:working={importing} disabled={importing || (hasHere && !removeFirst)} onclick={runImport}
      >{importing ? 'Restoring…' : 'Restore'}</button>
      <button type="button" disabled={importing} onclick={() => { preview = undefined; }}>Cancel</button>
    </div>
  {/if}
  <p id="import-callsigns-result" role="status">{importResult}</p>
</section>

<style>
  h3 {
    margin: 20px 0 8px;
    font-size: 0.8rem;
    color: var(--ink-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .preview {
    margin-top: 12px;
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface-sunken);
  }
  .preview p { margin: 0 0 8px; }
  /* The one line an operator has to read before pressing Import. */
  .overwrite { color: var(--danger); font-weight: 600; }
</style>
