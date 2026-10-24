<!-- SPDX-License-Identifier: GPL-3.0-only -->
<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import WorldMap from './WorldMap.svelte';

  // The sun over the Pacific in late October, the moon to the east, a Location
  // in Idaho and a DX grid in England.
  const { Story } = defineMeta({
    title: 'ui/WorldMap',
    component: WorldMap,
    args: {
      sun: { latitude: -12, longitude: -150 },
      moon: { latitude: 8, longitude: 40 },
      twilight: 10.1,
      marks: [{ label: 'Home', latitude: 43.6, longitude: -116.2 }, { label: 'IO91', latitude: 51.5, longitude: -1 }]
    }
  });
</script>

<!-- Astro's grey line with a DX grid; and the sun alone. -->
<Story name="Grey line with DX" />
<Story name="Sun only" args={{ moon: undefined, twilight: undefined, marks: [] }} />
