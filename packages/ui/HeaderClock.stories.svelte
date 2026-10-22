<!-- SPDX-License-Identifier: GPL-3.0-only -->
<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import HeaderClock from './HeaderClock.svelte';

  // A fixed time, so the gallery draws the same clock every time.
  const { Story } = defineMeta({
    title: 'ui/HeaderClock',
    component: HeaderClock,
    args: { now: new Date('2026-10-22T04:12:33Z') }
  });
</script>

<Story name="Fixed time" />
