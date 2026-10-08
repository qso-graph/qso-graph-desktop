<!-- SPDX-License-Identifier: GPL-3.0-only -->
<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import Shell from './Shell.svelte';
  import { createShellStore } from './shell-store.js';
  import type { LogsStatus } from '../logs-contract.js';

  const logs: LogsStatus = {
    level: 'info',
    defaultLevel: 'info',
    revertAfterMs: 60 * 60 * 1000,
    directory: '/Users/you/Library/Logs/QG Desktop'
  };
  const settled = {
    onChooseTheme: () => Promise.resolve(true),
    onSetLevel: () => Promise.resolve(true),
    onExport: () => Promise.resolve('Saved 3 log files (0.4 MB). Passwords and keys were removed.')
  };

  const { Story } = defineMeta({
    title: 'Shell',
    component: Shell,
    args: { store: createShellStore(), ...settled }
  });
</script>

<Story name="Personas" />
<Story
  name="Settings"
  args={{
    store: createShellStore({
      page: 'settings',
      activePersona: 'Active: W1AW · Home station',
      themeChoice: 'system',
      logs
    })
  }}
/>
