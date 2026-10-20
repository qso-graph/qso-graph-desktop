<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!--
  What the application opens on.

  Deliberately the page that asks nothing of anything: no credential is read
  to draw it (QGD-CRD-0009), and it is readable whatever storage is doing. What it
  says is what this is, what it is doing, and where to go next.
-->
<script lang="ts">
  import PageLayout from '../../ui/PageLayout.svelte';
  import { ICONS } from '../../ui/icons.js';
  import HomeCard from '../../ui/HomeCard.svelte';
  import PinPicker from '../../ui/PinPicker.svelte';
  import { noticeText } from '../host-notice.js';
  import type { StorageStatus } from '../../storage/storage-contract.js';
  import type { HomeModel } from '../home-store.js';
  import { MAX_PINS } from '../../main/settings-contract.js';


  interface Destination {
    readonly id: string;
    readonly label: string;
    readonly description: string;
    readonly icon: string;
  }

  interface Props {
    version: string;
    activePersona: string;
    storage: StorageStatus | undefined;
    destinations: readonly Destination[];
    onGo: (id: string) => void;
    // The pinned cards, drawn by the core from what extensions answer
    // (QGD-HOM-0002), and the pins to change (QGD-HOM-0003).
    home: HomeModel;
    onSavePins: (pins: string[]) => void;
    // Hide the extension host's notice for the stop it is about.
    onDismissNotice?: (id: number) => void;
  }
  const { version, activePersona, storage, destinations, onGo, home, onSavePins, onDismissNotice = () => {} }: Props = $props();

  let picking = $state(false);
  // Pins kept for an extension that is off hold their places, so the picker
  // offers only the room left beside them (QGD-HOM-0007).
  const room = $derived(MAX_PINS - home.pins.filter(pin => !home.available.some(card => card.key === pin)).length);

  // What reference data is loaded (QGD-FRM-0011), read from the status
  // storage pushes, one resource at a time. Nothing is fetched at start, and
  // each resource is loaded or updated in Settings by its own control
  // (KI7MT, 2026-10-11). A resource never loaded is a choice, not a fault
  // (QGD-REF-0014).
  const referenceWords = $derived.by(() => {
    if (storage?.state === 'failed' || storage?.state === 'unavailable') return 'not available';
    const resources = storage?.reference?.resources;
    if (!resources) return 'being checked';
    if (resources.length === 0) return 'none offered';
    return resources.map(resource => `${resource.name}: ${resource.updating ? 'updating'
      : resource.state === 'not loaded' ? 'not downloaded' : resource.due ? 'out of date' : 'downloaded'}`).join('; ');
  });
</script>

<PageLayout title="QSO Graph Desktop" eyebrow="HOME">
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
  {#if home.cards.length > 0}
    <div class="home-cards" id="home-cards" aria-labelledby="home-cards-title">
      {#each home.cards as card (card.key)}
        <HomeCard name={card.name} shown={card.shown} />
      {/each}
    </div>
  {/if}
  <PinPicker
    open={picking}
    available={home.available}
    pins={home.pins}
    max={room}
    onSave={pins => { picking = false; onSavePins(pins); }}
    onCancel={() => { picking = false; }}
  />
  <section class="card" aria-labelledby="home-state-title">
    <h2 id="home-state-title">Right now</h2>
    <dl class="facts">
      <dt>Version</dt>
      <dd>{version}</dd>
      <dt>Active persona</dt>
      <dd>{activePersona || 'None yet'}</dd>
      <dt>Reference data</dt>
      <dd id="home-reference">
        {referenceWords}
        <button type="button" class="secondary inline-action" id="manage-reference" onclick={() => onGo('settings')}>Download or update</button>
        {#if storage?.reason}<span class="fact-note">{storage.reason}</span>{/if}
      </dd>
    </dl>
    <!--
      Said precisely, because the product now reaches out on its own: it
      fetches ADIF's definitions and POTA's park list rather than shipping
      them (QGD-REF-0001, QGD-REF-0009). "Nothing is sent anywhere until you
      ask for it" stopped being true of the application the day that landed,
      and a promise that is nearly true is the kind a user finds out about.
    -->
    <p class="hint">
      Everything you enter stays on this computer. Nothing of yours is sent anywhere
      until you ask. The app fetches the ADIF and park reference lists when you download
      or update them, and the data your pinned cards show, and nothing else.
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
