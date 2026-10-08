<!-- SPDX-License-Identifier: GPL-3.0-only -->
<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import SettingsPage from './SettingsPage.svelte';
  import type { LogsStatus } from '../../logs-contract.js';

  const logs: LogsStatus = {
    level: 'info',
    defaultLevel: 'info',
    revertAfterMs: 60 * 60 * 1000,
    directory: '/Users/you/Library/Logs/QSO Graph Desktop'
  };

  const { Story } = defineMeta({
    title: 'pages/SettingsPage',
    component: SettingsPage,
    args: {
      themeChoice: 'system',
      onChooseTheme: () => Promise.resolve(true),
      logs,
      onSetLevel: () => Promise.resolve(true),
      onExport: () => Promise.resolve('Saved 3 log files (0.4 MB). Passwords and keys were removed.')
    }
  });
</script>

<Story name="Default" />
<Story name="Dark chosen" args={{ themeChoice: 'dark' }} />
