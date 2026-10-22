<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!--
  What the application opens on: two things, laid out as a GitHub profile is
  (KI7MT, 2026-10-22).

  - At the top, ours: a welcome that says what QSO Graph Desktop is. Reserved
    and empty until its words are decided, so QGD-FRM-0011 holds as written.
  - Below it, the operator's: the pages they pinned, as tiles of one shape and
    size, in the order they set by dragging them or in "Customize your pins".
    A tile opens its page; Home itself fetches nothing.

  The version and what the application sends are in Settings' About, the
  active callsign and location are on the status bar on every page, reference
  data is in Settings, and the rail is the way to each place. No credential
  is read to draw it (QGD-CRD-0009), and it waits on nothing (QGD-FRM-0011).
-->
<script lang="ts">
  import PageLayout from '../../ui/PageLayout.svelte';
  import PinTile from '../../ui/PinTile.svelte';
  import PinPicker from '../../ui/PinPicker.svelte';
  import { noticeText } from '../host-notice.js';
  import type { HomeModel } from '../home-store.js';
  import { MAX_PINS } from '../../main/settings-contract.js';

  interface Props {
    // The tiles, drawn from the manifests, and the pins to change
    // (QGD-HOM-0003).
    home: HomeModel;
    onSavePins: (pins: string[]) => void;
    // Open a pinned page in the main pane.
    onOpenPage?: (key: string) => void;
    // Hide the extension host's notice for the stop it is about.
    onDismissNotice?: (id: number) => void;
  }
  const { home, onSavePins, onOpenPage = () => {}, onDismissNotice = () => {} }: Props = $props();

  let picking = $state(false);
  // Pins kept for an extension that is off hold their places, so the picker
  // offers only the room left beside them (QGD-HOM-0007).
  const room = $derived(MAX_PINS - home.pins.filter(pin => !home.available.some(card => card.key === pin)).length);

  // Said after a move, for a screen reader; the tiles say it by moving.
  let moved = $state('');
  // The tile being dragged, by key.
  let dragging = $state<string | null>(null);

  // The tiles' order with one moved to `to`, saved as the new pin order. The
  // pins of an extension that is off keep their places (keepHidden, main).
  function place(key: string, to: number): void {
    const order = home.tiles.map(tile => tile.key);
    const from = order.indexOf(key);
    if (from < 0 || to < 0 || to >= order.length || from === to) return;
    order.splice(from, 1);
    order.splice(to, 0, key);
    onSavePins(order);
    const name = home.tiles.find(tile => tile.key === key)?.name ?? '';
    moved = `${name} moved to place ${to + 1} of ${order.length}.`;
  }
</script>

<PageLayout title="Home" width="full" titleShown={false}>
  <!-- Ours: the welcome, reserved for words to be decided (KI7MT,
       2026-10-22). Nothing is drawn in it yet. -->
  <div class="home-welcome" id="home-welcome"></div>

  <div class="home-pinned-head">
    <h2 id="home-pinned-title">Pinned</h2>
    <button type="button" class="link-button" id="customize-pins" onclick={() => { picking = true; }}>Customize your pins</button>
  </div>
  {#if home.error}<p class="hint" role="status">{home.error}</p>{/if}
  <!-- QGD-APP-0022: a stopped extension host names what it affected, and
       says so until dismissed, as VS Code does. -->
  {#if home.notice}
    <div class="home-notice" id="host-notice" role="alert">
      <p>{noticeText(home.notice)}</p>
      <button type="button" class="secondary" onclick={() => onDismissNotice(home.notice!.id)}>Dismiss</button>
    </div>
  {/if}
  {#if home.tiles.length === 0}
    <p class="hint" id="nothing-pinned">Nothing is pinned. Customize your pins to choose what Home shows.</p>
  {:else}
    <ol class="home-pins" id="home-pins" aria-labelledby="home-pinned-title">
      {#each home.tiles as tile, at (tile.key)}
        <li
          draggable="true"
          class:dragging={dragging === tile.key}
          data-pin={tile.key}
          ondragstart={event => { dragging = tile.key; event.dataTransfer?.setData('text/plain', tile.key); }}
          ondragend={() => { dragging = null; }}
          ondragover={event => { if (dragging) event.preventDefault(); }}
          ondrop={event => { event.preventDefault(); if (dragging) place(dragging, at); dragging = null; }}
        >
          <PinTile name={tile.name} description={tile.description} icon={tile.icon}
            onOpen={() => onOpenPage(tile.key)} onMove={by => place(tile.key, at + by)} />
        </li>
      {/each}
    </ol>
  {/if}
  <p class="visually-hidden" id="pin-move-hint">Alt and an arrow key moves a pin.</p>
  <p class="visually-hidden" role="status" aria-live="polite">{moved}</p>
  <PinPicker
    open={picking}
    available={home.available}
    pins={home.pins}
    max={room}
    onSave={pins => { picking = false; onSavePins(pins); }}
    onCancel={() => { picking = false; }}
  />
</PageLayout>
