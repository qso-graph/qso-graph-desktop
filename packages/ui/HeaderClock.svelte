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
  import { lampState, lampWords } from './net-lamp.js';

  interface Props {
    now?: Date;
    // Whether the computer is on a network, as the operating system says:
    // the Internet lamp beside the clocks, an instrument reading always in
    // view (KI7MT, 2026-10-23). Absent, no lamp.
    online?: boolean | undefined;
    // Whether the last request a page made reached its source; false lights
    // the lamp yellow while the network is up (QGD-HOM-0005).
    reached?: boolean | null | undefined;
  }
  const { now, online, reached }: Props = $props();
  // Red, yellow or green, and in words (net-lamp.ts).
  const lamp = $derived(lampState(online, reached));
  const said = $derived(lampWords(lamp));

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

<div class="header-chips">
  <div class="header-clock" id="header-clock" role="group" aria-label="Clock">
    <span class="clock-part"><span class="clock-label">UTC</span> <time class="clock-time">{text.utcDate} {text.utcTime}</time></span>
    <span class="clock-part"><span class="clock-label">Local</span> <time class="clock-time">{text.localTime}</time></span>
    {#if online !== undefined}
      <!-- A dot, red, yellow or green (KI7MT, 2026-10-23): no word beside it.
           A screen reader and the tooltip say which. -->
      <span class="clock-part net-lamp" id="net-lamp" data-lamp={lamp} role="status" aria-label={said} title={said}>
        <span class="clock-label">Internet</span> <span class="net-light" aria-hidden="true"></span>
      </span>
    {/if}
  </div>
</div>
