<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!--
  Where the proof applications are shown (QGD-APP-0014).

  It lives here rather than in `renderer` because it exists only for them: a
  release has no proofs, so it has no host either. P8's first real application
  needs a host of its own and that is P8's to design — building one now for
  applications that do not exist would be guessing at their shape.

  **It mounts only what the frame loaded.** QGD-APP-0001 says the frame can
  refuse an application before any of its code is loaded, and the first version
  of this host broke that: it imported and mounted all three unconditionally,
  so a manifest with an unofficial tier, an undeclared grant or no manifest at
  all still had its component instantiated and its initialisation run. The
  broker refused every call afterwards, which is not the same thing. Found in
  review.

  The static imports stay — they are what lets Rollup drop the three components
  from a release bundle (QGD-APP-0014.1) — but nothing is instantiated until
  the inventory says the frame accepted it. What was refused is shown as
  refused, with the reason, which is the demonstration doing its job.

  Not shipped (QGD-APP-0014.1).
-->
<script lang="ts">
  import HarnessPage from './harness/HarnessPage.svelte';
  import LookupPage from './qrz-lookup/LookupPage.svelte';
  import SolarPage from './solar/SolarPage.svelte';

  // Read off the window through a local shape, like the app bridge does: this
  // host may depend on `app-api` and `ui` only (QGD-REP-0006), and the
  // inventory channel is the frame's rather than an application's.
  interface Loaded {
    readonly id: string;
    readonly name: string;
  }
  interface Inventory {
    readonly apps: readonly Loaded[];
    readonly refused: readonly { readonly source: string; readonly reason: string }[];
  }
  interface AppsBridge {
    inventory(command: { type: 'inventory' }): Promise<{ ok: boolean; inventory?: Inventory; error?: string }>;
  }

  let loaded = $state<string[]>([]);
  let refused = $state<{ source: string; reason: string }[]>([]);
  let asked = $state(false);
  let problem = $state('');

  async function readInventory() {
    const bridge = (globalThis as { apps?: AppsBridge }).apps;
    if (!bridge) { problem = 'The app API is not available in this window.'; asked = true; return; }

    try {
      const reply = await bridge.inventory({ type: 'inventory' });
      if (!reply.ok || !reply.inventory) {
        problem = reply.error ?? 'The frame could not say what loaded.';
        return;
      }
      loaded = reply.inventory.apps.map(app => app.id);
      refused = [...reply.inventory.refused];
      problem = '';
    } catch {
      // The channel is absent, which is what a broker that failed to start
      // looks like from here. Said rather than left waiting. Found in review.
      problem = 'The frame could not say which applications loaded.';
    } finally {
      asked = true;
    }
  }

  void readInventory();
</script>

<div class="proofs" id="app-proofs">
  <p class="warning" role="note">
    These applications exist to demonstrate the app API and its grants. They are
    absent from a packaged build.
  </p>

  {#if !asked}
    <p class="hint" id="app-proofs-reading">Asking the frame which applications loaded…</p>
  {:else}
    {#if problem}<p class="field-error" role="status" id="app-proofs-problem">{problem}</p>{/if}

    <!--
      One branch per application, each gated on the frame having accepted its
      manifest. A refused application is not instantiated at all.
    -->
    {#if loaded.includes('harness')}<HarnessPage />{/if}
    {#if loaded.includes('solar')}<SolarPage />{/if}
    {#if loaded.includes('qrz-lookup')}<LookupPage />{/if}

    {#if refused.length > 0}
      <section class="card" aria-labelledby="app-proofs-refused-title">
        <h2 id="app-proofs-refused-title">Not loaded</h2>
        <p class="hint">
          The frame refused these before any of their code ran (QGD-APP-0001).
        </p>
        <ul id="app-proofs-refused">
          {#each refused as entry (entry.source)}
            <li><code>{entry.source}</code> — {entry.reason}</li>
          {/each}
        </ul>
      </section>
    {/if}
  {/if}
</div>

<style>
  .proofs { display: flex; flex-direction: column; gap: 20px; padding: 24px 36px; overflow-y: auto; }
  .warning {
    margin: 0; padding: 10px 14px; border-radius: 6px;
    background: var(--warn-bg, #fdecec); color: var(--warn-ink, #8c2b2b);
  }
  ul { margin: 8px 0 0; padding-left: 20px; display: flex; flex-direction: column; gap: 6px; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.9rem; }
</style>
