<!-- SPDX-License-Identifier: GPL-3.0-only -->
<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { RESOURCES_LOADED, RESOURCES_NOT_LOADED } from './reference-fixtures.js';
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

  const destinations = [
    { id: 'personas', label: 'Personas', description: 'Station identities and the logins saved for each', icon: 'personas' },
    { id: 'settings', label: 'Settings', description: 'How the application looks', icon: 'settings' }
  ];

  const { Story } = defineMeta({
    title: 'pages/HomePage',
    component: HomePage,
    args: {
      version: '0.0.0-preview.1',
      activePersona: 'W1AW · Home station',
      storage: {
      state: 'ready', folder: '/Users/you/Library/Application Support/QSO Graph Desktop',
      sizes: { state: 98_304, reference: 17_539_072 },
      reference: {
        adif: { state: 'loaded', version: '3.1.7', rows: 3345, fetchedAt: '2026-10-10T12:00:00.000Z' },
        parks: { state: 'loaded', rows: 96532, fetchedAt: '2026-10-10T12:00:00.000Z' },
        programs: { state: 'loaded', rows: 249, fetchedAt: '2026-10-10T12:00:00.000Z' },
        locations: { state: 'loaded', rows: 4006, fetchedAt: '2026-10-10T12:00:00.000Z' },
        refreshing: false,
        resources: RESOURCES_LOADED
      }
      },
      destinations,
      onGo: () => {},
      home: pinned,
      onSavePins: () => {}
    }
  });
</script>

<Story name="Reference data loaded" />
<Story name="No persona yet" args={{ activePersona: 'None yet' }} />
<!-- A first run with no network: reference data not loaded, which is an
     answer and not a fault (QGD-REF-0014). -->
<Story name="Reference data not loaded" args={{ storage: { state: 'ready', reference: {
  adif: { state: 'not loaded' }, parks: { state: 'not loaded' }, programs: { state: 'not loaded' },
  locations: { state: 'not loaded' }, refreshing: false, resources: RESOURCES_NOT_LOADED } } }} />
<!-- Readable with storage down, which is half of what this page is for. -->
<Story name="Storage could not open" args={{ storage: { state: 'failed', reason: 'Storage could not be opened.' } }} />
<Story name="Still checking" args={{ storage: undefined }} />
<!-- Home with nothing pinned: only the core's own cards, and the way to pin. -->
<Story name="Nothing pinned" args={{ home: nothingPinned }} />
<!-- One card failing alone, the other drawn (QGD-HOM-0006). -->
<Story name="One card failing" args={{ home: { ...pinned, cards: [
  { key: 'on-the-air/conditions', name: 'Conditions', shown: { state: 'failed', reason: 'The extension did not answer in time.' } },
  pinned.cards[1]
] } }} />
<Story name="The extension host stopped" args={{ home: { ...pinned, notice: { id: 1, kind: 'restarted', at: '2026-10-19T18:04:00Z', affected: ['On the Air'] } } }} />
