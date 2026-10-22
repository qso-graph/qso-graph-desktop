<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!--
  A pinned page on Home, as GitHub draws a pinned repository (KI7MT,
  2026-10-22): the icon, the name on one line and the description on two,
  the same size whatever extension it comes from. Drawn from the manifest
  alone, so nothing on Home is fetched. Clicking it opens the page.

  It can be dragged to a new place, and moved with Alt and the arrow keys;
  "Customize your pins" orders them as well, with buttons.
-->
<script lang="ts">
  import { ICONS } from './icons.js';

  interface Props {
    name: string;
    description: string;
    icon: string;
    onOpen: () => void;
    // Move this tile by one place, -1 earlier or +1 later.
    onMove?: (by: -1 | 1) => void;
  }
  const { name, description, icon, onOpen, onMove }: Props = $props();
  const glyph = $derived(ICONS[icon] ?? ICONS.extension);

  function onKeydown(event: KeyboardEvent) {
    if (!onMove || !event.altKey) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') { event.preventDefault(); onMove(-1); }
    else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') { event.preventDefault(); onMove(1); }
  }
</script>

<button type="button" class="pin-tile" onclick={onOpen} onkeydown={onKeydown}
  aria-describedby={onMove ? 'pin-move-hint' : undefined}>
  <span class="pin-tile-head">
    {#if glyph}
      <svg class="pin-tile-icon" viewBox={glyph.viewBox} aria-hidden="true" fill="currentColor"><path d={glyph.path} /></svg>
    {/if}
    <span class="pin-tile-name">{name}</span>
  </span>
  <span class="pin-tile-description">{description}</span>
</button>
