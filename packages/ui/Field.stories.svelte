<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!-- QGD-FRM-0010 pattern: form-validation -->
<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import Field, { type ControlAttributes } from './Field.svelte';

  const { Story } = defineMeta({
    title: 'patterns/Field (form validation)',
    component: Field,
    args: { id: 'callsign', label: 'Callsign' }
  });
</script>

{#snippet text({ describedBy, invalid }: ControlAttributes)}
  <input id="callsign" type="text" value="W1AW" aria-describedby={describedBy} aria-invalid={invalid} />
{/snippet}

{#snippet empty({ describedBy, invalid }: ControlAttributes)}
  <input id="callsign" type="text" value="" aria-describedby={describedBy} aria-invalid={invalid} />
{/snippet}

<Story name="Plain" args={{ control: text }} />
<Story name="With a hint" args={{ control: text, hint: 'The callsign this callsign logs under.' }} />
<Story name="Optional" args={{ control: text, optional: true }} />
<!-- The state the pattern exists for: the message is announced, the control
     points at it, and aria-invalid agrees with what is on screen. -->
<Story name="Showing an error" args={{ control: empty, error: 'A callsign is required.' }} />
<Story
  name="Hint and error together"
  args={{ control: empty, hint: 'The callsign this callsign logs under.', error: 'A callsign is required.' }}
/>
