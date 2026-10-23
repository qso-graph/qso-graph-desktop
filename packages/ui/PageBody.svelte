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
  import type { Snippet } from 'svelte';
  import { filterOptions, filteredGroups, pageContents, sortedGroups, utc, type PageShown, type Section, type TableSort } from './page-shapes.js';
  import WorldMap from './WorldMap.svelte';

  interface Props {
    shown: PageShown;
    // Ask the page again now; absent, no Refresh is drawn.
    onRefresh?: (() => void) | undefined;
    // The page's fields, drawn where a fields section places them.
    fields?: Snippet | undefined;
  }
  const { shown, onRefresh, fields }: Props = $props();

  // A group's place in the table as sent, which its contents link names,
  // whatever the filters leave of the table.
  const tableGroupIndex = (section: Extract<Section, { shape: 'table' }>, group: { heading?: string }) =>
    'groups' in section ? section.groups.findIndex(candidate => candidate.heading === group.heading) : 0;

  // What each table's filters are set to, by section and column; '' is All.
  // Kept across a refresh, so a band chosen stays chosen as spots update.
  let chosen = $state<Record<number, Record<number, string>>>({});
  const choose = (section: number, column: number, value: string) => {
    chosen = { ...chosen, [section]: { ...(chosen[section] ?? {}), [column]: value } };
  };
  const anyChosen = (section: number) => Object.values(chosen[section] ?? {}).some(value => value !== '');
  // Every filter of a table back to All (KI7MT, 2026-10-23).
  const clearFilters = (section: number) => { chosen = { ...chosen, [section]: {} }; };

  // How each sortable table is sorted, by section: none until a heading is
  // clicked, then ascending, then each click turns it round. Kept across a
  // refresh, like the filters.
  let sorts = $state<Record<number, TableSort>>({});
  // The sort a table is in: the operator's, or else the order the extension
  // says it sent.
  const sortOf = (section: number, sent: TableSort | undefined) => sorts[section] ?? sent;
  function sortBy(section: number, column: number, sent: TableSort | undefined): void {
    const now = sortOf(section, sent);
    const direction = now?.column === column && now.direction === 'ascending' ? 'descending' : 'ascending';
    sorts = { ...sorts, [section]: { column, direction } };
  }

  // A contents link goes to its part of the page without changing the
  // window's address: scrolled to, and focused for a keyboard or a reader.
  function go(id: string): void {
    const target = document.getElementById(id);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    target.focus({ preventScroll: true });
  }

  // Refresh rests for a few seconds after a press: the core asks at most
  // once in ten (page-scheduler.ts), and a button that seems to do nothing
  // when pressed again invites pressing it again.
  let resting = $state(false);
  function refresh(): void {
    if (resting || !onRefresh) return;
    onRefresh();
    resting = true;
    setTimeout(() => { resting = false; }, 10_000);
  }
</script>

<section class="card page-body" aria-busy={shown.state === 'waiting'}>
  {#if shown.state === 'ready'}
    <p class="page-time" id="page-observed">Updated {utc(shown.observedAt)}
      {#if onRefresh}<button type="button" class="secondary" id="page-refresh" onclick={refresh} disabled={resting}>{resting ? 'Refreshed' : 'Refresh'}</button>{/if}
    </p>
  {/if}
  {#if shown.state === 'ready'}
    {@const contents = pageContents(shown.sections)}
    {#if contents.length > 0}
      <nav class="page-contents" aria-label="On this page">
        {#each contents as entry, i (entry.id)}{#if i > 0}<span class="page-contents-gap" aria-hidden="true">|</span>{/if}<button type="button" class="link-button" onclick={() => go(entry.id)}>{entry.label}</button>{/each}
      </nav>
    {/if}
  {/if}
  {#if shown.state === 'waiting'}
    <p class="hint">Getting the latest…</p>
  {:else if shown.state === 'failed'}
    <p class="page-failed" role="status">{shown.reason}</p>
  {:else}
    {#each shown.sections as section, at (at)}
      {#if section.heading}<h2 class="page-section-heading" id="page-part-{at}" tabindex="-1">{section.heading}</h2>{/if}
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
        {#if section.filters}
          <!-- Drawn by the core, applied here at once: no new question is
               asked when a choice changes (page data version 6). -->
          <div class="page-filters">
            {#each section.filters as filter (filter.column)}
              <label>{filter.label}
                <select class="page-filter" value={chosen[at]?.[filter.column] ?? ''}
                  onchange={event => choose(at, filter.column, event.currentTarget.value)}>
                  <option value="">All</option>
                  {#each filterOptions(section, filter) as option (option)}<option value={option}>{option}</option>{/each}
                </select>
              </label>
            {/each}
            {#if anyChosen(at)}<button type="button" class="link-button page-filters-clear" onclick={() => clearFilters(at)}>Clear filters</button>{/if}
          </div>
        {/if}
        {@const sort = sortOf(at, section.sortedBy)}
        {@const groups = sortedGroups(section, filteredGroups(section, chosen[at] ?? {}), sort)}
        {#if groups.length === 0}<p class="hint page-filter-empty">Nothing matches what is chosen.</p>{/if}
        <table class="page-table" hidden={groups.length === 0}>
          <thead><tr>{#each section.columns as column, c (c)}
            {#if section.sortable}
              <th scope="col" aria-sort={sort?.column === c ? sort.direction : undefined}>
                <button type="button" class="page-sort" onclick={() => sortBy(at, c, section.sortedBy)}>{column}<span class="page-sort-mark" aria-hidden="true">{sort?.column === c ? (sort.direction === 'ascending' ? ' ▲' : ' ▼') : ''}</span></button>
              </th>
            {:else}<th scope="col">{column}</th>{/if}
          {/each}</tr></thead>
          <!-- One table, its groups as row groups, so every group's columns line
               up with every other's. A two-cell row in a wider table gives
               its one value across the columns after the first (version 5). -->
          {#each groups as group, g (g)}
            <tbody>
              {#if group.heading}<tr class="page-table-group" id="page-part-{at}-{tableGroupIndex(section, group)}" tabindex="-1"><th scope="rowgroup" colspan={section.columns.length}>{group.heading}</th></tr>{/if}
              {#each group.rows as row, r (r)}
                <tr>{#each row as cell, c (c)}{#if c === 0}<th scope="row">{cell}</th>{:else}<td colspan={row.length < section.columns.length ? section.columns.length - 1 : undefined}>{cell}</td>{/if}{/each}</tr>
              {/each}
            </tbody>
          {/each}
        </table>
      {:else if section.shape === 'text'}
        <p class="page-text">{section.text}</p>
      {:else if section.shape === 'fields'}
        {@render fields?.()}
      {:else if section.shape === 'map'}
        <WorldMap sun={section.sun} moon={section.moon} twilight={section.twilight} marks={section.marks} />
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
