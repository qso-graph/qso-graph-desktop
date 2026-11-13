<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import DestinationTabs from './DestinationTabs.svelte';

  const tabs = [
    { id: 'home', label: 'Home', icon: 'home' },
    { id: 'callsigns', label: 'Callsigns', icon: 'callsigns' },
    { id: 'extension/parks', label: 'Parks On the Air', icon: 'extension' }
  ];
  const { Story } = defineMeta({
    title: 'ui/DestinationTabs',
    component: DestinationTabs,
    args: {
      tabs, current: 'callsigns', onShow: () => {}, onClose: () => {},
      onCloseOthers: () => {}, onCloseAll: () => {}, onReorder: () => {}
    }
  });
</script>

<!-- The gallery's theme decorator renders each state in light and dark. -->
<Story name="Three destinations" />
<Story name="Home alone" args={{ tabs: tabs.slice(0, 1), current: 'home' }} />
<Story name="Area shown" args={{ current: 'extension/parks' }} />
<Story name="Same label, distinct destinations" args={{
  tabs: [{ id: 'extension/one', label: 'Reference' }, { id: 'extension/two', label: 'Reference' }],
  current: 'extension/two'
}} />
