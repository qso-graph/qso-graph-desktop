<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!--
  The surface exerciser (QGD-APP-0014): an application that declared no grants
  at all, which tries every capability the API has and shows what came back.

  It is the clearest view of the grant model there is, because an application
  holding nothing is refused everything except knowing its own standing
  (QGD-APP-0005) — and each refusal names the application and the capability,
  in the words the frame chose (QGD-APP-0011).

  Not shipped (QGD-APP-0014.1).
-->
<script lang="ts">
  import { callApp, type AppInfo, type AppRequest } from '../../packages/app-api/bridge.js';

  const ME = 'harness';

  interface Attempt {
    label: string;
    request: AppRequest;
    outcome?: 'allowed' | 'refused' | 'failed';
    detail?: string;
    refused?: string;
  }

  let info = $state<AppInfo | undefined>(undefined);
  let infoProblem = $state('');
  let attempts = $state<Attempt[]>([
    { label: 'Know my own standing', request: { kind: 'app.info' } },
    { label: 'List the personas', request: { kind: 'persona.list' } },
    { label: 'Fetch the space-weather source', request: { kind: 'source.fetch', source: 'solar' } },
    {
      label: 'Look a callsign up with the QRZ credential',
      request: { kind: 'service.request', service: 'qrz', persona: 'nobody', operation: 'lookup', parameters: { callsign: 'W1AW' } }
    },
    { label: 'Fetch a source nobody registered', request: { kind: 'source.fetch', source: 'invented' } }
  ]);
  let running = $state(false);

  async function readStanding() {
    const reply = await callApp(ME, { kind: 'app.info' });
    if (reply.ok && reply.kind === 'app.info') { info = reply.info; infoProblem = ''; }
    else if (!reply.ok) { infoProblem = reply.error; }
  }

  async function tryEverything() {
    running = true;
    try {
      for (const attempt of attempts) {
        const reply = await callApp(ME, attempt.request);
        if (reply.ok) {
          attempt.outcome = 'allowed';
          attempt.detail = describe(reply);
          attempt.refused = undefined;
        } else {
          // A refusal carries the capability when a grant was the reason, and
          // nothing when the request itself was the problem.
          attempt.outcome = reply.refused ? 'refused' : 'failed';
          attempt.detail = reply.error;
          attempt.refused = reply.refused;
        }
      }
      attempts = [...attempts];
    } finally {
      running = false;
    }
  }

  function describe(reply: Extract<Awaited<ReturnType<typeof callApp>>, { ok: true }>): string {
    switch (reply.kind) {
      case 'app.info': return `${reply.info.name}, holding ${reply.info.grants.length} grant(s)`;
      case 'persona.list': return `${reply.personas.length} persona(s)`;
      case 'source.fetch': return `${reply.body.length} characters, ${reply.fresh ? 'fresh' : 'unchanged'}`;
      case 'service.request': return Object.keys(reply.answer).length + ' field(s)';
    }
  }

  void readStanding();
</script>

<section class="card" aria-labelledby="harness-title">
  <h2 id="harness-title">App API harness</h2>
  <p class="hint">
    An application that declared no grants. It asks for everything the API
    offers, so the grant model can be seen refusing as well as allowing.
  </p>

  {#if info}
    <p id="harness-standing">
      <strong>{info.name}</strong> — {info.tier}, version {info.version},
      holding {info.grants.length === 0 ? 'no grants' : info.grants.join(', ')}.
    </p>
  {:else if infoProblem}
    <p class="field-error" role="status">{infoProblem}</p>
  {/if}

  <button type="button" disabled={running} onclick={tryEverything}
  >{running ? 'Asking…' : 'Try every capability'}</button>

  <ul id="harness-attempts" class="attempts">
    {#each attempts as attempt (attempt.label)}
      <li>
        <span class="what">{attempt.label}</span>
        {#if attempt.outcome === 'allowed'}
          <span class="verdict allowed">allowed</span>
          <span class="detail">{attempt.detail}</span>
        {:else if attempt.outcome === 'refused'}
          <span class="verdict refused">refused</span>
          <span class="detail">{attempt.detail}</span>
        {:else if attempt.outcome === 'failed'}
          <span class="verdict failed">not available</span>
          <span class="detail">{attempt.detail}</span>
        {:else}
          <span class="verdict pending">not asked yet</span>
        {/if}
      </li>
    {/each}
  </ul>
</section>

<style>
  .attempts { list-style: none; padding: 0; margin: 16px 0 0; display: flex; flex-direction: column; gap: 10px; }
  .attempts li { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 12px; align-items: baseline; }
  .what { font-weight: 600; }
  .verdict { font-size: 0.85rem; padding: 1px 8px; border-radius: 10px; white-space: nowrap; }
  .allowed { background: var(--ok-bg, #dff3e3); color: var(--ok-ink, #1d6b32); }
  .refused { background: var(--warn-bg, #fdecec); color: var(--warn-ink, #8c2b2b); }
  .failed, .pending { background: var(--surface-2, #ececec); color: var(--ink-muted); }
  .detail { grid-column: 1 / -1; color: var(--ink-muted); font-size: 0.9rem; }
</style>
