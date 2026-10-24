<!-- SPDX-License-Identifier: GPL-3.0-only -->
<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import ExtensionPage from './ExtensionPage.svelte';

  // Conditions as it looks on a quiet day, waiting, failed, and offline.
  const base = {
    key: 'conditions/conditions', name: 'Conditions', network: true, inputs: [], values: {},
    area: 'conditions/conditions', areaName: 'Conditions', hue: 'var(--hue-general)', tabs: []
  };
  const ready = {
    ...base,
    shown: {
      state: 'ready' as const, observedAt: '2026-10-24T06:00:00Z',
      sections: [
        { shape: 'figures' as const, figures: [
          { label: 'Solar flux', value: '101', observedAt: '2026-10-23T20:00:00Z' },
          { label: 'K index', value: '0.67', observedAt: '2026-10-24T06:00:00Z' },
          { label: 'A index', value: '3', observedAt: '2026-10-24T06:00:00Z' },
          { label: 'NOAA scales', value: 'R0 S0 G0' }
        ] },
        { shape: 'text' as const, text: 'NOAA scales, 0 (none) to 5 (extreme): R radio blackouts, fading HF by day; S solar radiation storms, absorbing HF at the poles; G geomagnetic storms, disturbing HF and bringing aurora.' },
        { shape: 'table' as const, columns: ['Band', 'Status', 'Comment'], rows: [
          ['80m', 'Good', 'Quiet night conditions'], ['40m', 'Good', 'Open most of the day'], ['20m', 'Fair', 'Daylight paths'], ['10m', 'Poor', 'Flux too low']
        ] }
      ]
    }
  };

  const { Story } = defineMeta({
    title: 'pages/ExtensionPage',
    component: ExtensionPage,
    args: { page: ready, extensionName: 'Conditions', onAsk: () => {}, onRefresh: () => {} }
  });
</script>

<Story name="Ready" />
<Story name="Waiting" args={{ page: { ...base, shown: { state: 'waiting' } } }} />
<Story name="Failed" args={{ page: { ...base, shown: { state: 'failed', reason: 'NOAA did not answer. Try again later.' } } }} />
<Story name="Offline" args={{ page: { ...base, shown: { state: 'waiting' } }, offline: true }} />
