<!-- SPDX-License-Identifier: GPL-3.0-only -->
<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import Rail from './Rail.svelte';
  import { PAGES } from '../renderer/shell-store.js';

  const { Story } = defineMeta({
    title: 'ui/Rail',
    component: Rail,
    args: { pages: PAGES, current: 'personas', onNavigate: () => {} }
  });
</script>

<Story name="Personas current" />
<Story name="Settings current" args={{ current: 'settings' }} />
<!-- A page whose icon is not in the set still shows its label and still
     navigates; the rail does not go blank over a missing picture. -->
<Story
  name="Icon missing"
  args={{
    pages: [
      { id: 'personas', label: 'Personas', icon: 'nothing-here', description: 'No icon for this one', placement: 'top' },
      { id: 'settings', label: 'Settings', icon: 'settings', description: 'Appearance, and the logs this Mac keeps', placement: 'bottom' }
    ]
  }}
/>
