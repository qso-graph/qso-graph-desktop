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
  import type { ThemeChoice as Choice } from '../../settings-contract.js';
  import type { LogsStatus } from '../../logs-contract.js';
  import type { Level } from '../../logging.js';

  interface Props {
    themeChoice: Choice;
    onChooseTheme: (choice: Choice) => Promise<boolean>;
    logs: LogsStatus | undefined;
    onSetLevel: (level: Level) => Promise<boolean>;
    onExport: () => Promise<string>;
  }
  const { themeChoice, onChooseTheme, logs, onSetLevel, onExport }: Props = $props();
</script>

<PageLayout eyebrow="PREFERENCES" title="Settings">
  <section class="card" aria-labelledby="appearance-title">
    <h2 id="appearance-title">Appearance</h2>
    <ThemeChoice choice={themeChoice} onChoose={onChooseTheme} />
  </section>
  <LogsPage status={logs} {onSetLevel} {onExport} />
</PageLayout>
