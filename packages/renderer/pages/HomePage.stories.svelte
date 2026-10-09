<!-- SPDX-License-Identifier: GPL-3.0-only -->
<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import HomePage from './HomePage.svelte';

  const destinations = [
    { id: 'personas', label: 'Personas', description: 'Station identities and the logins saved for each', icon: 'personas' },
    { id: 'settings', label: 'Settings', description: 'Appearance, the database, and the logs this Mac keeps', icon: 'settings' }
  ];

  const { Story } = defineMeta({
    title: 'pages/HomePage',
    component: HomePage,
    args: {
      version: '0.0.0-preview.1',
      activePersona: 'W1AW · Home station',
      engine: { state: 'running', version: '17.11' },
      destinations,
      onGo: () => {}
    }
  });
</script>

<Story name="Running" />
<Story name="No persona yet" args={{ activePersona: 'None yet' }} />
<Story name="Database starting" args={{ engine: { state: 'starting' } }} />
<!-- Readable with the engine down, which is half of what this page is for. -->
<Story name="Database could not start" args={{ engine: { state: 'failed', reason: 'The database could not be created.' } }} />
<Story name="Still asking" args={{ engine: undefined }} />
