<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!--
  Storage, in Troubleshooting (`QGD-FRM-0012`, `QGD-ENG-0001`).

  Where the stores are, how big they are, and whether reference data is
  loaded, with each source and when it was fetched. There is nothing to start
  or stop: storage is files the application opens. QGD-ENG-0003 still holds:
  the shell is drawn and usable whatever this says.
-->
<script lang="ts">
  import Field, { type ControlAttributes } from '../../ui/Field.svelte';
  import type { DatasetSummary, StorageStatus } from '../../storage/storage-contract.js';

  interface Props { status: StorageStatus | undefined }
  const { status }: Props = $props();

  const WORDS: Record<string, string> = {
    starting: 'Opening…',
    ready: 'Ready',
    failed: 'Could not open',
    unavailable: 'Not available'
  };

  // Sizes as a person reads them. Bytes are exact and unreadable at this scale.
  function size(bytes: number | null | undefined): string {
    if (bytes === null || bytes === undefined) return 'none yet';
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  // The date only: when POTA or ADIF last sent this data. In the operator's
  // own form, from the system.
  function when(fetchedAt: string | undefined): string {
    if (!fetchedAt) return '';
    const date = new Date(fetchedAt);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString();
  }

  function describe(name: string, dataset: DatasetSummary): string {
    if (dataset.state !== 'loaded') return `${name}: not loaded`;
    const parts = [name];
    if (dataset.version) parts.push(dataset.version);
    if (dataset.rows !== undefined) parts.push(`${dataset.rows.toLocaleString()} rows`);
    const fetched = when(dataset.fetchedAt);
    return fetched ? `${parts.join(', ')}, fetched ${fetched}` : parts.join(', ');
  }

  const datasets = $derived(status?.reference ? [
    describe('ADIF definitions', status.reference.adif),
    describe('POTA parks', status.reference.parks),
    describe('POTA programs', status.reference.programs),
    describe('POTA locations', status.reference.locations)
  ] : []);
</script>

<section class="card" aria-labelledby="storage-title">
  <h2 id="storage-title">Storage</h2>

  {#if status}
    <Field id="storage-state" label="State" error={status.reason}
           hint={status.folder ? 'Nothing in it leaves this computer.' : undefined}>
      {#snippet control({ describedBy, invalid }: ControlAttributes)}
        <input id="storage-state" class="narrow" type="text" readonly value={WORDS[status.state] ?? status.state}
               aria-describedby={describedBy} aria-invalid={invalid} />
      {/snippet}
    </Field>

    <!-- The folder and the sizes in elements of their own, so a screenshot can
         mask the values that change from run to run and still compare the
         words around them. -->
    {#if status.folder}
      <p class="hint" id="storage-folder-line">Folder: <span id="storage-folder">{status.folder}</span></p>
    {/if}
    {#if status.sizes}
      <p class="hint" id="storage-sizes">
        Your data: <span class="storage-size">{size(status.sizes.state)}</span>.
        Reference data: <span class="storage-size">{size(status.sizes.reference)}</span>.
      </p>
    {/if}

    {#if status.reference}
      <h3 id="reference-title">Reference data{#if status.reference.refreshing} (updating…){/if}</h3>
      <ul id="reference-datasets" aria-labelledby="reference-title">
        {#each datasets as line (line)}<li>{line}</li>{/each}
      </ul>
    {/if}
  {:else}
    <p class="hint">Opening storage…</p>
  {/if}
</section>

<style>
  h3 { font-size: 0.95rem; margin: 4px 0 0; }
  ul { margin: 0; padding-left: 18px; }
  li { line-height: 1.6; }
</style>
