<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!--
  A list in each of the four states it can actually be in: loading, failed,
  empty, and holding something.

  The pattern is that all four are the component's business. A list that only
  renders its items leaves the other three to whoever uses it, and they get
  written differently every time — an empty list that looks like a loading one
  is the usual result.

  aria-busy while loading, and the failure is announced; a screen reader is
  told the list changed state rather than finding it silently different.
-->
<script lang="ts" generics="T">
  import type { Snippet } from 'svelte';

  type State = 'loading' | 'error' | 'ready';

  interface Props {
    label: string;
    state: State;
    items: readonly T[];
    item: Snippet<[T, number]>;
    empty?: string;
    error?: string;
    retry?: Snippet;
  }
  const {
    label, state, items, item,
    empty = 'Nothing here yet.',
    error = 'This could not be loaded.',
    retry
  }: Props = $props();

  // Empty is not a fourth input: it is what ready-with-nothing means. Two
  // sources for one state is how a list ends up loading and empty at once.
  const showing = $derived<'loading' | 'error' | 'empty' | 'items'>(
    state === 'loading' ? 'loading' : state === 'error' ? 'error' : items.length ? 'items' : 'empty'
  );
</script>

<div class="state-list" aria-busy={showing === 'loading' ? 'true' : undefined}>
  {#if showing === 'loading'}
    <p class="state-message" role="status">Loading…</p>
  {:else if showing === 'error'}
    <p class="state-message state-error" role="status">{error}</p>
    {#if retry}{@render retry()}{/if}
  {:else if showing === 'empty'}
    <p class="state-message" role="status">{empty}</p>
  {:else}
    <ul aria-label={label}>
      {#each items as entry, index (index)}
        <li>{@render item(entry, index)}</li>
      {/each}
    </ul>
  {/if}
</div>
