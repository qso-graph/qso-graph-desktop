<!-- SPDX-License-Identifier: GPL-3.0-only -->
<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import PinPicker from './PinPicker.svelte';

  const available = [
    { key: 'on-the-air/conditions', name: 'Conditions', description: 'Solar flux, K and A, and the band outlook.' },
    { key: 'on-the-air/your-station', name: 'Your station', description: 'UTC, local time and who you are operating as.' },
    { key: 'on-the-air/dx', name: 'DX on the air', description: 'Recent DX spots on the open bands.' },
    { key: 'on-the-air/parks', name: 'Parks and summits', description: 'POTA and SOTA activators now.' },
    { key: 'on-the-air/nets', name: 'Nets on the air', description: 'Nets running now and next.' },
    { key: 'on-the-air/week', name: 'This week', description: 'Meteor showers and good EME windows.' },
    { key: 'on-the-air/wspr', name: 'What is open', description: 'Live propagation from WSPR.' }
  ];
  const { Story } = defineMeta({
    title: 'components/PinPicker',
    component: PinPicker,
    args: { open: true, available, pins: ['on-the-air/conditions', 'on-the-air/your-station'], onSave: () => {}, onCancel: () => {} }
  });
</script>

<!-- The day-one pins; all six pinned, where the rest are offered and
     disabled; and nothing offered at all (QGD-HOM-0003). -->
<Story name="Day one" />
<Story name="Six pinned" args={{ pins: available.slice(0, 6).map(card => card.key) }} />
<Story name="Nothing offered" args={{ available: [], pins: [] }} />
