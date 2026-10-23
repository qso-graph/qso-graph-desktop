<!-- SPDX-License-Identifier: GPL-3.0-only -->
<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import AreaPicker from './AreaPicker.svelte';

  const groups = [
    { id: 'JP', label: 'Japan', items: [{ id: 'JP-TK', label: 'Tokyo' }, { id: 'JP-CH', label: 'Chiba' }] },
    { id: 'US', label: 'United States of America', items: [
      { id: 'US-ID', label: 'Idaho' }, { id: 'US-MT', label: 'Montana' }, { id: 'US-OR', label: 'Oregon' }, { id: 'US-WA', label: 'Washington' }
    ] }
  ];
  const { Story } = defineMeta({
    title: 'components/AreaPicker',
    component: AreaPicker,
    args: { groups, chosen: ['US-ID'], most: 10, onChange: () => {}, searchLabel: 'Find a location' }
  });
</script>

<!-- A home location chosen; a choice at its most, where the rest are disabled. -->
<Story name="Home chosen" />
<Story name="At its most" args={{ chosen: ['US-ID', 'US-MT'], most: 2 }} />
