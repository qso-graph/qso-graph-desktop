<!-- SPDX-License-Identifier: GPL-3.0-only -->
<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import StatusBar from './StatusBar.svelte';

  const { Story } = defineMeta({
    title: 'ui/StatusBar',
    component: StatusBar,
    args: { activeCallsign: '' }
  });
</script>

<Story name="No active callsign" />
<Story name="Active callsign" args={{ activeCallsign: 'W1AW' }} />
