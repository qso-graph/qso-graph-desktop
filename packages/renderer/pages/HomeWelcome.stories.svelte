<!-- SPDX-License-Identifier: GPL-3.0-only -->
<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import HomeWelcome from './HomeWelcome.svelte';

  const steps = [
    { id: 'callsign' as const, label: 'Add your callsign', done: true, optional: false },
    { id: 'location' as const, label: 'Add a location', done: false, optional: false },
    { id: 'extensions' as const, label: 'Choose what to add', done: false, optional: false },
    { id: 'adif' as const, label: 'Download ADIF definitions', done: false, optional: false },
    { id: 'parks' as const, label: 'Download POTA parks', done: false, optional: true },
    { id: 'summits' as const, label: 'Download SOTA summits', done: false, optional: true }
  ];
  const { Story } = defineMeta({
    title: 'pages/HomeWelcome',
    component: HomeWelcome,
    args: {
      platform: 'win32', steps, onGo: () => {}, onCustomize: () => {}, onWhatsNew: () => {},
      onDownloads: () => {}, onContributing: () => {}, onSite: () => {}
    }
  });
</script>

<!-- A new install part way through its steps; and once every step is done. -->
<Story name="Getting started" />
<Story name="Set up" args={{ steps: [] }} />
