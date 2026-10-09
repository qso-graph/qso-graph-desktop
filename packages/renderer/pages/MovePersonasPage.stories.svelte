<!-- SPDX-License-Identifier: GPL-3.0-only -->
<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import MovePersonasPage from './MovePersonasPage.svelte';

  // The states worth looking at are the ones an operator meets when something
  // is wrong, so most of these are refusals. A refusal here is a sentence the
  // caller returns, not a thrown error: each is something to act on.
  const { Story } = defineMeta({
    title: 'pages/MovePersonasPage',
    component: MovePersonasPage,
    args: {
      onExport: () => Promise.resolve({ written: 'qso-graph-personas.qgp', bytes: 1195 }),
      onInspect: () => Promise.resolve({
        created: '2026-10-09T06:13:30Z', personas: 2, credentials: 3,
        arriving: ['home', 'portable'], overwritten: []
      }),
      onImport: () => Promise.resolve({ personas: 2, credentials: 3 })
    }
  });
</script>

<Story name="Default" />

<!-- QGD-PSN-0009: what an import would replace, said before it is done. -->
<Story name="Would overwrite" args={{
  onInspect: () => Promise.resolve({
    created: '2026-10-09T06:13:30Z', personas: 2, credentials: 3,
    arriving: ['portable'], overwritten: ['home']
  })
}} />

<!-- QGD-PSN-0010: the one message, which says it cannot tell which. -->
<Story name="Cannot be opened" args={{
  onInspect: () => Promise.resolve(
    'This file could not be opened with that passphrase. It may be the wrong passphrase, ' +
    'or the file may have been altered.')
}} />

<Story name="Export cancelled" args={{ onExport: () => Promise.resolve('Export cancelled.') }} />

<Story name="Not an export" args={{
  onInspect: () => Promise.resolve('This is not a QSO Graph Desktop export.')
}} />
