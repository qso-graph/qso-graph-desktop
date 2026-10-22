<!-- SPDX-License-Identifier: GPL-3.0-only -->
<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import Shell from './Shell.svelte';
  import { createShellStore } from './shell-store.js';
  import { createHomeStore } from './home-store.js';
  import type { LogsStatus } from '../main/logs-contract.js';

  const logs: LogsStatus = {
    level: 'info',
    defaultLevel: 'info',
    revertAfterMs: 60 * 60 * 1000,
    directory: '/Users/you/Library/Logs/QSO Graph Desktop'
  };
  const settled = {
    version: '0.0.0-preview.1',
    onChooseTheme: () => Promise.resolve(true),
    onSetExtension: () => Promise.resolve(true),
    onUpdateReference: () => Promise.resolve(undefined),
    onSaveStation: () => Promise.resolve(undefined),
    onDeleteStation: () => Promise.resolve(undefined),
    onSetActiveStation: () => Promise.resolve(undefined),
    onStationFromPark: () => Promise.resolve('Not in a story.'),
    onStationChoices: () => Promise.resolve(undefined),
    onLookUpParks: () => Promise.resolve(undefined),
    onCloseWelcome: () => {},
    onStationFromSummit: () => Promise.resolve('Not in a story.'),
    onCountiesAt: () => Promise.resolve({ counties: [], sections: {} }),
    onSetLevel: () => Promise.resolve(true),
    onExport: () => Promise.resolve('Saved 3 log files (0.4 MB). Passwords and keys were removed.'),
    onCreatePersona: () => Promise.resolve(undefined),
    onSaveCredential: () => Promise.resolve(undefined),
    onFinishSetup: () => {},
    onExportPersonas: () => Promise.resolve({ written: 'qso-graph-personas.qgp', bytes: 1195 }),
    onInspectImport: () => Promise.resolve({
      created: '2026-10-09T06:13:30Z', personas: 1, credentials: 1, arriving: ['home'], overwritten: []
    }),
    onApplyImport: () => Promise.resolve({ personas: 1, credentials: 1 })
  };

  const { Story } = defineMeta({
    title: 'Shell',
    component: Shell,
    args: { store: createShellStore(), home: createHomeStore(undefined), ...settled }
  });
</script>

<Story name="Personas" />
<Story
  name="Settings"
  args={{
    store: createShellStore({
      page: 'settings',
      activePersona: 'W1AW · Home station',
      activeCallsign: 'W1AW',
      activePersonaName: 'Home station',
      themeChoice: 'system',
      logs,
      storage: { state: 'ready' },
      troubleshooting: false,
      help: null,
      welcome: false, setup: false,
      firstRun: false,
      services: [],
      extensions: undefined
    })
  }}
/>
