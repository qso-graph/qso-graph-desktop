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
    // The active callsign, or empty. The sentence is this component's. Only
    // the callsign: the operator's description beside it read as a second
    // callsign here (KI7MT, 2026-10-22).
    activeCallsign: string;
    // Where they are operating from: the active station's name, or empty
    // (QGD-STN-0005). Named beside the persona, as TQSL pairs a certificate
    // with a location.
    activeStation?: string;
    // The data the operator is working in, named by the caller. Undefined
    // until an application holds data, and the slot is then empty.
    dataContext?: string;
    // Opens the Troubleshooting panel.
    onOpenTroubleshooting?: () => void;
  }
  const {
    activeCallsign,
    activeStation = '',
    dataContext,
    onOpenTroubleshooting
  }: Props = $props();
  // The line that said when the application goes online is gone: Home's cards
  // made it untrue, and it is said in full under Help → Privacy and Licences
  // (QGD-FRM-0015, KI7MT 2026-10-22).
</script>

<footer>
  <span id="active-persona">{activeCallsign ? `Callsign: ${activeCallsign}` : 'No active callsign'}</span>
  <span id="active-station">{activeStation ? `Location: ${activeStation}` : 'No active location'}</span>
  <span id="data-context" data-empty={dataContext === undefined ? 'true' : 'false'}>{dataContext ?? ''}</span>
  {#if onOpenTroubleshooting}
    <button type="button" id="open-troubleshooting" class="bar-button" onclick={onOpenTroubleshooting}
    >Troubleshooting</button>
  {/if}
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
