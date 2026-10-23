<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!--
  A tick-box tree: groups of items, a search over them, and a choice held to
  a most (tree-pick.ts). My Area is its first user: POTA's programs, then
  their locations (KI7MT, 2026-10-23). It owns no state but what is being
  searched; the choice is the caller's, told by onChange.
-->
<script lang="ts">
  import { toggled, visibleGroups, type PickGroup } from './tree-pick.js';

  interface Props {
    groups: readonly PickGroup[];
    chosen: readonly string[];
    most: number;
    onChange: (chosen: readonly string[]) => void;
    // What the search is for, as its label says.
    searchLabel?: string;
  }
  const { groups, chosen, most, onChange, searchLabel = 'Search' }: Props = $props();

  let query = $state('');
  const shown = $derived(visibleGroups(groups, query));
  const full = $derived(chosen.length >= most);
  // A group is open while a search is shown, or while it holds a choice, so
  // what is chosen is always in view.
  const opens = (group: PickGroup) => query.trim() !== '' || group.items.some(item => chosen.includes(item.id));
</script>

<div class="area-picker">
  <label class="area-search">{searchLabel}
    <input type="search" id="area-search" bind:value={query} autocomplete="off" />
  </label>
  <p class="hint" id="area-count" role="status">{chosen.length} of {most} chosen.{#if full} Untick one to choose another.{/if}</p>
  {#if shown.length === 0}
    <p class="hint">Nothing matches.</p>
  {:else}
    <ul class="area-groups">
      {#each shown as group (group.id)}
        <li>
          <details open={opens(group)}>
            <summary>{group.label} <span class="hint">({group.id})</span></summary>
            <ul class="area-items">
              {#each group.items as item (item.id)}
                <li>
                  <label class="area-item">
                    <input type="checkbox" checked={chosen.includes(item.id)} data-location={item.id}
                      disabled={full && !chosen.includes(item.id)}
                      onchange={() => onChange(toggled(chosen, item.id, most))} />
                    {item.label} <span class="hint">{item.id}</span>
                  </label>
                </li>
              {/each}
            </ul>
          </details>
        </li>
      {/each}
    </ul>
  {/if}
</div>
