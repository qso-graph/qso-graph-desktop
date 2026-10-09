<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!--
  The status bar. P3-status-bar requires the active persona to be visible on
  every page, which is why it sits outside the pages rather than in one.
-->
<script lang="ts">
  interface Props {
    // Who it is, or empty. The sentence is this component's.
    activePersona: string;
    note?: string;
  }
  const {
    activePersona,
    // What the product actually does, which is now two things: a credential
    // test, and fetching the reference data POTA and ADIF publish
    // (QGD-REF-0001, QGD-REF-0009, QGD-SEC-0020). It said "only when you test
    // a credential" until the reference load made that false.
    note = 'Stored locally · Connects to test a credential or update reference data'
  }: Props = $props();
</script>

<footer>
  <span id="active-persona">{activePersona ? `Active: ${activePersona}` : 'No active persona'}</span>
  <span id="connection-note">{note}</span>
</footer>
