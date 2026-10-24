<!-- SPDX-License-Identifier: GPL-3.0-only -->
<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import WhatsNewPanel from './WhatsNewPanel.svelte';
  import { parseChangelog } from '../../main/whats-new-contract.js';

  const sections = parseChangelog([
    '## [0.2.0] - 2026-11-20', '', '### Added', '',
    '- **Logbooks**, one for each activation, exported as POTA wants them.', '',
    '## [0.1.0] - 2026-10-30', '', '### Added', '',
    '- **Parks On the Air**: Near Me, Spots and Most Wanted, filtered as POTA does.',
    '- Backup and restore in Settings, as a plain `.json` file.'
  ].join('\n'));
  const { Story } = defineMeta({
    title: 'pages/WhatsNewPanel',
    component: WhatsNewPanel,
    args: { notes: { version: '0.2.0', sections: sections.slice(0, 1) }, onClose: () => {} }
  });
</script>

<!-- One release; two, after skipping one; and while reading. -->
<Story name="One release" />
<Story name="Since 0.0.9" args={{ notes: { version: '0.2.0', sections } }} />
<Story name="Reading" args={{ notes: undefined }} />
