<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!--
  The granted proof (QGD-APP-0014).

  It declares `service:qrz` and `persona:list`, both of which the register marks
  as needing the operator's permission. So on a fresh install it is refused,
  and it says so with the capability named (QGD-APP-0011). Allow the grants and
  it works; withdraw them and the same call is refused again with no restart
  (QGD-APP-0012). That is the whole demonstration.

  **The secret never arrives here.** The application names a persona, a service
  and an operation; the frame acts with the stored credential and returns the
  answer (QGD-APP-0007). There is no field on this page that could hold a
  password, and the renderer could not reach the Keychain if there were
  (QGD-CRD-0007).

  **What is shown and what is kept** (QGD-PII-0007). QRZ's answer carries a
  street address, an email address and sometimes a telephone number, and
  showing those for a lookup the operator asked for is QRZ being the source,
  the same as reading them on QRZ's own site — so every field is displayed.
  What the rule governs is keeping and passing on: nothing here is written to a
  log, a file, the database or an export, and this page keeps no copy once it
  is left.

  Not shipped (QGD-APP-0014.1).
-->
<script lang="ts">
  import { callApp, type PersonaBrief } from '../../packages/app-api/bridge.js';

  const ME = 'qrz-lookup';

  let personas = $state<PersonaBrief[]>([]);
  let persona = $state('');
  let callsign = $state('');
  let fields = $state<{ name: string; value: string }[]>([]);
  let outcome = $state('');
  let problem = $state('');
  let refused = $state<string | undefined>(undefined);
  let working = $state(false);

  // The one grant this page needs before it can offer anything: without the
  // persona list it cannot ask which identity to act as.
  // Answers whether it worked, so a caller can stop rather than carry on with
  // a message it is about to overwrite.
  async function loadPersonas(): Promise<boolean> {
    const reply = await callApp(ME, { kind: 'persona.list' });
    if (!reply.ok) { problem = reply.error; refused = reply.refused; return false; }
    if (reply.kind !== 'persona.list') return false;
    personas = [...reply.personas];
    problem = '';
    refused = undefined;
    // The selection is reconciled against what came back, not left alone: a
    // persona that has been removed would otherwise stay selected and every
    // later lookup would name an identity that no longer exists.
    if (!personas.some(entry => entry.name === persona)) {
      persona = personas.length > 0 ? personas[0].name : '';
    }
    return true;
  }

  const ready = $derived(callsign.trim() !== '');

  async function look() {
    working = true;
    // Asked again on every lookup, not only when the list is empty.
    //
    // Shell keeps every page mounted, so this component is constructed once
    // and never again. Reloading only when empty still left a populated list
    // frozen: a persona added afterwards never appeared, and one removed
    // stayed selected. So the list is refreshed here and offered as an action
    // below, whether or not it already holds something.
    fields = [];
    outcome = '';
    try {
      // Cleared before asking, not after: an earlier version refreshed the
      // list, then blanked `problem` on the next line — so a refusal of
      // persona:list was replaced by "there is no persona to act as yet",
      // which told the operator the wrong thing to do about it. Found in
      // review.
      problem = '';
      refused = undefined;
      // Whose credential this action was going to use, captured before the
      // list is refreshed.
      //
      // loadPersonas reconciles the selection, which is right for drawing the
      // list and wrong in the middle of an action: if the chosen persona had
      // been deleted, the refresh quietly selected another one and the lookup
      // went ahead with *that* operator's QRZ credential. Nobody asked for
      // that. Found in review.
      const chosen = persona;
      if (!await loadPersonas()) return;
      if (chosen !== '' && !personas.some(entry => entry.name === chosen)) {
        problem = `The persona you chose, ${chosen}, is no longer there. Choose another.`;
        return;
      }
      // Put back what was chosen, in case the refresh moved it.
      if (chosen !== '') persona = chosen;
      if (persona === '') {
        problem = 'There is no persona to act as yet.';
        return;
      }
      const reply = await callApp(ME, {
        kind: 'service.request',
        service: 'qrz',
        persona,
        operation: 'lookup',
        parameters: { callsign: callsign.trim().toUpperCase() }
      });
      if (!reply.ok) { problem = reply.error; refused = reply.refused; return; }
      if (reply.kind !== 'service.request') { problem = 'The frame answered the wrong thing.'; return; }
      const answer = { ...reply.answer };
      outcome = answer.outcome ?? '';
      delete answer.outcome;
      // Shown in the order the service sent them, which is QRZ's order.
      fields = Object.entries(answer).map(([name, value]) => ({ name, value }));
      if (outcome !== 'success') {
        problem = explain(outcome);
      }
    } finally {
      working = false;
    }
  }

  // The core answers with a fixed word. Each is turned into a sentence an
  // operator can act on, and none of them blames them for a thing they did not
  // do (QGD-PSN-0013).
  function explain(word: string): string {
    switch (word) {
      case 'not-found': return 'QRZ has no record for that callsign.';
      case 'rejected': return 'QRZ refused the stored credential. Check it in Personas.';
      case 'missing': return 'No QRZ credential is saved for that persona.';
      case 'rate-limited': return 'QRZ is rate-limiting this account. Try again shortly.';
      case 'network-error': return 'QRZ could not be reached.';
      case 'invalid-request': return 'That is not a callsign this product will send.';
      case 'invalid-response': return 'QRZ answered something this product could not read.';
      case 'unsupported': return 'That operation is not one this product performs.';
      default: return 'The lookup did not succeed.';
    }
  }

  void loadPersonas();
</script>

<section class="card" aria-labelledby="lookup-title">
  <h2 id="lookup-title">Callsign lookup</h2>
  <p class="hint">
    Looks a callsign up with the QRZ credential saved against a persona. The
    credential stays in the credential core; this page is handed the answer.
  </p>

  {#if personas.length === 0}
    <p id="lookup-no-personas" class="hint">
      No personas are available to this application yet.
      {#if refused}It has not been allowed to see them.{/if}
    </p>
  {:else}
    <label for="lookup-persona">Act as</label>
    <select id="lookup-persona" bind:value={persona}>
      {#each personas as entry (entry.name)}
        <option value={entry.name}>{entry.callsign} · {entry.name}</option>
      {/each}
    </select>
  {/if}
  <!-- Always reachable, not only when the list is empty. -->
  <button type="button" id="lookup-refresh" onclick={loadPersonas}>Ask for the personas again</button>

  <label for="lookup-callsign">Callsign</label>
  <input id="lookup-callsign" type="text" autocapitalize="characters" bind:value={callsign} />

  <button type="button" class:working disabled={!ready || working} onclick={look}
  >{working ? 'Looking up…' : 'Look up'}</button>

  {#if problem}
    <p id="lookup-problem" class="field-error" role="status">
      {problem}{#if refused}&nbsp;<span class="refused">({refused})</span>{/if}
    </p>
  {/if}

  {#if fields.length > 0}
    <p id="lookup-outcome" class="hint">{fields.length} field(s), as QRZ sent them.</p>
    <dl id="lookup-fields">
      {#each fields as field (field.name)}
        <dt>{field.name}</dt><dd>{field.value}</dd>
      {/each}
    </dl>
  {/if}
</section>

<style>
  label { display: block; margin-top: 12px; }
  dl { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 4px 16px; margin: 12px 0 0; }
  dt { font-weight: 600; }
  dd { margin: 0; overflow-wrap: anywhere; }
  .refused { color: var(--ink-muted); }
</style>
