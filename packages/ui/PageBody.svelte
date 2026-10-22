<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!--
  An extension's page, drawn by the core from data (KI7MT, 2026-10-22;
  QGD-HOM-0002): the page a pin or a rail item opens.

  Text only: every string here is an expression in the template, which Svelte
  escapes, and nothing is inserted as raw HTML. An extension decides what its
  page says, never what it looks like, so every page reads like the rest of
  the application, and no extension code runs in the window.
-->
<script lang="ts">
  import { tableGroups, utc, type PageShown } from './page-shapes.js';
  import WorldMap from './WorldMap.svelte';

  interface Props {
    shown: PageShown;
  }
  const { shown }: Props = $props();
</script>

<section class="card page-body" aria-busy={shown.state === 'waiting'}>
  {#if shown.state === 'ready'}<p class="page-time" id="page-observed">Updated {utc(shown.observedAt)}</p>{/if}
  {#if shown.state === 'waiting'}
    <p class="hint">Getting the latest…</p>
  {:else if shown.state === 'failed'}
    <p class="page-failed" role="status">{shown.reason}</p>
  {:else}
    {#each shown.sections as section, at (at)}
      {#if section.heading}<h2 class="page-section-heading">{section.heading}</h2>{/if}
      {#if section.shape === 'alert'}
        <p class="page-alert {section.level}" role={section.level === 'info' ? 'status' : 'alert'}>{section.text}</p>
      {:else if section.shape === 'figures'}
        <dl class="page-figures">
          {#each section.figures as figure, i (i)}
            <div>
              <dt>{figure.label}</dt>
              <dd>{figure.value}{#if figure.unit}<span class="unit"> {figure.unit}</span>{/if}</dd>
              {#if figure.observedAt}<dd class="figure-time">{utc(figure.observedAt)}</dd>{/if}
            </div>
          {/each}
        </dl>
      {:else if section.shape === 'table'}
        <table class="page-table">
          <thead><tr>{#each section.columns as column, c (c)}<th scope="col">{column}</th>{/each}</tr></thead>
          <!-- One table, its groups as row groups, so every group's columns line
               up with every other's. A two-cell row in a wider table gives
               its one value across the columns after the first (version 5). -->
          {#each tableGroups(section) as group, g (g)}
            <tbody>
              {#if group.heading}<tr class="page-table-group"><th scope="rowgroup" colspan={section.columns.length}>{group.heading}</th></tr>{/if}
              {#each group.rows as row, r (r)}
                <tr>{#each row as cell, c (c)}{#if c === 0}<th scope="row">{cell}</th>{:else}<td colspan={row.length < section.columns.length ? section.columns.length - 1 : undefined}>{cell}</td>{/if}{/each}</tr>
              {/each}
            </tbody>
          {/each}
        </table>
      {:else if section.shape === 'map'}
        <WorldMap sun={section.sun} marks={section.marks} />
      {:else}
        <ul class="page-items">
          {#each section.items as item, i (i)}
            <li><span class="item-title">{item.title}</span>{#if item.detail}<span class="item-detail">{item.detail}</span>{/if}</li>
          {/each}
        </ul>
      {/if}
    {/each}
  {/if}
</section>
