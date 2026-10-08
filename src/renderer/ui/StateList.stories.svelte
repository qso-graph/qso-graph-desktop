<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!-- QGD-FRM-0010 pattern: list-states -->
<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import StateList from './StateList.svelte';

  interface Persona { callsign: string; name: string }

  const personas: Persona[] = [
    { callsign: 'W1AW', name: 'Home station' },
    { callsign: 'K1ABC/P', name: 'Portable' },
    { callsign: 'W1AW/4', name: 'Field Day' }
  ];

  const { Story } = defineMeta({
    title: 'patterns/StateList',
    component: StateList,
    args: { label: 'Personas', state: 'ready', items: personas }
  });
</script>

<!-- Storybook's args resolve the component's generic to unknown, so the
     snippet is narrowed here. In the application StateList is generic and a
     caller's snippet is typed by the items it was given. -->
{#snippet row(entry: unknown)}
  {@const persona = entry as Persona}
  <strong>{persona.callsign}</strong>
  <span>{persona.name}</span>
{/snippet}

{#snippet retry()}
  <button type="button" class="secondary">Try again</button>
{/snippet}

<!-- All four, because the three that are not "populated" are the ones that
     get written differently every time they are needed. -->
<Story name="Populated" args={{ item: row }} />
<Story name="Loading" args={{ item: row, state: 'loading' }} />
<Story name="Empty" args={{ item: row, items: [], empty: 'No personas yet. Start with your station callsign.' }} />
<Story name="Failed" args={{ item: row, state: 'error', error: 'The persona list could not be read.' }} />
<Story name="Failed, with a way back" args={{ item: row, state: 'error', error: 'The persona list could not be read.', retry }} />
