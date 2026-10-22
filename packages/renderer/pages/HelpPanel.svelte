<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!--
  Help's three plain-word windows (QGD-FRM-0015, KI7MT 2026-10-22), one
  component chosen by `topic`:
  - Privacy: what stays on this computer, when the application goes online,
    and what can leave and only when the operator chooses. It replaced the
    status bar's one-line claim, which Home's cards had made untrue; what it
    says about going online is what connection-capture measures.
  - Attributions: the licence, and who every source of data is from.
  - Contributors: who built it, with thanks.
-->
<script lang="ts">
  import { CREDITS } from '../../ui/credits.js';
  import { CONTRIBUTORS } from '../../ui/contributors.js';

  type HelpTopic = 'privacy' | 'attributions' | 'contributors';
  interface Props {
    topic: HelpTopic;
    version: string;
    onClose: () => void;
  }
  const { topic, version, onClose }: Props = $props();
  const TITLES: Record<HelpTopic, string> = { privacy: 'Privacy', attributions: 'Attributions', contributors: 'Contributors' };

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') onClose();
  }
</script>

<svelte:window onkeydown={onKeydown} />

<section id="help-panel" class="panel" aria-labelledby="help-title" data-topic={topic}>
  <header>
    <h2 id="help-title">{TITLES[topic]}</h2>
    <button type="button" id="close-help" onclick={onClose}>Close</button>
  </header>

  {#if topic === 'privacy'}
    <h3>What stays on this computer</h3>
    <p id="privacy-local">
      Your callsigns, locations, settings and logs. Your logins are kept in this computer's own
      credential store (Keychain, Credential Manager or the keyring), not in this application's files.
    </p>

    <h3>When it goes online</h3>
    <p id="privacy-online">
      Only when you test a login, when you download or update reference data, and for the cards you
      pin on Home, such as Conditions from NOAA. Nothing about you is sent with them. There is no
      analytics, no tracking and no account.
    </p>

    <h3>What can leave, only when you choose</h3>
    <p id="privacy-leaves">
      An export of your callsigns, which is encrypted, and a support bundle of logs, with passwords and
      keys removed. Both are saved where you choose and sent nowhere.
    </p>
  {:else if topic === 'attributions'}
    <h3>Licence</h3>
    <p id="attributions-licence">
      QSO Graph Desktop {version} is free software under the GNU General Public License, version 3.
      It comes with no warranty.
    </p>

    <h3>Data and credits</h3>
    <ul class="list" id="attributions-credits">
      {#each CREDITS as credit (credit.key)}
        <li><strong>{credit.from}</strong>: {credit.what} {credit.terms}</li>
      {/each}
    </ul>
  {:else}
    <p>QSO Graph Desktop is built by these people and tools. Thank you.</p>
    <ul class="list" id="contributors-list">
      {#each CONTRIBUTORS as contributor (contributor.name)}
        <li><strong>{contributor.name}</strong>: {contributor.role}</li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .panel {
    position: absolute;
    /* Placed as Troubleshooting is: clear of the rail and the status bar,
       not modal. */
    inset: auto 16px 44px 108px;
    max-height: 70vh;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 20px 24px;
    border: 1px solid var(--border-strong);
    border-radius: 10px;
    background: var(--page);
    box-shadow: 0 10px 40px rgb(0 0 0 / 0.25);
    z-index: 20;
  }
  @media (max-width: 850px) { .panel { inset: auto 12px 44px 88px; } }
  header { display: flex; align-items: center; justify-content: space-between; }
  header h2, h3, p { margin: 0; }
  h3 { margin-top: 6px; font-size: 14px; }
  .list { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 6px; }
</style>
