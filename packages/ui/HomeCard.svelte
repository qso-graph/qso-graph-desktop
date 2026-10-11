<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!--
  One Home card, drawn by the core from data (QGD-HOM-0002).

  Text only: every string here is an expression in the template, which Svelte
  escapes, and nothing is inserted as raw HTML. An extension decides what a card
  says, never what it looks like, so every card reads like the rest of the
  application.
-->
<script lang="ts">
  import { utc, type CardShown } from './home-card.js';

  interface Props {
    name: string;
    shown: CardShown;
  }
  const { name, shown }: Props = $props();
</script>

<section class="card home-card" aria-label={name} aria-busy={shown.state === 'waiting'}>
  <header class="home-card-head">
    <h2>{name}</h2>
    {#if shown.state === 'ready'}<span class="home-card-time">{utc(shown.observedAt)}</span>{/if}
  </header>
  {#if shown.state === 'waiting'}
    <p class="hint">Getting the latest…</p>
  {:else if shown.state === 'failed'}
    <p class="home-card-failed" role="status">{shown.reason}</p>
  {:else}
    {#each shown.sections as section, at (at)}
      {#if section.shape === 'alert'}
        <p class="home-card-alert {section.level}" role={section.level === 'info' ? 'status' : 'alert'}>{section.text}</p>
      {:else if section.shape === 'figures'}
        <dl class="home-card-figures">
          {#each section.figures as figure, i (i)}
            <div>
              <dt>{figure.label}</dt>
              <dd>{figure.value}{#if figure.unit}<span class="unit"> {figure.unit}</span>{/if}</dd>
            </div>
          {/each}
        </dl>
      {:else}
        <ul class="home-card-items">
          {#each section.items as item, i (i)}
            <li><span class="item-title">{item.title}</span>{#if item.detail}<span class="item-detail">{item.detail}</span>{/if}</li>
          {/each}
        </ul>
      {/if}
    {/each}
  {/if}
</section>
