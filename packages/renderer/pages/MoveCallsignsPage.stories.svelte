<!-- SPDX-License-Identifier: GPL-3.0-only -->
<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import MoveCallsignsPage from './MoveCallsignsPage.svelte';

  // The states worth looking at are the ones an operator meets when something
  // is wrong, so most of these are refusals. A refusal here is a sentence the
  // caller returns, not a thrown error: each is something to act on.
  const { Story } = defineMeta({
    title: 'pages/MoveCallsignsPage',
    component: MoveCallsignsPage,
    args: {
      onExport: () => Promise.resolve({ written: 'qso-graph-callsigns.qgp', bytes: 1195 }),
      onInspect: () => Promise.resolve({
        created: '2026-10-09T06:13:30Z', callsigns: 2, logins: 0,
        arriving: ['W1AW · Home', 'W1AW/P · Portable'], here: [], locations: ['Home', 'Camp'], locationsHere: 0
      }),
      onImport: () => Promise.resolve({ callsigns: 2, locations: 2 })
    }
  });
</script>

<Story name="Default" />

<!-- QGD-PSN-0009: a restore onto a computer that already has some removes
     them first, said before it is done and only once the operator agrees. -->
<Story name="Would remove what is here" args={{
  onInspect: () => Promise.resolve({
    created: '2026-10-09T06:13:30Z', callsigns: 2, logins: 3,
    arriving: ['W1AW · Home', 'W1AW/P · Portable'], here: ['K7ABC · Shack'], locations: ['Home', 'Camp'], locationsHere: 4
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
