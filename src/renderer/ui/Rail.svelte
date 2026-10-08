<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!--
  The navigation rail. Buttons, not links: QGD-PRC-0006 allows exactly one
  bundled page, so a page here is a section of it and the browser's history is
  never involved. P3-navigation asserts that.
-->
<script lang="ts">
  interface Props {
    pages: readonly { readonly id: string; readonly label: string }[];
    current: string;
    onNavigate: (id: string) => void;
  }
  const { pages, current, onNavigate }: Props = $props();
</script>

<nav class="rail" aria-label="Sections">
  {#each pages as page (page.id)}
    <button
      type="button"
      class="rail-item"
      class:current={page.id === current}
      aria-current={page.id === current ? 'page' : undefined}
      onclick={() => onNavigate(page.id)}
    >{page.label}</button>
  {/each}
</nav>
