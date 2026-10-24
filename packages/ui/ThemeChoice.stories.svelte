<!-- SPDX-License-Identifier: GPL-3.0-only -->
<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import ThemeChoice from './ThemeChoice.svelte';

  const { Story } = defineMeta({
    title: 'ui/ThemeChoice',
    component: ThemeChoice,
    args: { choice: 'system', onChoose: () => Promise.resolve(true) }
  });
</script>

<!-- All three, because QGD-FRM-0002's default is one of them and a control
     showing the wrong selection is the failure worth seeing. -->
<Story name="System" />
<Story name="Light" args={{ choice: 'light' }} />
<Story name="Dark" args={{ choice: 'dark' }} />
<!-- The save that was refused: the control keeps showing the stored theme. -->
<Story name="Save refused" args={{ onChoose: () => Promise.resolve(false) }} />
