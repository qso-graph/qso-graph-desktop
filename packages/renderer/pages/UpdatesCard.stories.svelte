<!-- SPDX-License-Identifier: GPL-3.0-only -->
<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import UpdatesCard from './UpdatesCard.svelte';

  const { Story } = defineMeta({
    title: 'pages/UpdatesCard',
    component: UpdatesCard,
    args: {
      check: true, track: 'stable',
      update: { kind: 'current', checkedAt: Date.UTC(2026, 9, 23, 14, 5) },
      onSetCheck: () => Promise.resolve(true), onSetTrack: () => Promise.resolve(true)
    }
  });
</script>

<!-- Up to date; ready to install on restart; a build that cannot install it
     itself; and the switch off. -->
<Story name="Up to date" />
<Story name="Ready" args={{ update: { kind: 'ready', version: '0.1.1' } }} />
<Story name="Available" args={{ update: { kind: 'available', version: '0.1.1', checkedAt: Date.UTC(2026, 9, 23, 14, 5) } }} />
<Story name="Off" args={{ check: false, update: { kind: 'off', why: 'switch' } }} />
<Story name="Development build" args={{ update: { kind: 'off', why: 'development' } }} />
