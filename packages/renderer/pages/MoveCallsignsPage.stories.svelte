<!-- SPDX-License-Identifier: GPL-3.0-only -->
<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import MoveCallsignsPage from './MoveCallsignsPage.svelte';
  // A real backup's preview when showcase.local.json is in the checkout
  // (KI7MT, 2026-10-24; git ignores it); the sample otherwise.
  import { showcasePreview } from '../../../storybook/showcase.js';

  // The states worth looking at are the ones an operator meets when something
  // is wrong, so most of these are refusals. A refusal here is a sentence the
  // caller returns, not a thrown error: each is something to act on.
  const { Story } = defineMeta({
    title: 'pages/MoveCallsignsPage',
    component: MoveCallsignsPage,
    args: {
      onExport: () => Promise.resolve({ written: 'qso-graph-backup.json', bytes: 1195 }),
      onInspect: () => Promise.resolve(showcasePreview() ?? {
        parts: ['callsigns' as const, 'settings' as const], created: '2026-10-09T06:13:30Z', callsigns: 2,
        arriving: ['W1AW · Home', 'W1AW/P · Portable'], here: [], locations: ['Home', 'Camp'], locationsHere: 0
      }),
      onImport: () => Promise.resolve({ callsigns: 2, locations: 2, settings: true })
    }
  });
</script>

<Story name="Default" />

<!-- QGD-PSN-0009: a restore onto a computer that already has some removes
     them first, said before it is done and only once the operator agrees. -->
<Story name="Would remove what is here" args={{
  onInspect: () => Promise.resolve({
    parts: ['callsigns' as const], created: '2026-10-09T06:13:30Z', callsigns: 2,
    arriving: ['W1AW · Home', 'W1AW/P · Portable'], here: ['K7ABC · Shack'], locations: ['Home', 'Camp'], locationsHere: 4
  })
}} />

<!-- #64: a backup of the settings alone; restoring it restarts the application. -->
<Story name="Settings only" args={{
  onInspect: () => Promise.resolve({
    parts: ['settings' as const], created: '2026-10-26T18:00:00Z', callsigns: 0, arriving: [], here: ['K7ABC · Shack'], locations: [], locationsHere: 4
  }),
  onImport: () => Promise.resolve({ callsigns: 0, locations: 0, settings: true })
}} />

<!-- An encrypted export from an earlier build, said as such. -->
<Story name="Earlier encrypted file" args={{
  onInspect: () => Promise.resolve('That is an encrypted export from an earlier build, which this one does not read. Back up again from that computer.')
}} />

<Story name="Backup cancelled" args={{ onExport: () => Promise.resolve('Backup cancelled.') }} />

<Story name="Not an export" args={{
  onInspect: () => Promise.resolve('This is not a QSO Graph Desktop export.')
}} />
