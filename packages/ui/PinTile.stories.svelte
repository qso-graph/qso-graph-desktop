<!-- SPDX-License-Identifier: GPL-3.0-only -->
<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import PinTile from './PinTile.svelte';

  const { Story } = defineMeta({
    title: 'ui/PinTile',
    component: PinTile,
    args: { name: 'Parks On the Air', description: 'Parks near you, spots, and the most wanted.', icon: 'tree', onOpen: () => {} }
  });
</script>

<!-- A pin on Home; and in Customize your pins, where it can be moved. -->
<Story name="Pinned" />
<Story name="Being arranged" args={{ onMove: () => {} }} />
