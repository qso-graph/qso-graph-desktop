<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!--
  The status bar. P3-status-bar requires the active persona to be visible on
  every page, which is why it sits outside the pages rather than in one.

  It carries two more things as of 2026-10-10, both of which were pages in
  Settings (`QGD-FRM-0012`, `QGD-LOG-0013`):

    - what the database is doing, as an indicator. A glance answers it; the
      detail, and starting and stopping, are a click away.
    - Troubleshooting, which is where the logs, the level switch and the
      support bundle live.

  Both follow Podman Desktop, which shows engine and provider state on its own
  status bar and puts Troubleshooting there with a Logs tab and a "collect logs
  as .zip". A log viewer is something an operator needs on one occasion — they
  are reporting a fault — so it is reachable from everywhere and in the way of
  nothing.

  This component stays dumb: it is in `ui`, so it takes words and callbacks and
  owns no state. What the panel contains is the renderer's business.
-->
<script lang="ts">
  interface Props {
    // Who it is, or empty. The sentence is this component's.
    activePersona: string;
    // What the database is doing, already turned into a word by the caller,
    // and undefined until the main process has answered.
    engineState?: string;
    // Opens the Troubleshooting panel. The engine indicator opens the same
    // panel rather than a second one, which is what Podman does and what
    // keeps one overlay in this application rather than two.
    onOpenTroubleshooting?: () => void;
    note?: string;
  }
  const {
    activePersona,
    engineState,
    onOpenTroubleshooting,
    // What the product actually does, which is now two things: a credential
    // test, and fetching the reference data POTA and ADIF publish
    // (QGD-REF-0001, QGD-REF-0009, QGD-SEC-0020). It said "only when you test
    // a credential" until the reference load made that false.
    note = 'Stored locally · Connects to test a credential or update reference data'
  }: Props = $props();

  // A word, not a colour, carries the state: a colour alone is not something
  // a screen reader reaches, and not something everyone can tell apart
  // (QGD-CRD-0011 is the same rule for a control that cannot be used).
  const engineLabel = $derived(engineState === undefined
    ? 'Database: asking…'
    : `Database: ${engineState.charAt(0).toUpperCase()}${engineState.slice(1)}`);
</script>

<footer>
  <span id="active-persona">{activePersona ? `Active: ${activePersona}` : 'No active persona'}</span>
  {#if onOpenTroubleshooting}
    <button type="button" id="engine-indicator" class="bar-button" onclick={onOpenTroubleshooting}
            data-state={engineState ?? 'unknown'}>{engineLabel}</button>
    <button type="button" id="open-troubleshooting" class="bar-button" onclick={onOpenTroubleshooting}
    >Troubleshooting</button>
  {/if}
  <span id="connection-note">{note}</span>
</footer>

<style>
  .bar-button {
    background: transparent;
    border: 1px solid var(--border);
    color: inherit;
    font: inherit;
    padding: 2px 8px;
    border-radius: 5px;
    cursor: pointer;
  }
  .bar-button:hover { border-color: var(--border-strong); }
</style>
