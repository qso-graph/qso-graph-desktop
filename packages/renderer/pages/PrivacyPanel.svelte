<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!--
  Privacy and Licences, reached from Help and from Settings' About
  (QGD-FRM-0015, KI7MT 2026-10-22). What stays on this computer, when the
  application goes online, what can leave and only when the operator
  chooses, the licence, and who the data is from. It replaces the status
  bar's one-line claim, which no longer fit: Home's cards go online too.
  What it says about going online is what connection-capture measures.
-->
<script lang="ts">
  import { CREDITS } from '../../ui/credits.js';

  interface Props {
    version: string;
    onClose: () => void;
  }
  const { version, onClose }: Props = $props();

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') onClose();
  }
</script>

<svelte:window onkeydown={onKeydown} />

<section id="privacy" class="panel" aria-labelledby="privacy-title">
  <header>
    <h2 id="privacy-title">Privacy and Licences</h2>
    <button type="button" id="close-privacy" onclick={onClose}>Close</button>
  </header>

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

  <h3>Licence</h3>
  <p id="privacy-licence">
    QSO Graph Desktop {version} is free software under the GNU General Public License, version 3.
    It comes with no warranty.
  </p>

  <h3>Data and credits</h3>
  <ul class="credits" id="privacy-credits">
    {#each CREDITS as credit (credit.key)}
      <li><strong>{credit.from}</strong>: {credit.what} {credit.terms}</li>
    {/each}
  </ul>
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
  .credits { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 6px; }
</style>
