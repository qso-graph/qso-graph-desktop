<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!-- QGD-FRM-0010 pattern: page-layout -->
<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import PageLayout from './PageLayout.svelte';

  const { Story } = defineMeta({
    title: 'patterns/PageLayout',
    component: PageLayout,
    args: { title: 'Settings', eyebrow: 'PREFERENCES' }
  });
</script>

{#snippet body()}
  <section class="card"><h2>A section</h2><p class="hint">Pages are made of cards like this one.</p></section>
  <section class="card"><h2>Another</h2><p class="hint">The spacing between them comes from the layout, not from the page.</p></section>
{/snippet}

{#snippet action()}
  <button type="button" class="secondary">An action</button>
{/snippet}

<Story name="Page" args={{ children: body }} />
<Story name="With an action beside the title" args={{ children: body, action }} />
<Story name="No eyebrow" args={{ children: body, eyebrow: undefined }} />
