<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!--
  The navigation rail. Buttons, not links: QGD-PRC-0006 allows exactly one
  bundled page, so a page here is a section of it and the browser's history is
  never involved. P3-navigation asserts that.

  Each item is an icon with its label underneath and a fuller description as a
  tooltip. The label is the button's content, so it is also the accessible
  name; the title is a tooltip and never the name, which keeps what is read
  aloud and what is seen the same thing.

  Icons are inline SVG from Font Awesome Free (CC BY 4.0, credited in NOTICE
  and in Settings' About). Inline because QGD-SEC-0008 allows the renderer no
  font and no image, and markup is neither.
-->
<script lang="ts">
  import { ICONS, type Icon } from './icons.js';

  interface Page {
    readonly id: string;
    readonly label: string;
    readonly icon: string;
    // The place's hue: general, callsigns, locations or settings.
    readonly hue?: string;
    readonly description: string;
    readonly placement: string;
  }

  interface Props {
    pages: readonly Page[];
    current: string;
    onNavigate: (id: string) => void;
  }
  const { pages, current, onNavigate }: Props = $props();

  const top = $derived(pages.filter(page => page.placement !== 'bottom'));
  const bottom = $derived(pages.filter(page => page.placement === 'bottom'));

  // A missing icon draws nothing rather than throwing: a rail item with no
  // picture is still usable, and it still has its label.
  const glyph = (key: string): Icon | undefined => ICONS[key] ?? ICONS.extension;
</script>

{#snippet item(page: Page)}
  <button
    type="button"
    class="rail-item"
    class:current={page.id === current}
    data-hue={page.hue ?? 'general'}
    aria-current={page.id === current ? 'page' : undefined}
    title={page.description}
    onclick={() => onNavigate(page.id)}
  >
    {#if glyph(page.icon)}
      <svg class="rail-icon" viewBox={glyph(page.icon)?.viewBox} aria-hidden="true" fill="currentColor">
        <path d={glyph(page.icon)?.path} />
      </svg>
    {/if}
    <!-- A word longer than the rail is wide, Integrations, is drawn a point
         smaller rather than cut or broken mid-word; labels of several words
         wrap as they always did. -->
    <span class="rail-label" class:rail-label-long={page.label.split(' ').some(word => word.length > 10)}>{page.label}</span>
  </button>
{/snippet}

<nav class="rail" aria-label="Sections">
  <div class="rail-group">
    {#each top as page (page.id)}{@render item(page)}{/each}
  </div>
  <div class="rail-group rail-end">
    {#each bottom as page (page.id)}{@render item(page)}{/each}
  </div>
</nav>
