<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!--
  UTC and local time in the header, every second, on every page (KI7MT,
  2026-10-22). UTC first, because ham radio is talked about in UTC; seconds,
  because a clock that moves once a minute looks stopped, and digital modes
  are timed to the second. UTC carries its date, as a log does: the UTC date
  is a QSO's date, and near midnight it is not the local one (KI7MT,
  2026-10-22). The computer's clock, read here: nothing is fetched. A story
  can pass `now` to draw a fixed time.
-->
<script lang="ts">
  import { onDestroy } from 'svelte';
  import { clockText } from './clock-text.js';

  interface Props {
    now?: Date;
  }
  const { now }: Props = $props();

  let ticking = $state(new Date());
  const timer = setInterval(() => { ticking = new Date(); }, 1000);
  onDestroy(() => clearInterval(timer));

  const shown = $derived(now ?? ticking);
  const text = $derived(clockText(shown));
</script>

<div class="header-clock" id="header-clock" role="group" aria-label="Clock">
  <span class="clock-part"><span class="clock-label">UTC</span> <time class="clock-time">{text.utcDate} {text.utcTime}</time></span>
  <span class="clock-part"><span class="clock-label">Local</span> <time class="clock-time">{text.localTime}</time></span>
</div>
