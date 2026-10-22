<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!--
  Guided setup (QGD-PSN-0004).

  It asks for a callsign and nothing else. Every service after that is
  optional, can be skipped, and can be come back to — because a setup that
  cannot be left half-done is a setup an operator abandons, and this one is in
  front of somebody who has just installed the thing.

  Nothing is held in limbo. The persona is created the moment it is named, and
  each credential is saved the moment it is entered, so leaving the flow and
  returning loses nothing: what is on screen is a position in a list, not
  unsaved work. That is what makes "can be returned to" true rather than
  something to implement.

  The steps after the first are drawn from the service register (QGD-PSN-0002)
  — the fields, the labels, the instructions and whether there is a test all
  come from it, so a service added to the register appears here with no change
  to this file.
-->
<script lang="ts">
  import { caseAsTyped } from '../../ui/typed-case.js';
  import { untrack } from 'svelte';
  import Field, { type ControlAttributes } from '../../ui/Field.svelte';
  import type { ServiceSummary } from '../../personas/persona-contract.js';

  interface Props {
    services: ServiceSummary[];
    // The persona this setup is for, once it exists. Present when returning
    // to a setup that already made one.
    persona?: string;
    onCreatePersona: (callsign: string, name: string) => Promise<string | undefined>;
    onSaveCredential: (
      service: string, values: Record<string, string>
    ) => Promise<string | undefined>;
    onDone: () => void;
  }
  const { services, persona, onCreatePersona, onSaveCredential, onDone }: Props = $props();

  // Where we are: 0 is the callsign, 1..services.length are the services, and
  // one past the end is the summary. Starting past the callsign when the
  // persona already exists is what returning to a half-done setup looks like.
  //
  // untrack, because reading a prop to decide where to start is not a
  // reactive read and Svelte is right to ask: a later change to `persona`
  // must not move the operator to another step while they are typing.
  let step = $state(untrack(() => (persona ? 1 : 0)));
  let callsign = $state('');
  let name = $state('');
  let working = $state(false);
  let problem = $state('');
  // What each service step has been given, and what came of it.
  const entered = $state<Record<string, Record<string, string>>>({});
  const saved = $state<Record<string, boolean>>({});
  const skipped = $state<Record<string, boolean>>({});

  const service = $derived(step >= 1 && step <= services.length ? services[step - 1] : undefined);
  const callsignProblem = $derived(callsign.trim() === '' ? 'A callsign is all this needs to start.' : '');

  function valueOf(id: string, field: string): string {
    return entered[id]?.[field] ?? '';
  }
  function setValue(id: string, field: string, value: string) {
    entered[id] = { ...(entered[id] ?? {}), [field]: value };
  }
  // Enough to save: every required field has something in it.
  function ready(summary: ServiceSummary): boolean {
    return summary.fields.filter(field => field.required)
      .every(field => valueOf(summary.id, field.name).trim() !== '');
  }

  async function createPersona() {
    working = true;
    problem = '';
    try {
      const failed = await onCreatePersona(callsign.trim(), name.trim());
      if (failed) problem = failed;
      else step = 1;
    } finally {
      working = false;
    }
  }

  async function saveService(summary: ServiceSummary) {
    working = true;
    problem = '';
    try {
      const failed = await onSaveCredential(summary.id, entered[summary.id] ?? {});
      if (failed) { problem = failed; return; }
      saved[summary.id] = true;
      step += 1;
    } finally {
      working = false;
    }
  }

  function skip(summary: ServiceSummary) {
    skipped[summary.id] = true;
    problem = '';
    step += 1;
  }

  const savedCount = $derived(Object.values(saved).filter(Boolean).length);
  const skippedCount = $derived(Object.values(skipped).filter(Boolean).length);
</script>

{#snippet callsignControl({ describedBy, invalid }: ControlAttributes)}
  <input id="setup-callsign" type="text" autocapitalize="characters" use:caseAsTyped={'upper'} bind:value={callsign}
    aria-describedby={describedBy} aria-invalid={invalid} />
{/snippet}

{#snippet nameControl({ describedBy, invalid }: ControlAttributes)}
  <input id="setup-name" type="text" bind:value={name}
    aria-describedby={describedBy} aria-invalid={invalid} />
{/snippet}

<section class="card" aria-labelledby="setup-title">
  <h2 id="setup-title">Set up QSO Graph Desktop</h2>

  {#if step === 0}
    <p class="hint">
      Start with the callsign you operate under. Everything else can wait, and
      you can come back to this at any time.
    </p>
    <Field id="setup-callsign" label="Callsign" error={callsignProblem} control={callsignControl} />
    <Field
      id="setup-name"
      label="A name for it"
      optional
      hint="So you can tell two callsigns apart — &ldquo;Personal&rdquo;, &ldquo;Club&rdquo;. The callsign is used if you leave this empty."
      control={nameControl}
    />
    <button type="button" class:working disabled={callsignProblem !== '' || working} onclick={createPersona}
    >{working ? 'Creating…' : 'Add this callsign'}</button>

  {:else if service}
    <p class="hint" id="setup-progress">
      Step {step} of {services.length}: {service.name}. You can skip any of these.
    </p>
    <h3>{service.name}</h3>
    <p>{service.what}</p>
    <p class="hint">{service.howToGet}</p>
    {#if 'none' in service.test}
      <p class="hint">{service.test.none}</p>
    {/if}

    {#each service.fields as field (field.name)}
      <label for="setup-{service.id}-{field.name}">
        {field.label}{#if !field.required}<span class="optional"> optional</span>{/if}
      </label>
      <input
        id="setup-{service.id}-{field.name}"
        type={field.secret ? 'password' : 'text'}
        autocomplete="off"
        value={valueOf(service.id, field.name)}
        oninput={(event) => setValue(service.id, field.name, (event.currentTarget as HTMLInputElement).value)}
      />
    {/each}

    <div class="actions">
      <button
        type="button"
        class:working
        disabled={!ready(service) || working}
        onclick={() => saveService(service)}
      >{working ? 'Saving…' : 'Save and continue'}</button>
      <button type="button" disabled={working} onclick={() => skip(service)}>Skip for now</button>
    </div>
    {#if !ready(service)}
      <p class="hint">Fill in what this service needs, or skip it.</p>
    {/if}

  {:else}
    <p id="setup-done">
      {callsign || persona} is ready.
      {savedCount === 0
        ? 'No credentials were saved — you can add them from Callsigns whenever you like.'
        : `${savedCount} credential${savedCount === 1 ? '' : 's'} saved.`}
      {skippedCount > 0
        ? `${skippedCount} service${skippedCount === 1 ? '' : 's'} skipped; they are waiting for you in Callsigns.`
        : ''}
    </p>
    <button type="button" onclick={onDone}>Finish</button>
  {/if}

  {#if problem}<p class="field-error" role="status">{problem}</p>{/if}
</section>

<style>
  h3 { margin: 16px 0 4px; }
  .actions { display: flex; gap: 8px; margin-top: 12px; }
  label { display: block; margin-top: 12px; }
  .optional { color: var(--ink-muted); font-weight: 400; }
</style>
