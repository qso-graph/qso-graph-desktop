<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!--
  Settings: the operator's preferences, and nothing else.

  It held five sections until 2026-10-10 — appearance, a per-grant permission
  list for three demonstration applications, the database's internal state, an
  encrypted export tool and a log viewer with level and retention controls.
  Four of those were the frame describing itself. An operator opening Settings
  wants to change how the product behaves, not to read what the database is
  doing.

  Where each went, and the reference it follows:

    - the grant list: nowhere. An official application's grants are what the
      application is, so a per-capability choice offers no decision and
      teaches the operator to agree (`QGD-APP-0012.1`). VS Code has no
      per-permission screen at all; it asks once whether a publisher is
      trusted.
    - the database: Troubleshooting, as a Storage section (`QGD-FRM-0012`).
      It was a status-bar indicator until the bundled PostgreSQL went on
      2026-10-10; with nothing to start or stop, it needs none.
    - the logs, the level and the support bundle: Troubleshooting on the
      status bar (`QGD-LOG-0013`), which is where Podman Desktop puts its
      Logs tab and its "collect logs as .zip".
    - export and import of personas: the Personas page, beside the personas
      they are about. Bitwarden's desktop client keeps vault export under the
      application menu rather than in preferences.

  What is left is appearance, and Storage when QG Sync is built.
-->
<script lang="ts">
  import PageLayout from '../../ui/PageLayout.svelte';
  import ThemeChoice from '../../ui/ThemeChoice.svelte';
  import type { ThemeChoice as Choice } from '../../main/settings-contract.js';

  interface Props {
    themeChoice: Choice;
    onChooseTheme: (choice: Choice) => Promise<boolean>;
  }
  const { themeChoice, onChooseTheme }: Props = $props();
</script>

<PageLayout eyebrow="PREFERENCES" title="Settings">
  <section class="card" aria-labelledby="appearance-title">
    <h2 id="appearance-title">Appearance</h2>
    <ThemeChoice choice={themeChoice} onChoose={onChooseTheme} />
  </section>
</PageLayout>
