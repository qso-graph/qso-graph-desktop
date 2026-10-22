<!-- SPDX-License-Identifier: GPL-3.0-only -->
<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import HomeCard from './HomeCard.svelte';

  const observedAt = '2026-10-11T18:00:00Z';
  const { Story } = defineMeta({
    title: 'components/HomeCard',
    component: HomeCard,
    args: {
      name: 'Conditions',
      shown: {
        state: 'ready', observedAt,
        sections: [
          { shape: 'figures', figures: [
            { label: 'Solar flux', value: '148', unit: 'sfu' }, { label: 'K index', value: '2' }, { label: 'A index', value: '6' }
          ] },
          { shape: 'items', items: [
            { title: '80–40 m', detail: 'Good at night' }, { title: '20 m', detail: 'Good by day' }, { title: '15–10 m', detail: 'Fair' }
          ] }
        ]
      }
    }
  });
</script>

<!-- Every state a card can be in: drawn, with an alert of each level,
     waiting for its first answer, and failed in words (QGD-HOM-0002,
     QGD-HOM-0006). -->
<Story name="Figures and items" />
<Story name="Warning alert" args={{ shown: { state: 'ready', observedAt, sections: [
  { shape: 'alert', level: 'warning', text: 'G1 geomagnetic storm watch for the next 24 hours.' },
  { shape: 'figures', figures: [{ label: 'K index', value: '5' }] }
] } }} />
<Story name="Severe alert" args={{ shown: { state: 'ready', observedAt, sections: [
  { shape: 'alert', level: 'severe', text: 'R3 radio blackout: HF on the sunlit side is out.' }
] } }} />
<Story name="Table" args={{ name: 'Conditions', shown: { state: 'ready', observedAt, sections: [
  { shape: 'table', columns: ['Band', 'Status', 'Comment'], rows: [
    ['80m', 'Good', 'Reliable night band'], ['20m', 'Excellent', 'Strong F-layer, long openings'], ['6m', 'Sporadic', 'Watch for Es openings']
  ] }
] } }} />
<Story name="Waiting" args={{ shown: { state: 'waiting' } }} />
<Story name="Failed" args={{ shown: { state: 'failed', reason: 'The extension did not answer in time.' } }} />
