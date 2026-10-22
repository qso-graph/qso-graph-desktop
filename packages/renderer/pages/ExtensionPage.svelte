<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!--
  An extension's page in the main pane, opened from its pin on Home or its
  item in the rail (KI7MT, 2026-10-22). The core draws it from the data the
  extension answers with; no extension code or markup runs in the window.
  Back to Home is the rail's Home.
-->
<script lang="ts">
  import PageLayout from '../../ui/PageLayout.svelte';
  import PageBody from '../../ui/PageBody.svelte';
  import type { HomeModel } from '../home-store.js';

  interface Props {
    page: HomeModel['page'];
    // The extension it comes from, as the eyebrow.
    extensionName: string;
  }
  const { page, extensionName }: Props = $props();
</script>

{#if page}
  <PageLayout title={page.name} eyebrow={extensionName.toUpperCase()} width="full">
    <PageBody shown={page.shown} />
  </PageLayout>
{/if}
