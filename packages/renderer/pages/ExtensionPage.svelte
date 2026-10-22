<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!--
  An extension's page in the main pane, opened from its pin on Home or its
  item in the rail (KI7MT, 2026-10-22). The core draws it from the data the
  extension answers with; no extension code or markup runs in the window.
  Back to Home is the rail's Home.

  A page that asks for fields (a DX grid, a search) has them drawn here, by
  the core. What is typed is checked by its kind as it is typed, and again by
  the broker before the extension is asked with it (inputs.ts).
-->
<script lang="ts">
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
  }
  const { page, extensionName, onAsk = () => {} }: Props = $props();

  // Why a field's value is refused, by its kind, said as it is typed.
  const REASON = { grid: 'A grid locator, as FN31 or FN31pr.', callsign: 'A callsign, as W1AW or W1AW/P.', text: 'Plain text, a little shorter.' } as const;
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

{#if page}
  <PageLayout title={page.name} eyebrow={extensionName.toUpperCase()} width="full">
    {#if page.inputs.length > 0}
      <form class="card page-inputs" id="page-inputs" onsubmit={ask}>
        <div class="fields">
          {#each page.inputs as input (input.id)}
            <label>
              {input.label}
              <input id="page-input-{input.id}" bind:value={typed[input.id]} autocomplete="off"
                maxlength={input.kind === 'text' ? (input.max ?? 64) : 32}
                aria-invalid={problems[input.id] ? 'true' : undefined}
                aria-describedby={problems[input.id] ? `page-input-${input.id}-problem` : undefined} />
              {#if problems[input.id]}<span class="field-error" id="page-input-{input.id}-problem">{problems[input.id]}</span>{/if}
            </label>
          {/each}
        </div>
        <button type="submit" id="page-ask" disabled={!ready}>Show</button>
      </form>
    {/if}
    <PageBody shown={page.shown} />
  </PageLayout>
{/if}
