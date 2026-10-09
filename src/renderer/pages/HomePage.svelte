<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!--
  What the application opens on.

  Deliberately the page that asks nothing of anything: no credential is read
  to draw it (QGD-CRD-0009), and it is readable with the engine down. What it
  says is what this is, what it is doing, and where to go next.
-->
<script lang="ts">
  import PageLayout from '../ui/PageLayout.svelte';
  import { ICONS } from '../ui/icons.js';
  import type { EngineStatus } from '../../engine-contract.js';

  interface Destination {
    readonly id: string;
    readonly label: string;
    readonly description: string;
    readonly icon: string;
  }

  interface Props {
    version: string;
    activePersona: string;
    engine: EngineStatus | undefined;
    destinations: readonly Destination[];
    onGo: (id: string) => void;
  }
  const { version, activePersona, engine, destinations, onGo }: Props = $props();

  const ENGINE_WORDS: Record<string, string> = {
    starting: 'starting',
    running: 'running',
    stopped: 'stopped',
    failed: 'could not start',
    unavailable: 'not available'
  };

  const engineWords = $derived(
    engine ? (ENGINE_WORDS[engine.state] ?? engine.state) : 'being asked'
  );
</script>

<PageLayout title="QSO Graph Desktop" eyebrow="HOME">
  <section class="card" aria-labelledby="home-state-title">
    <h2 id="home-state-title">Right now</h2>
    <dl class="facts">
      <dt>Version</dt>
      <dd>{version}</dd>
      <dt>Active persona</dt>
      <dd>{activePersona || 'None yet'}</dd>
      <dt>Database</dt>
      <dd>
        {engineWords}{#if engine?.version}, PostgreSQL {engine.version}{/if}
        {#if engine?.reason}<span class="fact-note">{engine.reason}</span>{/if}
      </dd>
    </dl>
    <p class="hint">
      Everything here stays on this Mac. Nothing is sent anywhere until you ask
      for it.
    </p>
  </section>

  <section class="card" aria-labelledby="home-go-title">
    <h2 id="home-go-title">Where to go</h2>
    <ul class="destinations">
      {#each destinations as destination (destination.id)}
        <li>
          <button type="button" class="destination" onclick={() => onGo(destination.id)}>
            {#if ICONS[destination.icon]}
              <svg class="destination-icon" viewBox={ICONS[destination.icon]?.viewBox} aria-hidden="true" fill="currentColor">
                <path d={ICONS[destination.icon]?.path} />
              </svg>
            {/if}
            <span>
              <strong>{destination.label}</strong>
              <span class="hint">{destination.description}</span>
            </span>
          </button>
        </li>
      {/each}
    </ul>
  </section>
</PageLayout>
