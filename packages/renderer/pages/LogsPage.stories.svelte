<!-- SPDX-License-Identifier: GPL-3.0-only -->
<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import LogsPage from './LogsPage.svelte';
  import type { LogsStatus } from '../../main/logs-contract.js';

  const status: LogsStatus = {
    level: 'info',
    defaultLevel: 'info',
    revertAfterMs: 60 * 60 * 1000,
    directory: '/Users/you/Library/Logs/QSO Graph Desktop'
  };

  const { Story } = defineMeta({
    title: 'pages/LogsPage',
    component: LogsPage,
    args: {
      status,
      onSetLevel: () => Promise.resolve(true),
      onExport: () => Promise.resolve('Saved 3 log files (0.4 MB).')
    }
  });
</script>

<Story name="Default level" />
<Story name="Raised to debug" args={{ status: { ...status, level: 'debug' } }} />
<!-- Before the main process has answered. -->
<Story name="Still reading" args={{ status: undefined }} />
<Story name="Level could not be saved" args={{ onSetLevel: () => Promise.resolve(false) }} />
