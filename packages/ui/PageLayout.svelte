<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!--
  A page inside the shell: the eyebrow, the title, an optional action beside
  it, and the page's content underneath.

  Every page in the shell is this shape, so a later application gets the same
  spacing and the same heading level by using it rather than by matching it.
  One h1 per page, which is also what keeps P3-axe quiet.

  How a page uses the width is one setting here (KI7MT, 2026-10-22):
  "reading", the default, keeps cards to a readable width for forms and
  settings; "full" lets them fill the window, for Home now and for a log, a
  band map or a spot list later.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    title: string;
    eyebrow?: string;
    action?: Snippet;
    width?: 'reading' | 'full';
    // Shown, or read by a screen reader only, where the rail already says
    // which page this is (Home: KI7MT, 2026-10-22). One h1 either way.
    titleShown?: boolean;
    children: Snippet;
  }
  const { title, eyebrow, action, width = 'reading', titleShown = true, children }: Props = $props();
</script>

<div class="page-main" class:page-full={width === 'full'}>
  {#if titleShown}
    <div class="page-title">
      <div>
        {#if eyebrow}<p class="eyebrow">{eyebrow}</p>{/if}
        <h1>{title}</h1>
      </div>
      {#if action}{@render action()}{/if}
    </div>
  {:else}
    <h1 class="visually-hidden">{title}</h1>
  {/if}
  {@render children()}
</div>
