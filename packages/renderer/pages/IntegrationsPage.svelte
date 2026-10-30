<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!--
  Integrations' page (QGD-INT-0010): what is listening, always visible.

  Every adapter, on or off. For each one on: the transport, the address and
  port, the senders allowed, whether it is hearing its program and when it
  last did, and what was dropped and why. With none on, it says nothing is
  listening. Here the operator sets an adapter's port, the network it listens
  on and who may send there; turning an adapter on or off is its extension's
  switch, which this page carries too.
-->
<script lang="ts">
  import PageLayout from '../../ui/PageLayout.svelte';
  import type { AdapterView, IntegrationsView } from '../../main/integrations-page-contract.js';
  import { isAddress } from '../../extension-api/address.js';

  interface Props {
    view: IntegrationsView | undefined;
    // Saves an adapter's port, network and senders; a sentence when refused.
    onSet: (adapter: string, port: number, network: string | null, allow: string[]) => Promise<string | undefined>;
    // Turns an adapter's extension on or off (QGD-HOM-0007).
    onSetExtension: (id: string, enabled: boolean) => Promise<boolean>;
  }
  const { view, onSet, onSetExtension }: Props = $props();

  const clock = (iso: string) => `${new Date(iso).toISOString().slice(11, 19)} UTC`;
  const REASONS: Record<string, string> = {
    'not-allowed': 'from a sender not allowed',
    'too-large': 'too large',
    'over-rate': 'sent too fast',
    'queue-full': 'arrived faster than they could be passed on',
    malformed: 'not messages this adapter could read'
  };
  const dropped = (adapter: AdapterView) => Object.entries(adapter.dropped).filter(([, count]) => count > 0)
    .map(([reason, count]) => `${count} ${REASONS[reason] ?? reason}`);
  const anyOn = $derived(view?.adapters.some(adapter => adapter.on) ?? false);

  // What is typed, per adapter, until it is saved.
  let editing = $state<Record<string, { port: string; network: string; allow: string }>>({});
  let said = $state<Record<string, string>>({});
  const draft = (adapter: AdapterView) => editing[adapter.id]
    ?? { port: String(adapter.port), network: adapter.network ?? '', allow: adapter.allow.join(', ') };
  function edit(adapter: AdapterView, change: Partial<{ port: string; network: string; allow: string }>): void {
    editing = { ...editing, [adapter.id]: { ...draft(adapter), ...change } };
  }
  const senders = (text: string) => text.split(/[\s,]+/).map(entry => entry.trim()).filter(Boolean);
  function problem(adapter: AdapterView): string {
    const typed = draft(adapter);
    const port = Number(typed.port);
    if (!/^\d{4,5}$/.test(typed.port.trim()) || port < 1024 || port > 65_535) return 'A port is a number from 1024 to 65535.';
    if (typed.network !== '') {
      const list = senders(typed.allow);
      if (list.length === 0) return 'Name the computers that may send: on a network, nobody may until you do.';
      const bad = list.find(entry => !isAddress(entry));
      if (bad) return `${bad} is not an address, as 192.168.1.50.`;
      if (list.length > 16) return 'At most 16 senders.';
    }
    return '';
  }
  async function save(adapter: AdapterView): Promise<void> {
    if (problem(adapter)) return;
    const typed = draft(adapter);
    const network = typed.network === '' ? null : typed.network;
    const refused = await onSet(adapter.id, Number(typed.port), network, network === null ? [] : [...new Set(senders(typed.allow))]);
    said = { ...said, [adapter.id]: refused ?? 'Saved.' };
    if (!refused) { const { [adapter.id]: _, ...rest } = editing; editing = rest; }
  }
  const where = (address: string) => address === '127.0.0.1' || address === '::1' ? 'this computer' : address;
</script>

<PageLayout eyebrow="THE PROGRAMS YOUR STATION RUNS" title="Integrations" hue="general">
  {#if !view}
    <p class="hint">Reading what is listening…</p>
  {:else}
    <section class="card" aria-labelledby="integrations-now">
      <h2 id="integrations-now">Listening now</h2>
      {#if !anyOn}
        <p id="integrations-nothing">Nothing is listening. QSO Graph Desktop opens a port only for an adapter you turn on, and closes it when you turn it off.</p>
      {:else}
        <p>Only the adapters that are on listen, each on its own port. What arrives is shown, and changes nothing you keep.</p>
      {/if}
      {#if view.process === 'restarting'}
        <p class="field-error" role="status">Integrations stopped and is starting again.</p>
      {/if}
    </section>

    {#each view.adapters as adapter (adapter.id)}
      {@const typed = draft(adapter)}
      <section class="card integration" id="integration-{adapter.id}" aria-labelledby="integration-{adapter.id}-title">
        <h2 id="integration-{adapter.id}-title">{adapter.name}</h2>
        <!-- The extension's own switch, as Settings draws it (QGD-HOM-0007). -->
        <label class="extension-switch">
          <span class="extension-text">
            <span class="extension-name">On</span>
            <span class="hint">Receives what {adapter.program} sends over UDP. Its usual port is {adapter.usualPort}.</span>
          </span>
          <input type="checkbox" role="switch" id="integration-{adapter.id}-on" checked={adapter.on}
            onchange={event => void onSetExtension(adapter.id, event.currentTarget.checked)} />
        </label>

        {#if adapter.on}
          <dl class="integration-state">
            <dt>Listening</dt>
            <dd id="integration-{adapter.id}-listening">
              {#if adapter.listening}UDP on {adapter.bound.join(' and ')}{:else}Not listening. {adapter.reason ?? ''}{/if}
            </dd>
            <dt>May send</dt>
            <dd>{adapter.network === null ? 'This computer only' : adapter.allow.length > 0 ? adapter.allow.join(', ') : 'Nobody yet'}</dd>
            <dt>Hearing</dt>
            <dd id="integration-{adapter.id}-hearing">
              {#if adapter.sources.length > 0}
                {adapter.sources.map(source => `${source.name}, last at ${clock(source.at)}`).join('; ')}
              {:else if adapter.heard.length > 0}
                Heard from {adapter.heard.map(entry => where(entry.address)).join(', ')}, last at {clock(adapter.heard[0].at)}
              {:else}
                Not heard yet. In {adapter.program}, set the UDP server to this computer's address and port {adapter.port}.
              {/if}
            </dd>
            {#if dropped(adapter).length > 0}
              <dt>Dropped</dt>
              <dd id="integration-{adapter.id}-dropped">{dropped(adapter).join('; ')}</dd>
            {/if}
          </dl>
        {/if}

        <form class="integration-settings" onsubmit={event => { event.preventDefault(); void save(adapter); }}>
          <label>
            Port
            <input id="integration-{adapter.id}-port" inputmode="numeric" maxlength="5" value={typed.port}
              oninput={event => edit(adapter, { port: event.currentTarget.value })} />
          </label>
          <label>
            Listen on
            <select id="integration-{adapter.id}-network" value={typed.network}
              onchange={event => edit(adapter, { network: event.currentTarget.value })}>
              <option value="">This computer only</option>
              {#each view.interfaces as entry (entry.name)}
                <option value={entry.name}>{entry.name} ({entry.addresses.join(', ')})</option>
              {/each}
            </select>
          </label>
          {#if typed.network !== ''}
            <label>
              Computers that may send
              <input id="integration-{adapter.id}-allow" value={typed.allow} placeholder="192.0.2.50"
                oninput={event => edit(adapter, { allow: event.currentTarget.value })} />
            </label>
            <p class="hint" id="integration-{adapter.id}-firewall">
              The first time it listens on a network, your computer's firewall may ask whether QSO Graph Desktop may receive
              there. It asks because {adapter.program} on another computer has to reach this one; anything from a computer not
              named here is dropped unread.
            </p>
          {/if}
          {#if problem(adapter)}<p class="field-error" id="integration-{adapter.id}-problem">{problem(adapter)}</p>{/if}
          <button type="submit" id="integration-{adapter.id}-save" disabled={problem(adapter) !== ''}>Save</button>
          {#if said[adapter.id]}<p role="status" id="integration-{adapter.id}-said">{said[adapter.id]}</p>{/if}
        </form>
      </section>
    {:else}
      <p class="hint">No adapter is installed.</p>
    {/each}
  {/if}
</PageLayout>

<style>
  .integration-state { display: grid; grid-template-columns: max-content 1fr; gap: 0.25rem 1rem; margin: 0.75rem 0; }
  .integration-state dt { font-weight: 600; }
  .integration-state dd { margin: 0; }
  .integration-settings { display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: end; }
  .integration-settings label { display: flex; flex-direction: column; gap: 0.25rem; }
  .integration-settings .hint, .integration-settings .field-error, .integration-settings [role='status'] { flex-basis: 100%; margin: 0; }
</style>
