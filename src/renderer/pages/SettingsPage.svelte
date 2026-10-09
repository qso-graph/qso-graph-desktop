<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!--
  Settings. Appearance is here now; the Logs page QGD-LOG-0013 puts in Settings
  lands with the level switch and the export action that drive it, rather than
  as a heading with nothing behind it.
-->
<script lang="ts">
  import PageLayout from '../ui/PageLayout.svelte';
  import ThemeChoice from '../ui/ThemeChoice.svelte';
  import LogsPage from './LogsPage.svelte';
  import MoveProfilePage from './MoveProfilePage.svelte';
  import EnginePage from './EnginePage.svelte';
  import type { ThemeChoice as Choice } from '../../settings-contract.js';
  import type { LogsStatus } from '../../logs-contract.js';
  import type { Level } from '../../logging.js';
  import type { EngineStatus } from '../../engine-contract.js';
  import type { ExportResult, ImportPreview, ImportResult } from '../../persona-contract.js';

  interface Props {
    themeChoice: Choice;
    onChooseTheme: (choice: Choice) => Promise<boolean>;
    logs: LogsStatus | undefined;
    onSetLevel: (level: Level) => Promise<boolean>;
    onExport: () => Promise<string>;
    engine: EngineStatus | undefined;
    onStartEngine: () => Promise<void>;
    onStopEngine: () => Promise<void>;
    onExportProfile: (passphrase: string) => Promise<ExportResult | string>;
    onInspectImport: (passphrase: string) => Promise<ImportPreview | string>;
    onApplyImport: (passphrase: string) => Promise<ImportResult | string>;
  }
  const {
    themeChoice, onChooseTheme, logs, onSetLevel, onExport,
    engine, onStartEngine, onStopEngine,
    onExportProfile, onInspectImport, onApplyImport
  }: Props = $props();
</script>

<PageLayout eyebrow="PREFERENCES" title="Settings">
  <section class="card" aria-labelledby="appearance-title">
    <h2 id="appearance-title">Appearance</h2>
    <ThemeChoice choice={themeChoice} onChoose={onChooseTheme} />
  </section>
  <EnginePage status={engine} onStart={onStartEngine} onStop={onStopEngine} />
  <MoveProfilePage onExport={onExportProfile} onInspect={onInspectImport} onImport={onApplyImport} />
  <LogsPage status={logs} {onSetLevel} {onExport} />
</PageLayout>
