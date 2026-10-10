<!-- SPDX-License-Identifier: GPL-3.0-only -->
<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import HomePage from './HomePage.svelte';

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
        refreshing: false
      }
      },
      destinations,
      onGo: () => {}
    }
  });
</script>

<Story name="Reference data loaded" />
<Story name="No persona yet" args={{ activePersona: 'None yet' }} />
<!-- A first run with no network: reference data not loaded, which is an
     answer and not a fault (QGD-REF-0014). -->
<Story name="Reference data not loaded" args={{ storage: { state: 'ready', reference: {
  adif: { state: 'not loaded' }, parks: { state: 'not loaded' }, programs: { state: 'not loaded' },
  locations: { state: 'not loaded' }, refreshing: false } } }} />
<!-- Readable with storage down, which is half of what this page is for. -->
<Story name="Storage could not open" args={{ storage: { state: 'failed', reason: 'Storage could not be opened.' } }} />
<Story name="Still checking" args={{ storage: undefined }} />
