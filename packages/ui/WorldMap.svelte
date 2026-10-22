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
  import { MAP_HEIGHT, MAP_WIDTH, mapDescription, mapX, mapY, nightPath, terminatorPath } from './world-map.js';

  interface Props {
    sun: Place;
    marks: readonly Mark[];
  }
  const { sun, marks }: Props = $props();
  // A label near the east edge is written to the left of its mark, so it
  // stays on the map.
  const anchor = (longitude: number) => (longitude > 120 ? 'end' : 'start');
  const offset = (longitude: number) => (longitude > 120 ? -3 : 3);
</script>

<figure class="world-map">
  <svg viewBox="0 0 {MAP_WIDTH} {MAP_HEIGHT}" role="img" aria-label={mapDescription(marks)}>
    <rect class="map-sea" width={MAP_WIDTH} height={MAP_HEIGHT} />
    <path class="map-land" d={WORLD_LAND} />
    <path class="map-night" d={nightPath(sun)} />
    <path class="map-terminator" d={terminatorPath(sun)} />
    <circle class="map-sun" cx={mapX(sun.longitude)} cy={mapY(sun.latitude)} r="3" />
    {#each marks as mark, i (i)}
      <circle class="map-mark" cx={mapX(mark.longitude)} cy={mapY(mark.latitude)} r="1.8" />
      <text class="map-label" x={mapX(mark.longitude) + offset(mark.longitude)} y={mapY(mark.latitude) + 2} text-anchor={anchor(mark.longitude)}>{mark.label}</text>
    {/each}
  </svg>
</figure>
