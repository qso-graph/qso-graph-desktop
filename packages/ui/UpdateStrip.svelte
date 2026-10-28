<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!--
  One line at the top of Home after an update (QGD-FRM-0016, KI7MT
  2026-10-24: the pop-up got in the way). It says the version, offers the
  notes, and × hides it until the next update. Nothing else ever shows it.
  After going back to an older version it says so, and offers no notes: nothing
  in it is new (#119).
-->
<script lang="ts">
  interface Props {
    version: string;
    back?: boolean;
    onSee: () => void;
    onClose: () => void;
  }
  const { version, back = false, onSee, onClose }: Props = $props();
</script>

<div class="update-strip" id="update-strip" role="status">
  {#if back}
    <span>Went back to {version}</span>
  {:else}
    <span>Updated to {version}</span>
    <span aria-hidden="true">·</span>
    <button type="button" class="strip-link" id="update-strip-notes" onclick={onSee}>See what's new</button>
  {/if}
  <button type="button" class="strip-close" id="update-strip-close" aria-label="Close" onclick={onClose}>×</button>
</div>

<style>
  .update-strip {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px 6px 14px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface);
    margin-bottom: 12px;
  }
  .strip-link {
    background: none;
    border: 0;
    padding: 0;
    color: inherit;
    font: inherit;
    text-decoration: underline;
    cursor: pointer;
  }
  .strip-close {
    margin-left: auto;
    background: none;
    border: 0;
    color: inherit;
    font-size: 1.2em;
    line-height: 1;
    padding: 2px 6px;
    cursor: pointer;
  }
</style>
