<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!-- QGD-FRM-0010 pattern: confirm-dialog -->
<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import ConfirmDialog from './ConfirmDialog.svelte';

  const { Story } = defineMeta({
    title: 'patterns/ConfirmDialog',
    component: ConfirmDialog,
    args: {
      open: true,
      title: 'Remove this persona?',
      message: 'W1AW · Home station and the credentials saved for it will be removed from this Mac. This cannot be undone.',
      confirmLabel: 'Remove persona',
      destructive: true,
      onConfirm: () => {},
      onCancel: () => {}
    }
  });
</script>

<Story name="Destructive" />
<Story name="Ordinary" args={{ title: 'Use this persona?', message: 'W1AW becomes the active persona.', confirmLabel: 'Use persona', destructive: false }} />
<Story name="Closed" args={{ open: false }} />
