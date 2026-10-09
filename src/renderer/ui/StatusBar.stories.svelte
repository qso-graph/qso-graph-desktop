<!-- SPDX-License-Identifier: GPL-3.0-only -->
<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import StatusBar from './StatusBar.svelte';

  const { Story } = defineMeta({
    title: 'ui/StatusBar',
    component: StatusBar,
    args: { activePersona: '' }
  });
</script>

<Story name="No active persona" />
<Story name="Active persona" args={{ activePersona: 'W1AW · Home station' }} />
