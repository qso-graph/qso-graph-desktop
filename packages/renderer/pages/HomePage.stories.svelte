<!-- SPDX-License-Identifier: GPL-3.0-only -->
<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import HomePage from './HomePage.svelte';
  import type { HomeModel } from '../home-store.js';

  // Pages as their manifests describe them; Home draws tiles from these alone.
  const available = [
    { key: 'on-the-air/conditions', name: 'Conditions', description: "Solar flux, the K and A indices, NOAA's storm scales and the band outlook.", extensionName: 'On the Air', icon: 'sun', rail: false, inputs: [], network: false },
    { key: 'astro/astro', name: 'Astro', description: 'The sun, the moon and the grey line at your location.', extensionName: 'Astro', icon: 'moon', rail: true, inputs: [], network: false },
    { key: 'on-the-air/parks', name: 'Parks and summits', description: 'POTA and SOTA activators on the air now.', extensionName: 'On the Air', icon: 'tower-broadcast', rail: false, inputs: [], network: false },
    { key: 'club/nets', name: 'Nets', description: "This week's nets, and who checked in last time.", extensionName: 'Club', icon: 'calendar', rail: false, inputs: [], network: false },
    { key: 'logbook/recent', name: 'Recent QSOs', description: 'The last contacts in your log, with their QSL state.', extensionName: 'Logbook', icon: 'list', rail: false, inputs: [], network: false }
  ];
  const tiles = (keys: string[]) => keys.flatMap(key => {
    const page = available.find(entry => entry.key === key);
    return page ? [{ key, name: page.name, description: page.description, icon: page.icon }] : [];
  });
  const pins = available.map(page => page.key);
  const pinned: HomeModel = { available, pins, tiles: tiles(pins), railPages: available.filter(page => page.rail), page: null, notice: null, online: true };
  const nothingPinned: HomeModel = { ...pinned, pins: [], tiles: [] };

  const { Story } = defineMeta({
    title: 'pages/HomePage',
    component: HomePage,
    args: {
      home: pinned,
      onSavePins: () => {}
    }
  });
</script>

<Story name="Pinned pages" />
<!-- Home with nothing pinned: the way to pin, and nothing else. -->
<Story name="Nothing pinned" args={{ home: nothingPinned }} />
<Story name="The extension host stopped" args={{ home: { ...pinned, notice: { id: 1, kind: 'restarted', at: '2026-10-19T18:04:00Z', affected: ['On the Air'] } } }} />
