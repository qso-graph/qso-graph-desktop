<!-- SPDX-License-Identifier: GPL-3.0-only -->
<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import Rail from './Rail.svelte';
  import { PAGES } from '../shell-store.js';

  const { Story } = defineMeta({
    title: 'ui/Rail',
    component: Rail,
    args: { pages: PAGES, current: 'personas', onNavigate: () => {} }
  });
</script>

<Story name="Personas current" />
<Story name="Settings current" args={{ current: 'settings' }} />
