<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!--
  A confirmation before something that cannot be undone.

  A native <dialog> opened with showModal, which is what gives the focus trap,
  the Escape key and the inert background for nothing — written by hand these
  are the three things that get missed. The destructive action is named, not
  called "OK": a button that says "Remove persona" tells the reader what is
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
    onConfirm: () => void;
    onCancel: () => void;
  }
  const {
    open, title, message, confirmLabel,
    cancelLabel = 'Cancel', destructive = false, onConfirm, onCancel
  }: Props = $props();

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
<dialog bind:this={dialog} class="confirm" aria-labelledby="confirm-title" oncancel={onCancel}>
  <h2 id="confirm-title">{title}</h2>
  <p>{message}</p>
  <div class="form-footer">
    <button type="button" class="secondary" onclick={onCancel}>{cancelLabel}</button>
    <button type="button" class={destructive ? 'danger-solid' : ''} onclick={onConfirm}>{confirmLabel}</button>
  </div>
</dialog>
