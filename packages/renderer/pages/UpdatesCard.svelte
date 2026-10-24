<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!--
  Updates, in Settings (QGD-FRM-0019, KI7MT 2026-10-23: "an easy update is a
  must"). The switch, on by default because asking is going online and
  Privacy names it; the track, Stable for hams who want it to just work and
  Early for those who want the newest; and what the last check found.
  Nothing restarts from here without the operator pressing Restart.
-->
<script lang="ts">
  import type { UpdateTrack } from '../../main/settings-contract.js';
  import type { UpdateState } from '../../main/update-contract.js';

  interface Props {
    // Undefined until the main process has answered.
    update?: UpdateState;
    check: boolean;
    track: UpdateTrack;
    onSetCheck?: (on: boolean) => Promise<boolean>;
    onSetTrack?: (track: UpdateTrack) => Promise<boolean>;
    onCheckNow?: () => void;
    onRestart?: () => void;
    onOpenRelease?: () => void;
  }
  const {
    update, check, track,
    onSetCheck = () => Promise.resolve(false), onSetTrack = () => Promise.resolve(false),
    onCheckNow = () => {}, onRestart = () => {}, onOpenRelease = () => {}
  }: Props = $props();

  let failure = $state('');

  function at(time: number): string {
    const when = new Date(time);
    const two = (value: number) => String(value).padStart(2, '0');
    return `${two(when.getUTCHours())}:${two(when.getUTCMinutes())} UTC`;
  }

  function words(state: UpdateState | undefined): string {
    if (state === undefined) return 'Reading…';
    switch (state.kind) {
      case 'off': return check ? 'This build does not check for updates.' : 'Not checking for updates.';
      case 'idle': return 'Will check shortly.';
      case 'checking': return 'Checking…';
      case 'current': return `Up to date. Checked at ${at(state.checkedAt)}.`;
      case 'available': return `Version ${state.version} is available: What's new has its page.`;
      case 'downloading': return `Downloading version ${state.version}…`;
      case 'ready': return `Version ${state.version} is ready. It installs on restart, or when you quit.`;
      case 'failed': return `The last check did not finish: ${state.reason}`;
    }
  }

  async function flip(control: HTMLInputElement): Promise<void> {
    failure = '';
    if (!(await onSetCheck(control.checked))) {
      control.checked = check;
      failure = 'The setting could not be saved.';
    }
  }

  async function choose(control: HTMLSelectElement): Promise<void> {
    failure = '';
    const next: UpdateTrack = control.value === 'early' ? 'early' : 'stable';
    if (!(await onSetTrack(next))) {
      control.value = track;
      failure = 'The setting could not be saved.';
    }
  }
</script>

<!-- Two lines (KI7MT, 2026-10-24: it was bigger than Reference data for
     what it does): the switch, then the track, what the last check found and
     what can be done about it. The detail is in the guide. -->
<section class="card" aria-labelledby="updates-title">
  <h2 id="updates-title">Updates</h2>
  <label class="extension-switch update-row">
    <span class="extension-name" title="Once a day, while online. It asks whether there is a newer version and sends nothing about you.">Check for updates</span>
    <input type="checkbox" role="switch" id="update-check" checked={check}
      onchange={event => { void flip(event.currentTarget); }} />
  </label>
  <div class="update-row">
    <label class="update-track">Versions
      <select id="update-track" disabled={!check} value={track}
        title="Stable: full releases only. Early: pre-releases too, the newest the day it is out."
        onchange={event => { void choose(event.currentTarget); }}>
        <option value="stable">Stable</option>
        <option value="early">Early</option>
      </select>
    </label>
    <span class="hint update-state" id="update-state" role="status">{words(update)}</span>
    {#if update?.kind === 'ready'}
      <button type="button" id="update-restart" onclick={onRestart}>Restart to update</button>
    {/if}
    {#if update?.kind === 'available' || update?.kind === 'ready'}
      <button type="button" class="secondary" id="update-release" onclick={onOpenRelease}>What's new</button>
    {/if}
    <button type="button" class="secondary" id="update-check-now" disabled={!check || update?.kind === 'checking' || update?.kind === 'downloading' || update?.kind === 'off'}
      onclick={onCheckNow}>Check now</button>
  </div>
  {#if failure}<p class="extension-error" role="alert">{failure}</p>{/if}
</section>

<style>
  .update-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-top: 8px; }
  .update-track { display: flex; align-items: center; gap: 8px; margin: 0; }
  .update-track select { width: auto; }
  .update-state { flex: 1; min-width: 12em; }
</style>
