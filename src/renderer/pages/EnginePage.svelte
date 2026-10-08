<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!--
  What the database is doing, in Settings.

  QGD-ENG-0003 is the rule this is a demonstration of as much as a display:
  the shell is drawn and usable before the engine is up, and if it never comes
  up this card says so and nothing else changes.
-->
<script lang="ts">
  import Field, { type ControlAttributes } from '../ui/Field.svelte';
  import type { EngineStatus } from '../../engine-contract.js';

  interface Props {
    status: EngineStatus | undefined;
    onStart: () => Promise<void>;
    onStop: () => Promise<void>;
  }
  const { status, onStart, onStop }: Props = $props();

  const WORDS: Record<string, string> = {
    starting: 'Starting…',
    running: 'Running',
    stopped: 'Stopped',
    failed: 'Could not start',
    unavailable: 'Not available'
  };

  let working = $state(false);

  // The engine is slow on purpose — it is a database — so the button says what
  // it is doing rather than appearing to have been ignored.
  async function act(what: () => Promise<void>): Promise<void> {
    working = true;
    try { await what(); } finally { working = false; }
  }
</script>

<section class="card" aria-labelledby="engine-title">
  <h2 id="engine-title">Database</h2>

  {#if status}
    <Field
      id="engine-state"
      label="State"
      hint={status.version ? `PostgreSQL ${status.version}, on this Mac and nowhere else.` : 'Bundled with QSO Graph Desktop and run only while it is open.'}
      error={status.reason}
    >
      {#snippet control({ describedBy, invalid }: ControlAttributes)}
        <input id="engine-state" class="narrow" type="text" readonly value={WORDS[status.state] ?? status.state}
               aria-describedby={describedBy} aria-invalid={invalid} />
      {/snippet}
    </Field>

    <div class="credential-test">
      {#if status.state === 'running'}
        <button type="button" class="secondary" disabled={working} onclick={() => act(onStop)}>Stop</button>
      {:else}
        <button type="button" class="secondary" disabled={working || status.state === 'starting'}
                onclick={() => act(onStart)}>Start</button>
      {/if}
      <p class="hint">Your logs and reference data live here. Nothing in it leaves this Mac.</p>
    </div>
  {:else}
    <p class="hint">Asking the database how it is…</p>
  {/if}
</section>
