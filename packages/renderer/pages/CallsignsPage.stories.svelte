<!-- SPDX-License-Identifier: GPL-3.0-only -->
<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import CallsignsPage from './CallsignsPage.svelte';

  // app.ts drives this screen in the application, so the story shows the
  // markup as it is first drawn — which is also the state P1's "Create a
  // callsign" path starts from.
  const { Story } = defineMeta({ title: 'pages/CallsignsPage', component: CallsignsPage });
</script>

<Story name="Before any callsign exists" />
