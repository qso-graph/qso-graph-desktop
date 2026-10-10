<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!--
  The no-credential proof (QGD-APP-0014).

  It declares one grant, `source:solar`, which the register marks as needing
  nobody's permission — reading a source the frame itself registered asks
  nothing of the operator. So this works on a fresh install with nothing
  allowed, which is the half of the grant model that says yes.

  What it also proves is the rule in QGD-APP-0008: the application names a
  *source*, never a destination. The URL is in data/app-sources.json and the
  connection is the Rust credential core's, because all of this product's
  outbound HTTPS goes through it (D-18, D-31). There is no URL in this file and
  no way for it to open a socket — the renderer cannot (QGD-CRD-0007).

  Not shipped (QGD-APP-0014.1).
-->
<script lang="ts">
  import { callApp } from '../../packages/app-api/bridge.js';

  const ME = 'solar';

  interface Observed {
    month: string;
    sunspotNumber: string;
    flux: string;
  }

  let rows = $state<Observed[]>([]);
  let problem = $state('');
  let refused = $state<string | undefined>(undefined);
  let loading = $state(false);
  let fresh = $state<boolean | undefined>(undefined);

  function read(body: string): Observed[] {
    // The source's own shape, read defensively: it is somebody else's file and
    // this is a demonstration, not a parser worth trusting.
    const parsed: unknown = JSON.parse(body);
    if (!Array.isArray(parsed)) throw new Error('the source did not answer with a list');
    const observed: Observed[] = [];
    for (const entry of parsed.slice(-12)) {
      if (typeof entry !== 'object' || entry === null) continue;
      const row = entry as Record<string, unknown>;
      const month = row['time-tag'];
      if (typeof month !== 'string') continue;
      observed.push({
        month,
        sunspotNumber: typeof row.ssn === 'number' ? row.ssn.toFixed(1) : '—',
        flux: typeof row['f10.7'] === 'number' ? (row['f10.7'] as number).toFixed(1) : '—'
      });
    }
    return observed.reverse();
  }

  async function load() {
    loading = true;
    problem = '';
    refused = undefined;
    try {
      const reply = await callApp(ME, { kind: 'source.fetch', source: 'solar' });
      if (!reply.ok) {
        problem = reply.error;
        refused = reply.refused;
        return;
      }
      if (reply.kind !== 'source.fetch') { problem = 'The frame answered the wrong thing.'; return; }
      fresh = reply.fresh;
      rows = read(reply.body);
      if (rows.length === 0) problem = 'The source answered, and held nothing this page could read.';
    } catch (error) {
      problem = error instanceof Error ? error.message : 'The source could not be read.';
    } finally {
      loading = false;
    }
  }
</script>

<section class="card" aria-labelledby="solar-title">
  <h2 id="solar-title">Space weather</h2>
  <p class="hint">
    Observed solar indices, fetched through the credential core from a source
    the frame registered. This application holds one grant and no credential.
  </p>

  <button type="button" disabled={loading} onclick={load}
  >{loading ? 'Fetching…' : 'Fetch the latest indices'}</button>

  {#if problem}
    <p id="solar-problem" class="field-error" role="status">
      {problem}{#if refused}&nbsp;<span class="refused">({refused})</span>{/if}
    </p>
  {/if}

  {#if rows.length > 0}
    <p id="solar-note" class="hint">
      {rows.length} month(s), most recent first{fresh === false ? ', unchanged since the last fetch' : ''}.
    </p>
    <div class="scroller">
      <table id="solar-table">
        <thead>
          <tr><th scope="col">Month</th><th scope="col">Sunspot number</th><th scope="col">10.7&nbsp;cm flux</th></tr>
        </thead>
        <tbody>
          {#each rows as row (row.month)}
            <tr><th scope="row">{row.month}</th><td>{row.sunspotNumber}</td><td>{row.flux}</td></tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>

<style>
  .scroller { overflow-x: auto; margin-top: 12px; }
  table { border-collapse: collapse; min-width: 22rem; }
  th, td { text-align: left; padding: 4px 16px 4px 0; font-variant-numeric: tabular-nums; }
  thead th { border-bottom: 1px solid var(--rule, #d6d6d6); }
  tbody th { font-weight: 400; }
  .refused { color: var(--ink-muted); }
</style>
