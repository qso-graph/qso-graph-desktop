<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!--
  A flat world map with the night greyed out and the terminator drawn (page
  data version 6; KI7MT, 2026-10-22). The extension says where the sun is
  overhead and which places to mark; the coastlines and the night are the
  core's, so no extension draws a picture. Every colour is a theme token.
-->
<script lang="ts">
  import { WORLD_LAND } from './generated/world-land.js';
  import type { Mark, Place } from './page-shapes.js';
  import { MAP_HEIGHT, MAP_WIDTH, antisolar, capPath, mapDescription, mapX, mapY, nightPath, terminatorPath } from './world-map.js';

  interface Props {
    sun: Place;
    moon?: Place | undefined;
    // The grey line: from the horizon down to this depth, shaded lighter
    // than the night beyond it.
    twilight?: number | undefined;
    marks: readonly Mark[];
  }
  const { sun, moon, twilight, marks }: Props = $props();
  // A label near the east edge is written to the left of its mark, so it
  // stays on the map.
  const anchor = (longitude: number) => (longitude > 120 ? 'end' : 'start');
  const offset = (longitude: number) => (longitude > 120 ? -3 : 3);
</script>

<figure class="world-map">
  <svg viewBox="0 0 {MAP_WIDTH} {MAP_HEIGHT}" role="img" aria-label={mapDescription(marks, moon !== undefined, twilight)}>
    <rect class="map-sea" width={MAP_WIDTH} height={MAP_HEIGHT} />
    <path class="map-land" d={WORLD_LAND} />
    {#if twilight === undefined}
      <path class="map-night" d={nightPath(sun)} />
    {:else}
      <!-- The whole dark side lightly, then the night past the twilight's
           depth over it: what is left lighter is the grey line. -->
      <path class="map-twilight" d={nightPath(sun)} />
      <path class="map-deep" d={capPath(antisolar(sun), 90 + twilight)} />
    {/if}
    <path class="map-terminator" d={terminatorPath(sun)} />
    <circle class="map-sun" cx={mapX(sun.longitude)} cy={mapY(sun.latitude)} r="3" />
    {#if moon}<circle class="map-moon" cx={mapX(moon.longitude)} cy={mapY(moon.latitude)} r="2.4" />{/if}
    {#each marks as mark, i (i)}
      <circle class="map-mark" cx={mapX(mark.longitude)} cy={mapY(mark.latitude)} r="1.8" />
      <text class="map-label" x={mapX(mark.longitude) + offset(mark.longitude)} y={mapY(mark.latitude) + 2} text-anchor={anchor(mark.longitude)}>{mark.label}</text>
    {/each}
  </svg>
  <!-- Natural Earth's own words for a credit, under every map the core draws
       from its data: not required by its public-domain terms, given gladly
       (KI7MT, 2026-10-23). -->
  <figcaption class="map-credit">Made with Natural Earth. Free vector and raster map data @ naturalearthdata.com.</figcaption>
</figure>
