<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!--
  The welcome, as WSJT-X shows one (QGD-FRM-0016, KI7MT 2026-10-22): the
  release, what is new, where to report a problem, and thanks to those who
  built it. It closes itself after twenty seconds, or when closed; "Don't
  show this again" holds until the next release. It sits over the window and
  delays nothing: the application starts underneath it.
-->
<script lang="ts">
  import { onDestroy } from 'svelte';
  import { WHATS_NEW } from '../../ui/release.js';
  import { CONTRIBUTORS } from '../../ui/contributors.js';

  interface Props {
    version: string;
    // Called once, with whether the operator asked not to see it again.
    onClose: (hideForThisRelease: boolean) => void;
  }
  const { version, onClose }: Props = $props();

  const SECONDS = 20;
  let left = $state(SECONDS);
  let hide = $state(false);
  let closed = false;
  const close = () => { if (!closed) { closed = true; onClose(hide); } };
  const timer = setInterval(() => { left -= 1; if (left <= 0) close(); }, 1000);
  onDestroy(() => clearInterval(timer));

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') close();
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div id="welcome" class="welcome" role="dialog" aria-labelledby="welcome-title">
  <h2 id="welcome-title">QSO Graph Desktop {version}</h2>
  <h3>What's new</h3>
  <ul id="welcome-new">
    {#each WHATS_NEW as line (line)}<li>{line}</li>{/each}
  </ul>
  <p id="welcome-report">Something wrong? Help → Troubleshooting saves the logs; report it on GitHub at qso-graph/qso-graph-desktop.</p>
  <p id="welcome-thanks">With thanks to {CONTRIBUTORS.map(person => person.name.replace(/ \(.*\)$/, '')).join(', ')}. Free software under the GNU GPL, version 3.</p>
  <footer>
    <label class="hide"><input type="checkbox" id="welcome-hide" bind:checked={hide} /> Don't show this again</label>
    <span class="left" aria-live="off">Closes in {left} s</span>
    <button type="button" id="close-welcome" onclick={close}>Close</button>
  </footer>
</div>

<style>
  .welcome {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: min(560px, calc(100% - 32px));
    max-height: calc(100% - 120px);
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 22px 26px;
    border: 1px solid var(--border-strong);
    border-radius: 12px;
    background: var(--surface);
    box-shadow: 0 16px 50px rgb(0 0 0 / 0.35);
    z-index: 30;
  }
  h2, h3, p, ul { margin: 0; }
  h3 { font-size: 14px; }
  ul { padding-left: 18px; display: flex; flex-direction: column; gap: 4px; }
  footer { display: flex; align-items: center; gap: 14px; margin-top: 6px; }
  .hide { display: flex; align-items: center; gap: 6px; font-size: 13px; }
  .left { margin-left: auto; color: var(--ink-muted); font-size: 12px; }
</style>
