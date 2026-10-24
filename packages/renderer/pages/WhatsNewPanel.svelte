<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!--
  What's new (QGD-FRM-0016), opened only when asked for: from the strip Home
  shows after an update, Help → What's New, or Home's welcome. It replaced the
  welcome window that opened by itself at every start (KI7MT, 2026-10-24: "the
  pop-up gets in the way"). The notes are CHANGELOG.md's, drawn as text: a
  note can be bold or code, and never markup.
-->
<script lang="ts">
  import type { Run, WhatsNewNotes } from '../../main/whats-new-contract.js';
  interface Props {
    // Undefined while the notes are being read.
    notes?: WhatsNewNotes;
    onClose: () => void;
  }
  const { notes, onClose }: Props = $props();
  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') onClose();
  }
  const title = (version: string, date: string) => (version === 'Unreleased' ? 'Since the last release' : date ? `${version} · ${date}` : version);
</script>

<svelte:window onkeydown={onKeydown} />
{#snippet text(runs: Run[])}{#each runs as run, i (i)}{#if run.bold}<strong>{run.text}</strong>{:else if run.code}<code>{run.text}</code>{:else}{run.text}{/if}{/each}{/snippet}
<div id="whats-new" class="whats-new" role="dialog" aria-labelledby="whats-new-title">
  <h2 id="whats-new-title">What's new in QSO Graph Desktop {notes?.version ?? ''}</h2>
  {#if notes === undefined}
    <p class="hint">Reading the notes…</p>
  {:else if notes.sections.length === 0}
    <p class="hint">No notes for this version.</p>
  {:else}
    {#each notes.sections as section (section.version)}
      <section aria-label={title(section.version, section.date)}>
        {#if notes.sections.length > 1 || section.version === 'Unreleased'}<h3>{title(section.version, section.date)}</h3>{/if}
        {#each section.blocks as block, i (i)}
          {#if block.kind === 'heading'}<h4>{@render text(block.runs)}</h4>
          {:else if block.kind === 'item'}<p class="item">{@render text(block.runs)}</p>
          {:else}<p>{@render text(block.runs)}</p>{/if}
        {/each}
      </section>
    {/each}
  {/if}
  <p class="hint" id="whats-new-report">Something wrong? Help → Troubleshooting saves the logs; report it on GitHub at qso-graph/qso-graph-desktop. With thanks to everyone who builds it: see Help → Contributors.</p>
  <footer>
    <button type="button" id="close-whats-new" onclick={onClose}>Close</button>
  </footer>
</div>

<style>
  .whats-new {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: min(640px, calc(100% - 32px));
    max-height: calc(100% - 120px);
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 22px 26px;
    border: 1px solid var(--border-strong);
    border-radius: 12px;
    background: var(--surface);
    box-shadow: 0 16px 50px rgb(0 0 0 / 0.35);
    z-index: 30;
  }
  h2, h3, h4, p { margin: 0; }
  h3 { font-size: 15px; margin-top: 6px; }
  h4 { font-size: 13px; margin-top: 4px; }
  section { display: flex; flex-direction: column; gap: 6px; }
  .item { padding-left: 16px; position: relative; line-height: 1.45; }
  .item::before { content: '•'; position: absolute; left: 4px; }
  footer { display: flex; justify-content: flex-end; margin-top: 6px; }
</style>
