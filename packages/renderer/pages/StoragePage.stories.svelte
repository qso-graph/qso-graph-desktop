<!-- SPDX-License-Identifier: GPL-3.0-only -->
<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { RESOURCES_LOADED, RESOURCES_NOT_LOADED } from './reference-fixtures.js';
  import StoragePage from './StoragePage.svelte';
  import type { StorageStatus } from '../../storage/storage-contract.js';

  const loaded: StorageStatus = {
    state: 'ready',
    folder: '/Users/you/Library/Application Support/QSO Graph Desktop',
    sizes: { state: 98_304, reference: 17_539_072 },
    reference: {
      adif: { state: 'loaded', version: '3.1.7', rows: 3345, fetchedAt: '2026-10-10T12:00:00.000Z' },
      parks: { state: 'loaded', rows: 96532, fetchedAt: '2026-10-10T12:00:00.000Z' },
      programs: { state: 'loaded', rows: 249, fetchedAt: '2026-10-10T12:00:00.000Z' },
      locations: { state: 'loaded', rows: 4006, fetchedAt: '2026-10-10T12:00:00.000Z' },
      summits: { state: 'loaded', rows: 182280, fetchedAt: '2026-10-10T12:00:00.000Z' },
      refreshing: false,
      resources: RESOURCES_LOADED
    }
  };
  const notLoaded = { state: 'not loaded' } as const;

  const { Story } = defineMeta({
    title: 'pages/StoragePage',
    component: StoragePage,
    args: { status: loaded }
  });
</script>

<Story name="Loaded" />
<!-- A first run with no network: nothing to fetch from, and that is an answer
     (QGD-REF-0014). -->
<Story name="Not loaded" args={{ status: { ...loaded, sizes: { state: 98_304, reference: null },
  reference: { adif: notLoaded, parks: notLoaded, programs: notLoaded, locations: notLoaded, summits: notLoaded, refreshing: false, resources: RESOURCES_NOT_LOADED } } }} />
<Story name="Updating" args={{ status: { ...loaded, reference: { ...loaded.reference!, refreshing: true } } }} />
<Story name="Could not open" args={{ status: { state: 'failed', reason: 'Storage could not be opened.' } }} />
<Story name="Opening" args={{ status: undefined }} />
