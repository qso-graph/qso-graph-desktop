<!-- SPDX-License-Identifier: GPL-3.0-only -->
<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import TroubleshootingPanel from './TroubleshootingPanel.svelte';
  import type { LogsStatus } from '../../main/logs-contract.js';

  const logs: LogsStatus = {
    level: 'info',
    defaultLevel: 'info',
    revertAfterMs: 60 * 60 * 1000,
    directory: '/Users/you/Library/Logs/QSO Graph Desktop'
  };

  const { Story } = defineMeta({
    title: 'pages/TroubleshootingPanel',
    component: TroubleshootingPanel,
    args: {
      engine: { state: 'running', version: '17.11' },
      onStartEngine: () => Promise.resolve(),
      onStopEngine: () => Promise.resolve(),
      logs,
      onSetLevel: () => Promise.resolve(true),
      onExport: () => Promise.resolve('Saved 3 log files (0.4 MB). Passwords and keys were removed.'),
      onClose: () => {}
    }
  });
</script>

<Story name="Running" />
<!-- The two states an operator opens this for: it will not start, and it is
     still coming up. Both in both themes (QGD-FRM-0007). -->
<Story name="Stopped with a reason" args={{
  engine: { state: 'stopped', reason: 'The data directory is from PostgreSQL 16 and this release carries 17.' }
}} />
<Story name="Starting" args={{ engine: { state: 'starting' } }} />
