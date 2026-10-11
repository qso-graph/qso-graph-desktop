<!-- SPDX-License-Identifier: GPL-3.0-only -->
<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import SettingsPage from './SettingsPage.svelte';

  // Two args, because Settings holds one thing. It took eleven until
  // 2026-10-10, which is a fair measure of how much of the core had been put
  // in front of the operator (QGD-APP-0012.1, QGD-FRM-0012, QGD-LOG-0013).
  const { Story } = defineMeta({
    title: 'pages/SettingsPage',
    component: SettingsPage,
    args: {
      themeChoice: 'system',
      onChooseTheme: () => Promise.resolve(true)
    }
  });
</script>

<Story name="Default" />
<Story name="Dark chosen" args={{ themeChoice: 'dark' }} />
