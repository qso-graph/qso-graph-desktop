<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!--
  The status bar. P3-status-bar requires the active persona to be visible on
  every page, which is why it sits outside the pages rather than in one.
-->
<script lang="ts">
  interface Props {
    activePersona: string;
    note?: string;
  }
  const {
    activePersona,
    note = 'Stored locally · Connects only when you test a credential'
  }: Props = $props();
</script>

<footer>
  <span id="active-persona">{activePersona}</span>
  <span id="connection-note">{note}</span>
</footer>
