<!-- SPDX-License-Identifier: GPL-3.0-only -->
<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import IntegrationsPage from './IntegrationsPage.svelte';
  import type { AdapterView, IntegrationsView } from '../../main/integrations-page-contract.js';

  // Integrations' page (QGD-INT-0010): nothing listening, listening on this
  // computer and hearing WSJT-X, and listening on a network.
  const off: AdapterView = {
    id: 'wsjtx', name: 'WSJT-X', program: 'WSJT-X', on: false, transport: 'udp', usualPort: 2237, port: 2237, network: null, allow: [],
    listening: false, bound: [], received: 0, dropped: { 'not-allowed': 0, 'too-large': 0, 'over-rate': 0, 'queue-full': 0, malformed: 0 }, heard: [], sources: []
  };
  const hearing: AdapterView = {
    ...off, on: true, listening: true, bound: ['127.0.0.1:2237', '[::1]:2237'], received: 1342,
    heard: [{ address: '127.0.0.1', at: '2026-10-29T18:42:46.000Z' }],
    sources: [{ name: 'WSJT-X - IC-7300', at: '2026-10-29T18:42:46.000Z' }]
  };
  const network: AdapterView = {
    ...hearing, network: 'eth0', allow: ['192.0.2.50'], bound: ['192.0.2.20:2237'],
    dropped: { 'not-allowed': 4, 'too-large': 0, 'over-rate': 0, 'queue-full': 0, malformed: 1 },
    heard: [{ address: '192.0.2.50', at: '2026-10-29T18:42:46.000Z' }]
  };
  const interfaces = [{ name: 'eth0', addresses: ['192.0.2.20'] }];
  const view = (adapter: AdapterView): IntegrationsView => ({ process: 'running', adapters: [adapter], interfaces });

  const { Story } = defineMeta({
    title: 'pages/IntegrationsPage',
    component: IntegrationsPage,
    args: { view: view(off), onSet: () => Promise.resolve(undefined), onSetExtension: () => Promise.resolve(true) }
  });
</script>

<Story name="Nothing listening" />
<Story name="Hearing WSJT-X" args={{ view: view(hearing) }} />
<Story name="On a network" args={{ view: view(network) }} />
<Story name="Port taken" args={{ view: view({ ...hearing, listening: false, bound: [], sources: [], heard: [],
  reason: 'Port 2237 could not be opened. Another program on this computer may be using it.' }) }} />
<Story name="Reading" args={{ view: undefined }} />
