<!-- SPDX-License-Identifier: GPL-3.0-only -->
<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { RESOURCES_LOADED } from './reference-fixtures.js';
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
      storage: {
        state: 'ready', folder: '/Users/you/Library/Application Support/QSO Graph Desktop',
        sizes: { state: 98_304, reference: 17_539_072 },
        reference: {
          adif: { state: 'loaded', version: '3.1.7', rows: 3345, fetchedAt: '2026-10-10T12:00:00.000Z' },
          parks: { state: 'loaded', rows: 96532, fetchedAt: '2026-10-10T12:00:00.000Z' },
          programs: { state: 'loaded', rows: 249, fetchedAt: '2026-10-10T12:00:00.000Z' },
          locations: { state: 'loaded', rows: 4006, fetchedAt: '2026-10-10T12:00:00.000Z' },
          summits: { state: 'loaded', rows: 182280, fetchedAt: '2026-10-10T12:00:00.000Z' },
          refreshing: false,
          resources: RESOURCES_LOADED
        }
      },
      logs,
      onSetLevel: () => Promise.resolve(true),
      onExport: () => Promise.resolve('Saved 3 log files (0.4 MB). Passwords and keys were removed.'),
      onClose: () => {}
    }
  });
</script>

<Story name="Ready" />
<!-- The two states an operator opens this for: it could not open, and it is
     still opening. Both in both themes (QGD-FRM-0007). -->
<Story name="Could not open" args={{ storage: { state: 'failed', reason: 'Storage could not be opened.' } }} />
<Story name="Opening" args={{ storage: { state: 'starting' } }} />
