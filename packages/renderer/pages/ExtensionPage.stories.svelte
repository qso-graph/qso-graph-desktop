<!-- SPDX-License-Identifier: GPL-3.0-only -->
<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import ExtensionPage from './ExtensionPage.svelte';

  // Conditions as it looks on a quiet day, waiting, failed, and offline.
  const base = {
    key: 'conditions/conditions', name: 'Conditions', network: true, inputs: [], values: {},
    area: 'conditions/conditions', areaName: 'Conditions', hue: 'var(--hue-general)', tabs: [], views: [], settings: []
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

  // A page in views (pages.ts version 7): the Monitor, with All and one tab
  // per copy of WSJT-X, and its own Settings tab last.
  const monitor = {
    key: 'monitor/monitor', name: 'Monitor', network: false, inputs: [], values: {},
    area: 'monitor/monitor', areaName: 'Monitor', hue: 'var(--hue-general)', tabs: [],
    views: [{ id: 'all', label: 'All' }, { id: 'source-0', label: 'WSJT-X - IC-7300' }, { id: 'source-1', label: 'WSJT-X - FTDX10' }],
    view: 'source-0',
    settings: [{ id: 'cycles', label: 'Cycles shown', choices: ['10', '20', '40'], value: '20', hint: 'Newest first. The Monitor keeps the last 40; this is how many the grid shows.' }],
    shown: {
      state: 'ready' as const, observedAt: '2026-10-29T18:42:46Z',
      sections: [
        { shape: 'figures' as const, heading: 'WSJT-X - IC-7300', figures: [
          { label: 'Dial', value: '14.074', unit: 'MHz' }, { label: 'Mode', value: 'FT8' }, { label: 'Now', value: 'Receiving' },
          { label: 'Last heard', value: '18:42:46', unit: 'UTC', observedAt: '2026-10-29T18:42:46.000Z' }
        ] },
        { shape: 'table' as const, heading: 'Decodes', contents: false as const, columns: ['UTC', 'dB', 'DT', 'Freq', 'Message', 'Note'], groups: [
          { heading: '18:42:45 UTC · 3 decodes', rows: [
            ['18:42:45', '-12', '0.2', '1234', 'CQ K7ABC DN13', '—'],
            ['18:42:45', '-21', '0.4', '912', 'JA1XYZ W1AW -15', '—'],
            ['18:42:45', '-24', '1.1', '2210', 'CQ \u2039PJ4/K1ABC\u203a', 'low confidence']
          ] },
          { heading: '18:42:30 UTC · 1 decode', rows: [['18:42:30', '3', '-0.1', '1500', 'W1AW K7ABC R-09', '—']] }
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
<Story name="In views" args={{ page: monitor, extensionName: 'Monitor' }} />
<Story name="Its own settings" args={{ page: monitor, extensionName: 'Monitor', showingSettings: true }} />
