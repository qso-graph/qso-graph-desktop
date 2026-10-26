<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!--
  Moving callsigns and Locations to another computer (QGD-PSN-0007 to
  QGD-PSN-0011). KI7MT, 2026-10-23: "we don't store anything that's not
  publicly available"; logins never move.

  What the file holds is public: each callsign, the services it uses with
  nothing of its login, and the Locations, their places no closer than a grid
  square and their notes left behind. So it is a plain file, with no
  passphrase to lose. Each service's login is entered again on the other
  computer.

  **A restore says what it would do before it does it**, and is onto a clean
  slate: what is on this computer is removed first, only once the operator
  says so, and nothing is merged. The file is chosen and read by the main
  process; a renderer never touches one (QGD-PSN-0011).

  **One backup, with ticks** (#64): Callsigns and Locations, and Settings,
  both ticked, which is a full backup. A restore ticks what the file holds,
  and each part ticked replaces this computer's. Restoring the settings
  restarts the application, which says so first.
-->
<script lang="ts">
  import type { BackupPart, ExportResult, ImportPreview, ImportResult } from '../../callsigns/callsign-contract.js';

  interface Props {
    onExport: (parts: BackupPart[]) => Promise<ExportResult | string>;
    onInspect: () => Promise<ImportPreview | string>;
    onImport: (replace: boolean, parts: BackupPart[]) => Promise<ImportResult | string>;
  }
  const { onExport, onInspect, onImport }: Props = $props();

  let exporting = $state(false);
  let exportResult = $state('');
  let inspecting = $state(false);
  let importing = $state(false);
  let preview = $state<ImportPreview | undefined>(undefined);
  let importResult = $state('');
  // Said yes to removing what is here first (a clean slate).
  let removeFirst = $state(false);
  // What to back up, and what to restore of what the file holds (#64).
  let backUpCallsigns = $state(true);
  let backUpSettings = $state(true);
  let restoreCallsigns = $state(true);
  let restoreSettings = $state(true);
  const backUpParts = $derived<BackupPart[]>([...(backUpCallsigns ? ['callsigns' as const] : []), ...(backUpSettings ? ['settings' as const] : [])]);
  const restoreParts = $derived<BackupPart[]>(preview === undefined ? [] : [
    ...(restoreCallsigns && preview.parts.includes('callsigns') ? ['callsigns' as const] : []),
    ...(restoreSettings && preview.parts.includes('settings') ? ['settings' as const] : [])
  ]);
  const hasHere = $derived(preview !== undefined && restoreParts.includes('callsigns') && (preview.here.length > 0 || preview.locationsHere > 0));

  async function runExport() {
    exporting = true;
    exportResult = '';
    try {
      const answer = await onExport(backUpParts);
      exportResult = typeof answer === 'string' ? answer : `Backed up to ${answer.written}.`;
    } finally {
      exporting = false;
    }
  }

  async function runInspect() {
    inspecting = true;
    importResult = '';
    preview = undefined;
    try {
      const answer = await onInspect();
      if (typeof answer === 'string') importResult = answer;
      else { preview = answer; removeFirst = false; restoreCallsigns = true; restoreSettings = true; }
    } finally {
      inspecting = false;
    }
  }

  function restored(answer: ImportResult): string {
    const said: string[] = [];
    if (restoreParts.includes('callsigns')) {
      said.push(`Restored ${answer.callsigns} callsign${answer.callsigns === 1 ? '' : 's'} ` +
        `and ${answer.locations} Location${answer.locations === 1 ? '' : 's'}. Enter each service's login on the Callsigns page.`);
    }
    if (answer.settings) said.push('Settings restored. QSO Graph Desktop restarts now to take them up.');
    return said.join(' ');
  }

  async function runImport() {
    importing = true;
    try {
      const answer = await onImport(removeFirst, restoreParts);
      importResult = typeof answer === 'string' ? answer : restored(answer);
      if (typeof answer !== 'string') preview = undefined;
    } finally {
      importing = false;
    }
  }
</script>

<section class="card" aria-labelledby="move-title">
  <h2 id="move-title">Back up and restore</h2>
  <p class="hint">
    Move your callsigns, Locations and settings to another computer, or keep a
    copy: one file, all of it public. Logins are not in it: enter them again on
    the other computer. Location notes stay on this one. Nothing is sent
    anywhere: the file goes where you choose.
  </p>

  <h3>Back up</h3>
  <fieldset class="parts">
    <legend class="visually-hidden">What to back up</legend>
    <label class="checkbox-row"><input type="checkbox" id="backup-callsigns" bind:checked={backUpCallsigns} /> Callsigns and Locations</label>
    <label class="checkbox-row"><input type="checkbox" id="backup-settings" bind:checked={backUpSettings} /> Settings: theme, pins, extensions, POTA Focus Area, updates</label>
  </fieldset>
  <button type="button" id="backup-export" class:working={exporting} disabled={exporting || backUpParts.length === 0} onclick={runExport}
  >{exporting ? 'Backing up…' : 'Back up to a file…'}</button>
  <p id="export-callsigns-result" role="status">{exportResult}</p>

  <h3>Restore</h3>
  <button type="button" id="backup-import" class:working={inspecting} disabled={inspecting || importing} onclick={runInspect}
  >{inspecting ? 'Opening…' : 'Choose a backup…'}</button>

  {#if preview}
    <div class="preview">
      <p>This backup was made on {preview.created.slice(0, 10)}. Restore:</p>
      <fieldset class="parts">
        <legend class="visually-hidden">What to restore</legend>
        {#if preview.parts.includes('callsigns')}
          <label class="checkbox-row"><input type="checkbox" id="restore-callsigns" bind:checked={restoreCallsigns} />
            {preview.callsigns} callsign{preview.callsigns === 1 ? '' : 's'} and
            {preview.locations.length} Location{preview.locations.length === 1 ? '' : 's'}</label>
          {#if preview.arriving.length}<p class="hint">Callsigns: {preview.arriving.join(', ')}</p>{/if}
          {#if preview.locations.length}<p class="hint">Locations: {preview.locations.join(', ')}</p>{/if}
        {/if}
        {#if preview.parts.includes('settings')}
          <label class="checkbox-row"><input type="checkbox" id="restore-settings" bind:checked={restoreSettings} />
            Settings, in place of this computer's</label>
          {#if restoreSettings}<p class="hint" id="restore-restarts">QSO Graph Desktop restarts to take them up.</p>{/if}
        {/if}
      </fieldset>
      {#if hasHere}
        <!-- A clean slate, never a merge (KI7MT, 2026-10-23). -->
        <p class="overwrite">
          This computer already has
          {#if preview.here.length}{preview.here.length} callsign{preview.here.length === 1 ? '' : 's'} ({preview.here.join(', ')}){/if}{#if preview.here.length && preview.locationsHere} and {/if}{#if preview.locationsHere}{preview.locationsHere} Location{preview.locationsHere === 1 ? '' : 's'}{/if}.
          A restore removes them first, with the logins saved for those callsigns.
        </p>
        <label class="checkbox-row"><input type="checkbox" id="restore-remove-first" bind:checked={removeFirst} /> Remove them, then restore</label>
      {/if}
      <button type="button" id="restore-apply" class:working={importing} disabled={importing || restoreParts.length === 0 || (hasHere && !removeFirst)} onclick={runImport}
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
  .parts { border: 0; margin: 0 0 8px; padding: 0; }
  .parts .hint { margin: 0 0 4px 1.8em; }
  /* The one line an operator has to read before pressing Restore. */
  .overwrite { color: var(--danger); font-weight: 600; }
</style>
