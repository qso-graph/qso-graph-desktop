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

  // Each tick is scheduled for just after the next whole second, not every
  // 1000 ms from whenever the page opened. An interval started at .7 of a
  // second shows each second 0.7 s late, and keeps drifting; operators of
  // FT8 and the other timed modes read this clock against the second
  // (KI7MT, 2026-10-22).
  let ticking = $state(new Date());
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tick = () => {
    ticking = new Date();
    timer = setTimeout(tick, 1000 - ticking.getMilliseconds() + 5);
  };
  tick();
  onDestroy(() => clearTimeout(timer));

  const shown = $derived(now ?? ticking);
  const text = $derived(clockText(shown));
</script>

<div class="header-clock" id="header-clock" role="group" aria-label="Clock">
  <span class="clock-part"><span class="clock-label">UTC</span> <time class="clock-time">{text.utcDate} {text.utcTime}</time></span>
  <span class="clock-part"><span class="clock-label">Local</span> <time class="clock-time">{text.localTime}</time></span>
</div>
