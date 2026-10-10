<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!--
  Troubleshooting, reached from the status bar (`QGD-LOG-0013`,
  `QGD-FRM-0012`).

  Podman Desktop's model: one place, reached from the status bar, holding the
  logs, a way to gather them as a .zip, and the engine's own state and repair
  actions. Not a destination in the navigation and not a section of Settings,
  because an operator comes here on one occasion — something is wrong and they
  are about to tell somebody about it.

  It composes the two pages that used to be embedded in Settings rather than
  reimplementing them: the engine's detail and the logs with their level switch
  and export. Those components are unchanged, which is why this move costs no
  behaviour.
-->
<script lang="ts">
  import EnginePage from './EnginePage.svelte';
  import LogsPage from './LogsPage.svelte';
  import type { LogsStatus } from '../../main/logs-contract.js';
  import type { Level } from '../../logging/logging.js';
  import type { EngineStatus } from '../../engine/engine-contract.js';

  interface Props {
    engine: EngineStatus | undefined;
    onStartEngine: () => Promise<void>;
    onStopEngine: () => Promise<void>;
    logs: LogsStatus | undefined;
    onSetLevel: (level: Level) => Promise<boolean>;
    onExport: () => Promise<string>;
    onClose: () => void;
  }
  const { engine, onStartEngine, onStopEngine, logs, onSetLevel, onExport, onClose }: Props = $props();

  // Escape closes it, which is what every overlay on this platform does and
  // what a keyboard-only operator will try first (QGD-FRM-0010's keyboard
  // completeness applies to a panel as much as to a page).
  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') onClose();
  }
</script>

<svelte:window onkeydown={onKeydown} />

<section id="troubleshooting" class="panel" aria-labelledby="troubleshooting-title">
  <header>
    <h2 id="troubleshooting-title">Troubleshooting</h2>
    <button type="button" id="close-troubleshooting" onclick={onClose}>Close</button>
  </header>
  <p class="hint">
    What the database is doing, and the logs this machine keeps. Nothing here
    leaves the machine unless you save it and send it.
  </p>
  <EnginePage status={engine} onStart={onStartEngine} onStop={onStopEngine} />
  <LogsPage status={logs} {onSetLevel} {onExport} />
</section>

<style>
  .panel {
    position: absolute;
    /* Clear of the rail (92px, 76px under 850px) and of the status bar it is
       opened from. It is not modal — it answers a question while you keep
       working — so it must not cover the navigation. Covering the rail also
       meant the smoke suite could not navigate while it was open, which is how
       this was found. */
    inset: auto 16px 44px 108px;
    max-height: 70vh;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 20px 24px;
    border: 1px solid var(--border-strong);
    border-radius: 10px;
    background: var(--page);
    box-shadow: 0 10px 40px rgb(0 0 0 / 0.25);
    z-index: 20;
  }
  @media (max-width: 850px) { .panel { inset: auto 12px 44px 88px; } }
  header { display: flex; align-items: center; justify-content: space-between; }
  header h2 { margin: 0; }
  .hint { margin: 0; }
</style>

