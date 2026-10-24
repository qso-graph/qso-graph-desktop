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
    version: '0.1.0',
    onChooseTheme: () => Promise.resolve(true),
    onSetExtension: () => Promise.resolve(true),
    onUpdateReference: () => Promise.resolve(undefined),
    onSaveStation: () => Promise.resolve(undefined),
    onDeleteStation: () => Promise.resolve(undefined),
    onSetActiveStation: () => Promise.resolve(undefined),
    onStationFromPark: () => Promise.resolve('Not in a story.'),
    onStationChoices: () => Promise.resolve(undefined),
    onLookUpParks: () => Promise.resolve(undefined),
    onCloseUpdate: () => {},
    onOpenWhatsNew: () => {},
    onCloseWhatsNew: () => {},
    onStationFromSummit: () => Promise.resolve('Not in a story.'),
    onOpenPage: () => {},
    onCountiesAt: () => Promise.resolve({ counties: [], sections: {} }),
    onSetLevel: () => Promise.resolve(true),
    onExport: () => Promise.resolve('Saved 3 log files (0.4 MB).'),
    onCreateCallsign: () => Promise.resolve(undefined),
    onSaveCredential: () => Promise.resolve(undefined),
    onFinishSetup: () => {},
    onExportCallsigns: () => Promise.resolve({ written: 'qso-graph-backup.json', bytes: 1195 }),
    onInspectImport: () => Promise.resolve({
      created: '2026-10-09T06:13:30Z', callsigns: 1, arriving: ['W1AW · Home'], here: [], locations: ['Home'], locationsHere: 0
    }),
    onApplyImport: () => Promise.resolve({ callsigns: 1, locations: 1 })
  };

  const { Story } = defineMeta({
    title: 'Shell',
    component: Shell,
    args: { store: createShellStore(), home: createHomeStore(undefined), ...settled }
  });
</script>

<Story name="Callsigns" />
<Story
  name="Settings"
  args={{
    store: createShellStore({
      page: 'settings', extensionPage: null,
      activeCallsign: 'W1AW',
      activeCallsignId: '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b',
      activeCallsignLabel: 'W1AW · Home station',
      themeChoice: 'system',
      logs,
      storage: { state: 'ready' },
      troubleshooting: false,
      updatedFrom: '0.0.9', whatsNew: null, customizing: false, setup: false,
      firstRun: false,
      services: [],
      extensions: undefined,
      refusedExtensions: [],
      area: [],
      update: { kind: 'ready', version: '0.1.1' }, updateCheck: true, updateTrack: 'stable'
    })
  }}
/>
