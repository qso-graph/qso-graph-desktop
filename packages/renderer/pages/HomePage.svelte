<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!--
  What the application opens on.

  The operator's pinned cards, and nothing else (KI7MT, 2026-10-22): the
  version and what the application sends are in Settings' About, the active
  callsign and station are on the status bar on every page, reference data is
  in Settings, and the rail is the way to each place. No credential is read
  to draw it (QGD-CRD-0009), and it waits on nothing (QGD-FRM-0011).
-->
<script lang="ts">
  import PageLayout from '../../ui/PageLayout.svelte';
  import HomeCard from '../../ui/HomeCard.svelte';
  import PinPicker from '../../ui/PinPicker.svelte';
  import { noticeText } from '../host-notice.js';
  import type { HomeModel } from '../home-store.js';
  import { MAX_PINS } from '../../main/settings-contract.js';



  interface Props {
    // The pinned cards, drawn by the core from what extensions answer
    // (QGD-HOM-0002), and the pins to change (QGD-HOM-0003).
    home: HomeModel;
    onSavePins: (pins: string[]) => void;
    // Hide the extension host's notice for the stop it is about.
    onDismissNotice?: (id: number) => void;
  }
  const { home, onSavePins, onDismissNotice = () => {} }: Props = $props();

  let picking = $state(false);
  // Pins kept for an extension that is off hold their places, so the picker
  // offers only the room left beside them (QGD-HOM-0007).
  const room = $derived(MAX_PINS - home.pins.filter(pin => !home.available.some(card => card.key === pin)).length);
</script>

<PageLayout title="Home" width="full" titleShown={false}>
  <div class="home-cards-head">
    <h2 class="visually-hidden" id="home-cards-title">Pinned cards</h2>
    <!-- At the start of the line, under the title, rather than alone at the
         right edge (KI7MT, 2026-10-20). -->
    <button type="button" class="secondary" id="customize-pins" onclick={() => { picking = true; }}>Customize your pins</button>
    {#if home.error}<p class="hint" role="status">{home.error}</p>{/if}
  </div>
  <!-- QGD-APP-0022: a stopped extension host names what it affected, and
       says so until dismissed, as VS Code does. -->
  {#if home.notice}
    <div class="home-notice" id="host-notice" role="alert">
      <p>{noticeText(home.notice)}</p>
      <button type="button" class="secondary" onclick={() => onDismissNotice(home.notice!.id)}>Dismiss</button>
    </div>
  {/if}
  <!-- The pinned cards, in the order the operator set them, as a grid of at
       most three to a row (KI7MT, 2026-10-22; style.css .home-flow). -->
  <div class="home-flow">
  {#if home.cards.length === 0}
    <p class="hint" id="nothing-pinned">Nothing is pinned. Customize your pins to choose what Home shows.</p>
  {/if}
  {#if home.cards.length > 0}
    <div class="home-cards" id="home-cards" aria-labelledby="home-cards-title">
      {#each home.cards as card (card.key)}
        <HomeCard name={card.name} shown={card.shown} />
      {/each}
    </div>
  {/if}
  </div>
  <PinPicker
    open={picking}
    available={home.available}
    pins={home.pins}
    max={room}
    onSave={pins => { picking = false; onSavePins(pins); }}
    onCancel={() => { picking = false; }}
  />
</PageLayout>
