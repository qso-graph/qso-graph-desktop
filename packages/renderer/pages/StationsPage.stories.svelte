<!-- SPDX-License-Identifier: GPL-3.0-only -->
<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import StationsPage from './StationsPage.svelte';
  import type { StationsView } from '../../storage/station-contract.js';

  const HOME = '0b6f4a2e-1c3d-4e5f-8a9b-0c1d2e3f4a5b';
  const PARK = '1c7a5b3f-2d4e-4f60-9b0c-1d2e3f4a5b6c';
  const view: StationsView = {
    list: [
      { id: HOME, name: 'Home', kind: 'Home', place: { MY_GRIDSQUARE: 'DN13sm', MY_DXCC: '291', MY_STATE: 'ID', MY_CNTY: 'ID,Ada' } },
      { id: PARK, name: 'US-0001 Example Park', kind: 'Portable', place: { MY_GRIDSQUARE: 'DN13sp', MY_POTA_REF: 'US-0001', MY_STATE: 'ID' } }
    ],
    defaults: { 'Home station': HOME },
    active: HOME,
    checked: true
  };

  const { Story } = defineMeta({
    title: 'pages/StationsPage',
    component: StationsPage,
    args: {
      stations: view,
      personaName: 'Home station',
      personaLabel: 'W1AW · Home station',
      parksLoaded: true,
      onSave: () => Promise.resolve(undefined),
      onDelete: () => Promise.resolve(undefined),
      onSetActive: () => Promise.resolve(undefined),
      onFromPark: () => Promise.resolve('Not in a story.')
    }
  });
</script>

<Story name="Default" />
<Story name="No stations" args={{ stations: { list: [], defaults: {}, active: null, checked: true } }} />
<Story name="Reading" args={{ stations: undefined }} />
<Story name="Definitions not downloaded" args={{ stations: { ...view, checked: false }, parksLoaded: false }} />
<Story name="No persona" args={{ personaName: '', personaLabel: '' }} />
