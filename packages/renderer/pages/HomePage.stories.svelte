<!-- SPDX-License-Identifier: GPL-3.0-only -->
<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import HomePage from './HomePage.svelte';
  import type { HomeModel } from '../home-store.js';

  const observedAt = '2026-10-11T18:00:00Z';
  const available = [
    { key: 'on-the-air/conditions', name: 'Conditions', description: 'Solar flux, K and A, and the band outlook.', extensionName: 'On the Air' },
    { key: 'on-the-air/parks', name: 'Parks and summits', description: 'POTA and SOTA activators now.', extensionName: 'On the Air' }
  ];
  const pinned: HomeModel = {
    available, pins: available.map(card => card.key),
    cards: [
      { key: 'on-the-air/conditions', name: 'Conditions', shown: { state: 'ready', observedAt, sections: [
        { shape: 'figures', figures: [{ label: 'Solar flux', value: '148', unit: 'sfu' }, { label: 'K index', value: '2' }, { label: 'A index', value: '6' }] }
      ] } },
      { key: 'on-the-air/parks', name: 'Parks and summits', shown: { state: 'ready', observedAt, sections: [
        { shape: 'items', items: [{ title: 'US-0001', detail: 'W1AW · 14.074 FT8' }, { title: 'W7I/SI-001', detail: 'W1AW · 7.032 CW' }] }
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
