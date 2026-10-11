<!-- SPDX-License-Identifier: GPL-3.0-only -->
<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import SettingsPage from './SettingsPage.svelte';

  // Settings holds the operator's preferences: appearance and which
  // extensions are on. It took eleven args until 2026-10-10, which is a fair
  // measure of how much of the core had been put in front of the operator
  // (QGD-APP-0012.1, QGD-FRM-0012, QGD-LOG-0013).
  const { Story } = defineMeta({
    title: 'pages/SettingsPage',
    component: SettingsPage,
    args: {
      themeChoice: 'system',
      onChooseTheme: () => Promise.resolve(true),
      extensions: [{ id: 'on-the-air', name: 'On the Air', cards: ['Conditions', 'Your station'], enabled: true }],
      onSetExtension: () => Promise.resolve(true)
    }
  });
</script>

<Story name="Default" />
<Story name="Dark chosen" args={{ themeChoice: 'dark' }} />
<Story name="Extension off" args={{ extensions: [{ id: 'on-the-air', name: 'On the Air', cards: ['Conditions', 'Your station'], enabled: false }] }} />
<Story name="Reading extensions" args={{ extensions: undefined }} />
