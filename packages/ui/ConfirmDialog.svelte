<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  A confirmation before something that cannot be undone.

  A native <dialog> opened with showModal, which is what gives the focus trap,
  the Escape key and the inert background for nothing — written by hand these
  are the three things that get missed. The destructive action is named, not
  called "OK": a button that says "Remove callsign" tells the reader what is
  about to happen when the sentence above it has already been skipped.

  Cancel is the default focus, so Enter on a dialog nobody read does nothing.
-->
<script lang="ts">
  interface Props {
    open: boolean;
    title: string;
    message: string;
    confirmLabel: string;
    cancelLabel?: string;
    destructive?: boolean;
    alternateLabel?: string;
    onAlternate?: () => void;
    onConfirm: () => void;
    onCancel: () => void;
  }
  const {
    open, title, message, confirmLabel,
    cancelLabel = 'Cancel', destructive = false, alternateLabel, onAlternate, onConfirm, onCancel
  }: Props = $props();

  const uid = $props.id();
  const titleId = `${uid}-title`;
  let dialog: HTMLDialogElement | undefined = $state();

  $effect(() => {
    if (!dialog) return;
    // showModal twice throws, and so does close on a dialog that is not open.
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  });
</script>

<!-- cancel fires for Escape and for the backdrop; it must mean the same thing
     as pressing Cancel, or Escape silently confirms. -->
<dialog bind:this={dialog} class="confirm" aria-labelledby={titleId} oncancel={onCancel}>
  <h2 id={titleId}>{title}</h2>
  <p>{message}</p>
  <div class="form-footer">
    <button type="button" class="secondary" onclick={onCancel}>{cancelLabel}</button>
    {#if alternateLabel && onAlternate}<button type="button" class="secondary" onclick={onAlternate}>{alternateLabel}</button>{/if}
    <button type="button" class={destructive ? 'danger-solid' : ''} onclick={onConfirm}>{confirmLabel}</button>
  </div>
</dialog>
