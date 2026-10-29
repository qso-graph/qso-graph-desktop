<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!--
  An extension's page in the main pane, opened from its pin on Home or its
  item in the rail (KI7MT, 2026-10-22). The core draws it from the data the
  extension answers with; no extension code or markup runs in the window.
  Back to Home is the rail's Home.

  An area whose extension has settings of its own carries a Settings tab,
  last, drawn by the core (KI7MT, 2026-10-24): what governs that extension
  alone is there, and Settings is the application's.

  A page that asks for fields (a DX grid, a search) has them drawn here, by
  the core. What is typed is checked by its kind as it is typed, and again by
  the broker before the extension is asked with it (inputs.ts).
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import PageLayout from '../../ui/PageLayout.svelte';
  import PageBody from '../../ui/PageBody.svelte';
  import { inputValue } from '../../extension-api/inputs.js';
  import type { HomeModel } from '../home-store.js';

  interface Props {
    page: HomeModel['page'];
    // The extension it comes from, as the eyebrow.
    extensionName: string;
    // Ask the page again with what is in its fields.
    onAsk?: (values: Record<string, string>) => void;
    // Ask the page again now (Refresh).
    onRefresh?: () => void;
    // The page needs the internet and the computer has none.
    offline?: boolean;
    // Open another page of the same area, from its tab.
    onTab?: (key: string) => void;
    // A park's or summit's page in the browser, from a linked column (#59).
    onOpenReference?: (kind: 'pota' | 'sota', reference: string) => void;
    // The extension's own settings, as the area's last tab, and whether it
    // is the tab showing.
    settings?: Snippet;
    showingSettings?: boolean;
    onSettings?: () => void;
    // One of the page's own declared settings chosen (QGD-HOM-0017).
    onSetting?: (id: string, value: string) => void;
  }
  const { page, extensionName, onAsk = () => {}, onRefresh, offline = false, onTab = () => {}, onOpenReference,
    settings: ownSettings, showingSettings = false, onSettings = () => {}, onSetting = () => {} }: Props = $props();
  // The page's Settings tab: the core's own drawing of the settings its
  // manifest declares, or the shell's for an area that has core settings
  // of its own (Parks On the Air's My Area).
  const settings = $derived(ownSettings ?? (page && page.settings.length > 0 ? declaredSettings : undefined));
  // A page in views draws them as its tabs (pages.ts version 7): choosing one
  // asks the page again with it, as a field does.
  const views = $derived(page?.views ?? []);

  const onSettingsTab = $derived(settings !== undefined && showingSettings);

  // Why a field's value is refused, by its kind, said as it is typed.
  const REASON = { grid: 'A grid locator, as IO91 or IO91wm.', callsign: 'A callsign, as W1AW or W1AW/P.', text: 'Plain text, a little shorter.' } as const;
  // What a field is for, said under it before anything is typed (KI7MT,
  // 2026-10-23): the extension's own words where its manifest gives them,
  // otherwise what the kind wants. A value it refuses says why in the same
  // place.
  const HINT = { grid: 'A grid locator, as IO91 or IO91wm.', callsign: 'A callsign, as W1AW or W1AW/P.', text: '' } as const;
  // A text field's own line, where its manifest gives none: how long it may
  // be (QGD-HOM-0002; Codex review, 2026-10-23).
  const hintOf = (input: { kind: keyof typeof HINT; hint?: string; max?: number }) =>
    input.hint ?? (input.kind === 'text' ? `Up to ${input.max ?? 64} characters.` : HINT[input.kind]);
  // What is being typed, per field, until it is asked with.
  let typed = $state<Record<string, string>>({});
  let lastKey = '';
  $effect(() => {
    // A different page starts from what it was last asked with.
    if (page && page.key !== lastKey) { lastKey = page.key; typed = { ...page.values }; }
  });
  const problems = $derived(Object.fromEntries((page?.inputs ?? []).map(input => {
    const value = typed[input.id] ?? '';
    return [input.id, value.trim() !== '' && inputValue(input, value) === undefined ? REASON[input.kind] : ''];
  })));
  const ready = $derived(Object.values(problems).every(problem => problem === ''));

  // Whether this page places its own fields: from its data when it has
  // some, and remembered while it is between answers.
  let placedBy = $state<Record<string, boolean>>({});
  $effect(() => {
    if (page?.shown.state === 'ready') {
      const places = page.shown.sections.some(section => section.shape === 'fields');
      if (placedBy[page.key] !== places) placedBy = { ...placedBy, [page.key]: places };
    }
  });
  const placed = $derived(page ? placedBy[page.key] ?? false : false);

  function ask(event: SubmitEvent): void {
    event.preventDefault();
    if (!page || !ready) return;
    const values: Record<string, string> = {};
    for (const input of page.inputs) {
      const value = inputValue(input, typed[input.id] ?? '');
      if (value !== undefined) values[input.id] = value;
    }
    onAsk(values);
  }
</script>

<!-- The page's fields, drawn by the core: at the top, or where the page's
     own data places them (a fields section), so an answer can sit just under
     its question (KI7MT, 2026-10-23: Astro's grey line, below its map). -->
{#snippet fieldsForm()}
  {#if page && page.inputs.length > 0}
    <form class="card page-inputs" id="page-inputs" onsubmit={ask}>
      <div class="fields">
        {#each page.inputs as input (input.id)}
          <label>
            {input.label}
            <input id="page-input-{input.id}" class="page-input-{input.kind}" bind:value={typed[input.id]} autocomplete="off"
              maxlength={input.kind === 'text' ? (input.max ?? 64) : 32}
              aria-invalid={problems[input.id] ? 'true' : undefined}
              aria-describedby={problems[input.id] ? `page-input-${input.id}-problem` : `page-input-${input.id}-hint`} />
            {#if problems[input.id]}<span class="field-error page-input-note" id="page-input-{input.id}-problem">{problems[input.id]}</span>
            {:else}<span class="page-input-hint page-input-note" id="page-input-{input.id}-hint">{hintOf(input)}</span>{/if}
          </label>
        {/each}
      </div>
      <button type="submit" id="page-ask" disabled={!ready}>Show</button>
    </form>
  {/if}
{/snippet}

{#snippet declaredSettings()}
  {#if page}
    {#each page.settings as setting (setting.id)}
      <label class="page-setting">
        {setting.label}
        <select id="page-setting-{setting.id}" value={setting.value} onchange={event => onSetting(setting.id, event.currentTarget.value)}>
          {#each setting.choices as choice (choice)}<option value={choice}>{choice}</option>{/each}
        </select>
        {#if setting.hint}<span class="hint">{setting.hint}</span>{/if}
      </label>
    {/each}
  {/if}
{/snippet}

{#if page}
  <PageLayout title={page.areaName} eyebrow={extensionName.toUpperCase()} width="full"
    hue={page.hue === 'callsigns' || page.hue === 'locations' || page.hue === 'settings' ? page.hue : 'general'}>
    <!-- An area's pages, as tabs (KI7MT, 2026-10-23): each its own page,
         asked for only while it is the one shown (QGD-HOM-0005). -->
    {#if page.tabs.length > 1 || views.length > 0 || settings}
      <nav class="page-tabs" aria-label="{page.areaName} pages">
        {#each views as tab (tab.id)}
          <button type="button" class="page-tab" id="page-view-{tab.id}" aria-current={!onSettingsTab && tab.id === page.view ? 'page' : undefined}
            onclick={() => { if (tab.id !== page.view || onSettingsTab) { if (onSettingsTab) onTab(page.key); onAsk({ view: tab.id }); } }}>{tab.label}</button>
        {/each}
        {#each page.tabs as tab (tab.key)}
          <button type="button" class="page-tab" id="page-tab-{tab.key.replace('/', '-')}" aria-current={!onSettingsTab && tab.key === page.key ? 'page' : undefined}
            onclick={() => { if (tab.key !== page.key || onSettingsTab) onTab(tab.key); }}>{tab.label}</button>
        {/each}
        {#if settings}
          <button type="button" class="page-tab" id="page-tab-settings" aria-current={onSettingsTab ? 'page' : undefined}
            onclick={onSettings}>Settings</button>
        {/if}
      </nav>
    {/if}
    {#if onSettingsTab && settings}
      <section class="card extension-settings" id="extension-settings">{@render settings()}</section>
    {:else}
    {#if !placed}{@render fieldsForm()}{/if}
    <!-- A page of its own each: what one page's filters were set to is not
         carried to another. -->
    {#key page.key}<PageBody shown={page.shown} onRefresh={offline ? undefined : onRefresh} {offline} fields={placed ? fieldsForm : undefined} rememberAs={page.key} {onOpenReference} />{/key}
    <!-- Placed by the page, and the page between answers: kept below what
         it says rather than jumping to the top and back. -->
    {#if placed && page.shown.state !== 'ready'}{@render fieldsForm()}{/if}
    {/if}
  </PageLayout>
{/if}
