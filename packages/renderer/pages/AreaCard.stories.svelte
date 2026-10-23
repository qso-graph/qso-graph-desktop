<!-- SPDX-License-Identifier: GPL-3.0-only -->
<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import AreaCard from './AreaCard.svelte';

  const choices = [
    { prefix: 'US', name: 'United States of America', locations: [{ code: 'US-ID', name: 'Idaho' }, { code: 'US-MT', name: 'Montana' }] }
  ];
  const { Story } = defineMeta({
    title: 'pages/AreaCard',
    component: AreaCard,
    args: {
      area: [], most: 10, parksLoaded: true,
      loadChoices: () => Promise.resolve(choices), loadDefault: () => Promise.resolve('US-ID'), onSave: () => Promise.resolve(true)
    }
  });
</script>

<!-- Starting from the Location's own; and before POTA's lists are downloaded. -->
<Story name="From the Location" />
<Story name="POTA not downloaded" args={{ parksLoaded: false }} />
