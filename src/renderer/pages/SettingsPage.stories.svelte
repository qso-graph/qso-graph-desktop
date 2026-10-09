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
      engine: { state: 'running', version: '17.11' },
      onStartEngine: () => Promise.resolve(),
      onStopEngine: () => Promise.resolve(),
      onExport: () => Promise.resolve('Saved 3 log files (0.4 MB). Passwords and keys were removed.'),
      onExportProfile: () => Promise.resolve({ written: 'qso-graph-personas.qgp', bytes: 1195 }),
      onInspectImport: () => Promise.resolve({
        created: '2026-10-09T06:13:30Z', personas: 2, credentials: 2,
        arriving: ['home'], overwritten: ['portable']
      }),
      onApplyImport: () => Promise.resolve({ personas: 2, credentials: 2 })
    }
  });
</script>

<Story name="Default" />
<Story name="Dark chosen" args={{ themeChoice: 'dark' }} />
