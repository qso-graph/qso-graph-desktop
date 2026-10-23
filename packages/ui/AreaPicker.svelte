<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!--
  A tick-box tree: nodes with children, a search over them, and a choice held
  to a most (tree-pick.ts). My Area is its first user: POTA's programs, their
  entities and their locations, any of which may be ticked, as POTA's own park
  list narrows by Program, Entity and Location (KI7MT, 2026-10-23). It owns no
  state but what is being searched; the choice is the caller's, told by
  onChange.
-->
<script lang="ts">
  import { holdsChoice, toggled, visibleNodes, type PickNode } from './tree-pick.js';

  interface Props {
    nodes: readonly PickNode[];
    chosen: readonly string[];
    most: number;
    onChange: (chosen: readonly string[]) => void;
    // What the search is for, as its label says.
    searchLabel?: string;
  }
  const { nodes, chosen, most, onChange, searchLabel = 'Search' }: Props = $props();

  let query = $state('');
  const shown = $derived(visibleNodes(nodes, query));
  const full = $derived(chosen.length >= most);
  // A node is open while a search is shown, or while it holds a choice, so
  // what is chosen is always in view.
  const opens = (node: PickNode) => query.trim() !== '' || (node.children ?? []).some(child => holdsChoice(child, chosen));
</script>

{#snippet tick(node: PickNode)}
  <label class="area-item">
    <input type="checkbox" checked={chosen.includes(node.id)} data-area={node.id}
      disabled={full && !chosen.includes(node.id)}
      onchange={() => onChange(toggled(chosen, node.id, most))} />
    {node.label} <span class="hint">{node.id}</span>
  </label>
{/snippet}

{#snippet branch(list: readonly PickNode[])}
  <ul class="area-items">
    {#each list as node (node.id)}
      <li>
        {#if node.children && node.children.length > 0}
          <details open={opens(node)}>
            <summary>{@render tick(node)}</summary>
            {@render branch(node.children)}
          </details>
        {:else}
          {@render tick(node)}
        {/if}
      </li>
    {/each}
  </ul>
{/snippet}

<div class="area-picker">
  <label class="area-search">{searchLabel}
    <input type="search" id="area-search" bind:value={query} autocomplete="off" />
  </label>
  <p class="hint" id="area-count" role="status">{chosen.length} of {most} chosen.{#if full} Untick one to choose another.{/if}</p>
  {#if shown.length === 0}
    <p class="hint">Nothing matches.</p>
  {:else}
    <div class="area-groups">{@render branch(shown)}</div>
  {/if}
</div>
