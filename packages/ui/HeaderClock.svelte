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
  import { clockText, sunText, type SunText } from './clock-text.js';
  import { sunDay } from './sun.js';

  interface Props {
    now?: Date;
    // The active location's position, for sunrise and sunset there
    // (QGD-FRM-0014). None, and the clock is shown alone.
    position?: { latitude: number; longitude: number };
  }
  const { now, position }: Props = $props();

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

  // Worked out once a minute, not each second: the events are to the minute,
  // and a day's search is 1,440 steps. Again when the location changes.
  let sunKey = '';
  let sunCache: SunText | undefined;
  const sun = $derived.by(() => {
    if (!position) return undefined;
    const key = `${Math.floor(shown.getTime() / 60_000)} ${position.latitude} ${position.longitude}`;
    if (key !== sunKey) {
      sunKey = key;
      sunCache = sunText(shown, at => sunDay(at, position.latitude, position.longitude));
    }
    return sunCache;
  });
</script>

<div class="header-chips">
  <div class="header-clock" id="header-clock" role="group" aria-label="Clock">
    <span class="clock-part"><span class="clock-label">UTC</span> <time class="clock-time">{text.utcDate} {text.utcTime}</time></span>
    <span class="clock-part"><span class="clock-label">Local</span> <time class="clock-time">{text.localTime}</time></span>
  </div>
  <!-- Its own box, so on a narrow window the sun can go and the clock stay.
       Local time, like Local beside it; the next event's label is lit. -->
  {#if sun}
    <div class="header-clock header-sun" id="header-sun" role="group" aria-label="Sunrise and sunset, local time">
      {#if sun.allDay}
        <span class="clock-part"><time class="clock-time">{sun.allDay}</time></span>
      {:else}
        {#if sun.sunrise}<span class="clock-part" class:next={sun.next === 'sunrise'}><span class="clock-label">Sunrise</span> <time class="clock-time">{sun.sunrise}</time></span>{/if}
        {#if sun.sunset}<span class="clock-part" class:next={sun.next === 'sunset'}><span class="clock-label">Sunset</span> <time class="clock-time">{sun.sunset}</time></span>{/if}
      {/if}
    </div>
  {/if}
</div>
