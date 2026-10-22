<!-- SPDX-License-Identifier: GPL-3.0-only -->
<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import HomePage from './HomePage.svelte';
  import type { HomeModel } from '../home-store.js';

  const observedAt = '2026-10-11T18:00:00Z';
  const available = [
    { key: 'on-the-air/conditions', name: 'Conditions', description: 'Solar flux, K and A, and the band outlook.', extensionName: 'On the Air' },
    { key: 'on-the-air/your-station', name: 'Your station', description: 'UTC, local time and who you are operating as.', extensionName: 'On the Air' }
  ];
  const pinned: HomeModel = {
    available, pins: available.map(card => card.key),
    cards: [
      { key: 'on-the-air/conditions', name: 'Conditions', shown: { state: 'ready', observedAt, sections: [
        { shape: 'figures', figures: [{ label: 'Solar flux', value: '148', unit: 'sfu' }, { label: 'K index', value: '2' }, { label: 'A index', value: '6' }] }
      ] } },
      { key: 'on-the-air/your-station', name: 'Your station', shown: { state: 'ready', observedAt, sections: [
        { shape: 'figures', figures: [{ label: 'UTC', value: '18:00' }, { label: 'Local', value: '12:00' }] },
        { shape: 'items', items: [{ title: 'Operating as', detail: 'W1AW' }] }
      ] } }
    ],
    notice: null
  };
  const nothingPinned: HomeModel = { available, pins: [], cards: [], notice: null };


  const { Story } = defineMeta({
    title: 'pages/HomePage',
    component: HomePage,
    args: {
      home: pinned,
      onSavePins: () => {}
    }
  });
</script>

<Story name="Pinned cards" />
<!-- Home with nothing pinned: the way to pin, and nothing else. -->
<Story name="Nothing pinned" args={{ home: nothingPinned }} />
<!-- One card failing alone, the other drawn (QGD-HOM-0006). -->
<Story name="One card failing" args={{ home: { ...pinned, cards: [
  { key: 'on-the-air/conditions', name: 'Conditions', shown: { state: 'failed', reason: 'The extension did not answer in time.' } },
  pinned.cards[1]
] } }} />
<Story name="The extension host stopped" args={{ home: { ...pinned, notice: { id: 1, kind: 'restarted', at: '2026-10-19T18:04:00Z', affected: ['On the Air'] } } }} />
