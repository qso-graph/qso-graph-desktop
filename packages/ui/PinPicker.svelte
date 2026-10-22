<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!--
  Customize your pins (QGD-HOM-0003), as a GitHub profile does it: every page
  any extension offers, with its name and a line saying what it is, up to eight
  pinned, in an order the operator sets.

  Ordered with Move up and Move down rather than by dragging alone: a button
  works from the keyboard and with a screen reader, which a drag does not.
  A native <dialog>, as ConfirmDialog is, for the focus trap and Escape.
  Nothing is saved until Save; Cancel and Escape leave the pins as they were.
-->
<script lang="ts">
  interface Card {
    readonly key: string;
    readonly name: string;
    readonly description: string;
  }

  interface Props {
    open: boolean;
    available: readonly Card[];
    pins: readonly string[];
    max?: number;
    onSave: (pins: string[]) => void;
    onCancel: () => void;
  }
  const { open, available, pins, max = 8, onSave, onCancel }: Props = $props();

  let dialog: HTMLDialogElement | undefined = $state();
  // A working copy, taken each time the dialog opens.
  let chosen = $state<string[]>([]);

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) {
      const offered = new Set(available.map(card => card.key));
      chosen = pins.filter(pin => offered.has(pin));
      dialog.showModal();
    } else if (!open && dialog.open) dialog.close();
  });

  // Pinned first, in pin order; then the rest, as offered.
  const rows = $derived([
    ...chosen.flatMap(key => available.filter(card => card.key === key)),
    ...available.filter(card => !chosen.includes(card.key))
  ]);
  const full = $derived(chosen.length >= max);

  function toggle(key: string): void {
    if (chosen.includes(key)) chosen = chosen.filter(pin => pin !== key);
    else if (!full) chosen = [...chosen, key];
  }

  function move(key: string, by: -1 | 1): void {
    const at = chosen.indexOf(key);
    const to = at + by;
    if (at < 0 || to < 0 || to >= chosen.length) return;
    const next = [...chosen];
    [next[at], next[to]] = [next[to], next[at]];
    chosen = next;
  }
</script>

<dialog bind:this={dialog} class="pins" aria-labelledby="pins-title" oncancel={onCancel}>
  <h2 id="pins-title">Customize your pins</h2>
  <p class="hint" id="pins-count">{chosen.length} of {max} pinned. {#if full}Unpin a page to pin another.{/if}</p>
  {#if available.length === 0}
    <p>No page is offered yet.</p>
  {:else}
    <ul class="pins-list" aria-describedby="pins-count">
      {#each rows as card (card.key)}
        {@const pinned = chosen.includes(card.key)}
        {@const at = chosen.indexOf(card.key)}
        <li>
          <label>
            <input type="checkbox" checked={pinned} disabled={!pinned && full} onchange={() => toggle(card.key)} />
            <span><span class="pin-name">{card.name}</span><span class="pin-description">{card.description}</span></span>
          </label>
          {#if pinned}
            <span class="pins-order">
              <button type="button" class="secondary" aria-label="Move {card.name} up" disabled={at === 0} onclick={() => move(card.key, -1)}>↑</button>
              <button type="button" class="secondary" aria-label="Move {card.name} down" disabled={at === chosen.length - 1} onclick={() => move(card.key, 1)}>↓</button>
            </span>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
  <div class="form-footer">
    <button type="button" class="secondary" onclick={onCancel}>Cancel</button>
    <button type="button" onclick={() => onSave([...chosen])}>Save pins</button>
  </div>
</dialog>
