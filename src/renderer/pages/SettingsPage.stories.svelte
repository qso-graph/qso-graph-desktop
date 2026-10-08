<!-- SPDX-License-Identifier: GPL-3.0-only -->
<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import SettingsPage from './SettingsPage.svelte';

  const { Story } = defineMeta({
    title: 'pages/SettingsPage',
    component: SettingsPage,
    args: { themeChoice: 'system', onChooseTheme: () => Promise.resolve(true) }
  });
</script>

<Story name="Default" />
<Story name="Dark chosen" args={{ themeChoice: 'dark' }} />
