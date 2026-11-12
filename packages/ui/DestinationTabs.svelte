<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!-- The shell owns the open destinations and their order; this bar only asks
     it to show, close or move one. An area's own tabs belong inside its page. -->
<script lang="ts">
  import { focusShownTab } from './tab-focus.js';
  import { ICONS } from './icons.js';

  interface Destination {
    readonly id: string;
    readonly label: string;
    readonly icon?: string;
  }
  interface Props {
    tabs: readonly Destination[];
    current: string;
    onShow: (id: string) => void;
    onClose: (id: string) => void | Promise<unknown>;
    onCloseOthers: (id: string) => void | Promise<unknown>;
    onCloseAll: () => void | Promise<unknown>;
    onReorder: (id: string, beforeId: string) => void;
  }
  const { tabs, current, onShow, onClose, onCloseOthers, onCloseAll, onReorder }: Props = $props();
  const selected = $derived(tabs.find(tab => tab.id === current));
  const focusId = $derived(selected?.id ?? tabs[0]?.id);
  let list: HTMLDivElement | undefined = $state();
  let actions: HTMLDetailsElement | undefined = $state();
  let dragged: string | undefined;

  async function focusShown() {
    await focusShownTab(list);
  }

  function onKeydown(event: KeyboardEvent, id: string) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const index = tabs.findIndex(tab => tab.id === id);
    let next: number;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index + tabs.length - 1) % tabs.length;
    else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    const tab = tabs[next];
    if (!tab) return;
    event.preventDefault();
    onShow(tab.id);
    void focusShown();
  }

  async function close(action: () => void | Promise<unknown>) {
    if (actions) actions.open = false;
    await action();
    await focusShown();
  }

  function onDragstart(event: DragEvent, id: string) {
    dragged = id;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', id);
    }
  }

  function onDrop(event: DragEvent, id: string) {
    event.preventDefault();
    if (dragged && dragged !== id) onReorder(dragged, id);
    dragged = undefined;
  }
</script>

<div class="destination-bar" role="region" aria-label="Open destinations">
  <div class="destination-tabs" role="tablist" aria-label="Open tabs" bind:this={list}>
    {#each tabs as tab (tab.id)}
      {@const glyph = tab.icon ? ICONS[tab.icon] ?? ICONS.extension : undefined}
      <div class="destination-item" role="presentation" data-selected={tab.id === current}>
        <button type="button" class="destination-tab" role="tab"
          aria-selected={tab.id === current} tabindex={tab.id === focusId ? 0 : -1}
          onclick={() => onShow(tab.id)} onkeydown={event => onKeydown(event, tab.id)}
          draggable="true" ondragstart={event => onDragstart(event, tab.id)}
          ondragover={event => { if (dragged) event.preventDefault(); }}
          ondrop={event => onDrop(event, tab.id)} ondragend={() => { dragged = undefined; }}>
          {#if glyph}<svg viewBox={glyph.viewBox} aria-hidden="true" fill="currentColor"><path d={glyph.path} /></svg>{/if}
          <span>{tab.label}</span>
        </button>
        <!-- The pointer's way to close. A tab list holds only tabs, so this is
          hidden from assistive technology; the keyboard closes with Ctrl+W (⌘W)
          or the Tabs menu (QGD-FRM-0028). -->
        <button type="button" class="destination-close" tabindex="-1" aria-hidden="true"
          title="Close {tab.label}" onclick={() => close(() => onClose(tab.id))}>×</button>
      </div>
    {/each}
  </div>
  <details class="destination-actions" bind:this={actions}>
    <summary title="Tab actions">Tab actions</summary>
    <div class="destination-menu">
      <button type="button" disabled={!selected} onclick={() => close(() => onClose(current))}>Close tab</button>
      <button type="button" disabled={!selected || tabs.length < 2} onclick={() => close(() => onCloseOthers(current))}>Close others</button>
      <button type="button" disabled={tabs.length === 0} onclick={() => close(onCloseAll)}>Close all</button>
    </div>
  </details>
</div>

<style>
  .destination-bar { display: flex; align-items: stretch; min-width: 0; flex-shrink: 0; background: var(--surface-sunken); border-bottom: 1px solid var(--border); }
  .destination-tabs { display: flex; min-width: 0; flex: 1; overflow-x: auto; }
  .destination-item { display: flex; flex-shrink: 0; border-right: 1px solid var(--border); border-top: 2px solid var(--border); color: var(--ink-muted); }
  .destination-item[data-selected="true"] { background: var(--surface); border-top-color: var(--accent); color: var(--ink); }
  .destination-tab, .destination-close { background: none; color: inherit; border: 0; border-radius: 0; }
  .destination-tab { display: flex; gap: 8px; align-items: center; padding: 9px 12px; white-space: nowrap; font-weight: 500; }
  .destination-tab svg { width: 14px; height: 14px; }
  .destination-close { padding: 4px 9px; font-size: 19px; }
  .destination-tab:focus-visible, .destination-close:focus-visible, summary:focus-visible { outline: 2px solid var(--focus); outline-offset: -3px; }
  .destination-actions { position: relative; flex-shrink: 0; }
  summary { cursor: pointer; padding: 11px 12px; color: var(--ink-muted); font-size: 12px; }
  .destination-menu { position: absolute; right: 0; top: 100%; z-index: 5; min-width: 150px; display: flex; flex-direction: column; padding: 4px; background: var(--surface); border: 1px solid var(--border-strong); }
  .destination-menu button { text-align: left; white-space: nowrap; border: 0; background: var(--surface); color: var(--ink); font-weight: 500; }
  .destination-menu button:hover:not(:disabled) { background: var(--accent-surface); }
</style>
