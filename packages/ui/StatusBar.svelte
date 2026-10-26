<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!--
  The status bar. P3-status-bar requires the active callsign to be visible on
  every page, which is why it sits outside the pages rather than in one.

  The callsign and the Location are each a way to its page, to change it
  (KI7MT, 2026-10-24). The slot for the data an application works in is gone
  until an application holds data (P8): empty, it was in the layout for
  nothing. Storage has no indicator of its own: there is no engine to start
  or stop.

  It also carries, as of 2026-10-10 (`QGD-FRM-0012`, `QGD-LOG-0013`):

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
    // (QGD-STN-0005). Named beside the callsign, as TQSL pairs a certificate
    // with a location.
    activeStation?: string;
    // Each opens its page: Callsigns, and Locations.
    onOpenCallsigns?: () => void;
    onOpenLocations?: () => void;
    // Opens the Troubleshooting panel.
    onOpenTroubleshooting?: () => void;
    // A newer version (QGD-FRM-0019): ready to install on restart, or, for a
    // build that cannot install it itself, available from its page. One
    // quiet line, never a dialog; ignored, a ready one installs on quit.
    update?: { readonly kind: 'ready' | 'available'; readonly version: string; readonly installable?: boolean };
    onWhatsNew?: () => void;
    onInstallUpdate?: () => void;
    onRestartToUpdate?: () => void;
  }
  const {
    activeCallsign,
    activeStation = '',
    onOpenCallsigns,
    onOpenLocations,
    onOpenTroubleshooting,
    update,
    onWhatsNew,
    onInstallUpdate,
    onRestartToUpdate
  }: Props = $props();
  // The line that said when the application goes online is gone: Home's cards
  // made it untrue, and it is said in full under Help → Privacy and Licences
  // (QGD-FRM-0015, KI7MT 2026-10-22).
</script>

<footer>
  <!-- Each slot in its place's hue, the word always beside it (style.css). -->
  <span class="status-pair">
    <button type="button" id="active-callsign" class="status-slot bar-slot" data-hue="callsigns" onclick={onOpenCallsigns}
      title="Callsigns: change the active callsign">{activeCallsign ? `Callsign: ${activeCallsign}` : 'No active callsign'}</button>
    <button type="button" id="active-station" class="status-slot bar-slot" data-hue="locations" onclick={onOpenLocations}
      title="Locations: change the active location">{activeStation ? `Location: ${activeStation}` : 'No active location'}</button>
  </span>
  {#if update}
    <span id="update-note" class="update-note">
      {update.kind === 'ready' ? `Version ${update.version} is ready.` : `Version ${update.version} is available.`}
      {#if onWhatsNew}<button type="button" class="bar-link" id="update-whats-new" onclick={onWhatsNew}>What's new</button>{/if}
      {#if update.kind === 'available' && update.installable && onInstallUpdate}
        · <button type="button" class="bar-link" id="update-install-bar" onclick={onInstallUpdate}>Download and install</button>
      {/if}
      {#if update.kind === 'ready' && onRestartToUpdate}
        · <button type="button" class="bar-link" id="update-restart-bar" onclick={onRestartToUpdate}>Restart to update</button>
      {/if}
    </span>
  {/if}
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
  .status-pair { display: flex; gap: 24px; align-items: center; }
  /* Reads as the line it was, and says it is a way somewhere on hover. */
  .bar-slot {
    background: none;
    border: 0;
    padding: 0;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  .bar-slot:hover { color: var(--ink); text-decoration: underline; }
  .bar-link {
    background: none;
    border: 0;
    padding: 0;
    color: inherit;
    font: inherit;
    text-decoration: underline;
    cursor: pointer;
  }
</style>
