<!-- SPDX-License-Identifier: GPL-3.0-only -->
<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import UpdateStrip from './UpdateStrip.svelte';

  const { Story } = defineMeta({
    title: 'ui/UpdateStrip',
    component: UpdateStrip,
    args: { version: '0.2.0', onSee: () => {}, onClose: () => {} }
  });
</script>

<!-- After an update to 0.2.0. -->
<Story name="Updated" />
