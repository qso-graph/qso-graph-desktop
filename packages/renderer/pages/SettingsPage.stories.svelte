<!-- SPDX-License-Identifier: GPL-3.0-only -->
<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import SettingsPage from './SettingsPage.svelte';
  import { RESOURCES_ADIF_AVAILABLE, RESOURCES_LOADED, RESOURCES_NOT_LOADED } from './reference-fixtures.js';

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
      extensions: [{ id: 'on-the-air', name: 'On the Air', pages: ['Conditions'], enabled: true }],
      onSetExtension: () => Promise.resolve(true)
    }
  });
</script>

<Story name="Default" />
<Story name="Dark chosen" args={{ themeChoice: 'dark' }} />
<Story name="Extension off" args={{ extensions: [{ id: 'on-the-air', name: 'On the Air', pages: ['Conditions'], enabled: false }] }} />
<Story name="Reading extensions" args={{ extensions: undefined }} />
<Story name="Reference data not loaded" args={{ storage: { state: 'ready', reference: { adif: { state: 'not loaded' }, parks: { state: 'not loaded' }, programs: { state: 'not loaded' }, locations: { state: 'not loaded' }, summits: { state: 'not loaded' }, refreshing: false, resources: RESOURCES_NOT_LOADED } } }} />
<Story name="Reference data loaded" args={{ storage: { state: 'ready', reference: { adif: { state: 'loaded' }, parks: { state: 'loaded' }, programs: { state: 'loaded' }, locations: { state: 'loaded' }, summits: { state: 'loaded' }, refreshing: false, resources: RESOURCES_LOADED } } }} />
<Story name="A newer ADIF version is available" args={{ storage: { state: 'ready', reference: { adif: { state: 'loaded' }, parks: { state: 'loaded' }, programs: { state: 'loaded' }, locations: { state: 'loaded' }, summits: { state: 'loaded' }, refreshing: false, resources: RESOURCES_ADIF_AVAILABLE } } }} />
