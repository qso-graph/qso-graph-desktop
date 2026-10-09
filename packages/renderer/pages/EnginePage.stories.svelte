<!-- SPDX-License-Identifier: GPL-3.0-only -->
<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import EnginePage from './EnginePage.svelte';

  const settled = { onStart: () => Promise.resolve(), onStop: () => Promise.resolve() };

  const { Story } = defineMeta({
    title: 'pages/EnginePage',
    component: EnginePage,
    args: { status: { state: 'running', version: '17.11' }, ...settled }
  });
</script>

<Story name="Running" />
<Story name="Starting" args={{ status: { state: 'starting' } }} />
<Story name="Stopped" args={{ status: { state: 'stopped', version: '17.11' } }} />
<!-- The state that matters most: the shell is fine and says so plainly. -->
<Story name="Could not start" args={{ status: { state: 'failed', version: '17.11', reason: 'The database could not be created.' } }} />
<Story name="Not bundled yet" args={{ status: { state: 'unavailable', reason: 'The engine service is not running.' } }} />
<Story name="Still asking" args={{ status: undefined }} />
