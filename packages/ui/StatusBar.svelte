<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!--
  The status bar. P3-status-bar requires the active persona to be visible on
  every page, which is why it sits outside the pages rather than in one.

  It also carries, as of 2026-10-10 (`QGD-FRM-0012`, `QGD-LOG-0013`):

    - the data the operator is working in, named the way VS Code's status bar
      names the repository and branch. It names the active application's data,
      and it is empty until an application holds data (P8). Storage has no
      indicator of its own: there is no engine to start or stop.
    - Troubleshooting, which is where the stores, the logs, the level switch
      and the support bundle live. Podman Desktop puts Troubleshooting on its
      status bar the same way, with a Logs tab and a "collect logs as .zip".

  This component stays dumb: it is in `ui`, so it takes words and callbacks and
  owns no state. What the panel contains is the renderer's business.
-->
<script lang="ts">
  interface Props {
    // Who it is, or empty. The sentence is this component's.
    activePersona: string;
    // The data the operator is working in, named by the caller. Undefined
    // until an application holds data, and the slot is then empty.
    dataContext?: string;
    // Opens the Troubleshooting panel.
    onOpenTroubleshooting?: () => void;
    note?: string;
  }
  const {
    activePersona,
    dataContext,
    onOpenTroubleshooting,
    // What the product actually does, which is now two things: a credential
    // test, and fetching the reference data POTA and ADIF publish
    // (QGD-REF-0001, QGD-REF-0009, QGD-SEC-0020). It said "only when you test
    // a credential" until the reference load made that false.
    note = 'Stored locally · Connects to test a credential or update reference data'
  }: Props = $props();
</script>

<footer>
  <span id="active-persona">{activePersona ? `Active: ${activePersona}` : 'No active persona'}</span>
  <span id="data-context" data-empty={dataContext === undefined ? 'true' : 'false'}>{dataContext ?? ''}</span>
  {#if onOpenTroubleshooting}
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
