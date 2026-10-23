<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!--
  The Callsign screen signed off at P1, moved into a component without a change
  to its markup: the same ids, labels, roles and order. app.ts still owns its
  behaviour and finds its elements by id, so P3-personas-intact is a question
  about this file being a faithful copy rather than about a rewrite being
  correct. The packaged smoke suite drives it by role and label and is the
  check that it is.

  Its own markup carries no logic. When the shell grows past P3 this is the
  component that gets rewritten in Svelte properly, with its own state; doing
  that here would have put the P1 workflow and the framework on trial at once.

  It gained one child on 2026-10-10: moving a station's callsigns to another
  machine, which was a section of Settings. It is something you do *to the
  callsigns*, so it belongs with them — Bitwarden's desktop client keeps vault
  export under the application's own menu rather than in preferences. It is
  inside this page's scrolling column rather than a sibling of it: placed
  alongside, its card covered the callsign list and intercepted every click on
  it, which is the same lesson the setup offer taught at P6.
-->
<script lang="ts">
  import { caseAsTyped } from '../../ui/typed-case.js';
  // The only props are the three the move card needs, passed straight through.
  // app.ts still owns everything else on this screen and finds its elements by
  // id, by design.
  import MoveCallsignsPage from './MoveCallsignsPage.svelte';
  import type { ExportResult, ImportPreview, ImportResult } from '../../callsigns/callsign-contract.js';
  import { credentialStoreTitle, findInStore, forStore } from '../../callsigns/credential-store.js';
  // The store this platform has; the preload says which. A gallery story has
  // no preload, and shows macOS.
  const platform = (globalThis as { callsigns?: { platform?: string } }).callsigns?.platform ?? 'darwin';

  interface Props {
    onExportCallsigns: (passphrase: string) => Promise<ExportResult | string>;
    onInspectImport: (passphrase: string) => Promise<ImportPreview | string>;
    onApplyImport: (passphrase: string, replace: boolean) => Promise<ImportResult | string>;
  }
  const { onExportCallsigns, onInspectImport, onApplyImport }: Props = $props();
</script>

<aside aria-label="Callsigns">
  <div class="sidebar-title"><h2>Callsigns</h2><button id="new-callsign" type="button">+ New</button></div>
  <div id="callsign-list"></div>
  <p class="sidebar-note">Your own call, a club call, or a special-event call. Each has its own logins.</p>
</aside>
<div class="page-main">
  <div class="page-title"><div><p class="eyebrow" data-hue="callsigns">YOUR CALLSIGNS</p><h1 id="page-title">Add a callsign</h1></div><button id="use-callsign" class="secondary" type="button" hidden>Use this callsign</button></div>
  <p id="message" role="status" aria-live="polite"></p>
  <section class="card" aria-labelledby="identity-title">
    <h2 id="identity-title">Callsign details</h2>
    <form id="callsign-form">
      <div class="fields"><label>Description<input id="callsign-description" name="name" maxlength="64" placeholder="Optional: Home, Portable" autocomplete="off"></label><label>Callsign<input id="callsign" name="callsign" required maxlength="64" placeholder="Your callsign" autocomplete="off" use:caseAsTyped={'upper'}></label></div>
      <div class="fields"><label>Start date<input id="start-date" type="date" name="start" required></label><label><span>End date <span class="optional">optional</span></span><input id="end-date" type="date" name="end"></label></div>
      <p class="hint">The dates say when this callsign is in use.</p>
      <div class="form-footer"><button id="remove-callsign" class="danger" type="button" hidden>Remove callsign</button><button id="save-callsign" type="submit">Add callsign</button></div>
    </form>
  </section>
  <section id="credential-card" class="card" aria-labelledby="credentials-title" hidden>
    <div class="section-title"><h2 id="credentials-title">Service credentials</h2><span class="badge">{credentialStoreTitle(platform)}</span></div>
    <label for="provider">Service</label><select id="provider"><option value="qrz">QRZ lookup</option><option value="qrz_logbook">QRZ logbook</option><option value="eqsl">eQSL</option><option value="lotw">LoTW website</option><option value="hamqth">HamQTH</option><option value="clublog">Club Log</option></select>
    <p id="credential-status" class="credential-status" role="status">Checking saved credentials…</p>
    <!-- This callsign's id, which names its entries in the credential store
         (QGD-CRD-0003), so the operator can find them there (KI7MT,
         2026-10-22). Selectable rather than copied by a button: the window is
         granted no clipboard permission, and Edit → Copy needs none. -->
    <p class="hint keychain-id">{forStore('Keychain ID', platform)}: <code id="keychain-id"></code><br>
      {findInStore(platform)}</p>
    <div class="credential-test"><button id="test-credential" class="secondary" type="button" disabled>Test credential</button><p id="credential-test-result" role="status">Not tested yet.</p></div>
    <form id="credential-form" autocomplete="off">
      <label>Username<input id="username" name="username" maxlength="4096" required autocomplete="off"></label>
      <div class="fields">
        <div><label>Password<input id="password" type="password" name="password" maxlength="4096" autocomplete="new-password" aria-describedby="password-saved"></label><p id="password-saved" class="saved-indicator" hidden>{forStore('Password saved in Keychain', platform)}</p><button id="remove-password" class="danger field-remove" type="button" hidden>Remove password</button></div>
        <div><label>API key<input id="api-key" type="password" name="apiKey" maxlength="4096" autocomplete="new-password" aria-describedby="api-key-saved"></label><p id="api-key-saved" class="saved-indicator" hidden>{forStore('API key saved in Keychain', platform)}</p><button id="remove-api-key" class="danger field-remove" type="button" hidden>Remove API key</button></div>
      </div>
      <label for="credential-preference">Preferred credential</label><select id="credential-preference" disabled><option value="service">Service default</option><option value="password">Password</option><option value="api_key">API key</option></select>
      <p id="credential-effective" class="hint"></p>
      <p class="hint">Saving updates the fields you enter. Blank password and API key fields keep their saved values. Use Remove to delete one. Saved secrets are never displayed.</p>
      <div class="form-footer"><button id="remove-credential" class="danger" type="button" hidden>Remove saved credential</button><button id="save-credential" type="submit">{forStore('Save in Keychain', platform)}</button></div>
    </form>
  </section>
  <MoveCallsignsPage onExport={onExportCallsigns} onInspect={onInspectImport} onImport={onApplyImport} />
</div>
