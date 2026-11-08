<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import UpdatesCard from './UpdatesCard.svelte';

  const { Story } = defineMeta({
    title: 'pages/UpdatesCard',
    component: UpdatesCard,
    args: {
      check: true, track: 'stable',
      update: { kind: 'current', checkedAt: Date.UTC(2026, 9, 23, 14, 5) },
      onSetCheck: () => Promise.resolve(true), onSetTrack: () => Promise.resolve(true)
    }
  });
</script>

<!-- Up to date; ready to install on restart; a build that cannot install it
     itself; and the switch off. -->
<Story name="Up to date" />
<Story name="Ready" args={{ update: { kind: 'ready', version: '0.1.1' } }} />
<Story name="Available" args={{ update: { kind: 'available', version: '0.1.1', checkedAt: Date.UTC(2026, 9, 23, 14, 5), installable: true } }} />
<Story name="Available, link only" args={{ update: { kind: 'available', version: '0.1.1', checkedAt: Date.UTC(2026, 9, 23, 14, 5), installable: false } }} />
<Story name="Off" args={{ check: false, update: { kind: 'off', why: 'switch' } }} />
<Story name="Development build" args={{ update: { kind: 'off', why: 'development' } }} />
<!-- Installed with Homebrew (#157): Beta is off, with why, and an update says
     how Homebrew takes it. -->
<Story name="Homebrew install" args={{ update: { kind: 'available', version: '0.6.0', checkedAt: Date.UTC(2026, 10, 2, 14, 5), installable: false, source: 'homebrew' } }} />
<!-- Choose a version… (#77): press it to see the list, forward and back; Go
     back asks first. Then a version going back, ready on restart. -->
<Story name="Choose a version" args={{
  track: 'early',
  onListVersions: () => Promise.resolve([
    { version: '0.6.0-beta.2', track: 'early', date: '2026-11-04T20:00:00.000Z', way: 'forward', snapshot: false },
    { version: '0.6.0-beta.1', track: 'early', date: '2026-11-02T20:00:00.000Z', way: 'forward', snapshot: false },
    { version: '0.5.2', track: 'stable', date: '2026-10-30T23:06:32.000Z', way: 'running', snapshot: false },
    { version: '0.5.1', track: 'stable', date: '2026-10-30T09:09:19.000Z', way: 'back', snapshot: true }
  ])
}} />
<Story name="Ready to go back" args={{ update: { kind: 'ready', version: '0.2.1', back: true } }} />
