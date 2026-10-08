<!-- SPDX-License-Identifier: GPL-3.0-only -->
<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import PersonaPage from './PersonaPage.svelte';

  // app.ts drives this screen in the application, so the story shows the
  // markup as it is first drawn — which is also the state P1's "Create a
  // persona" path starts from.
  const { Story } = defineMeta({ title: 'pages/PersonaPage', component: PersonaPage });
</script>

<Story name="Before any persona exists" />
