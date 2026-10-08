<!-- SPDX-License-Identifier: GPL-3.0-only -->
<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import Shell from './Shell.svelte';
  import { createShellStore } from './shell-store.js';

  const { Story } = defineMeta({
    title: 'Shell',
    component: Shell,
    args: { store: createShellStore(), onChooseTheme: () => {} }
  });
</script>

<Story name="Personas" />
<Story
  name="Settings"
  args={{
    store: createShellStore({
      page: 'settings',
      activePersona: 'Active: W1AW · Home station',
      themeChoice: 'system'
    })
  }}
/>
