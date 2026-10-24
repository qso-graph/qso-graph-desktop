<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!--
  A labelled control with its hint and its validation error, wired together.

  The pattern is the wiring, which is the part that gets forgotten: the error
  is announced, the control points at both the hint and the error through
  aria-describedby, and aria-invalid is set from the same value that decides
  whether the message is shown — so a control cannot be marked invalid while
  showing no reason, or show a reason while reading as valid.

  Ids are derived from the control's: `<id>-hint` and `<id>-error`. A caller
  that needs to find the message knows where it is without being told.
-->
<script module lang="ts">
  // What the control snippet is handed. Exported so a caller can name the
  // type rather than destructure an implicit any.
  export interface ControlAttributes {
    describedBy: string | undefined;
    invalid: true | undefined;
  }
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    id: string;
    label: string;
    hint?: string;
    error?: string;
    optional?: boolean;
    control: Snippet<[ControlAttributes]>;
  }
  const { id, label, hint, error, optional = false, control }: Props = $props();

  const describedBy = $derived(
    [hint ? `${id}-hint` : undefined, error ? `${id}-error` : undefined].filter(Boolean).join(' ') || undefined
  );
</script>

<label for={id}>{label}{#if optional}<span class="optional"> optional</span>{/if}</label>
{@render control({ describedBy, invalid: error ? true : undefined })}
{#if hint}<p id="{id}-hint" class="hint">{hint}</p>{/if}
{#if error}<p id="{id}-error" class="field-error" role="status">{error}</p>{/if}
