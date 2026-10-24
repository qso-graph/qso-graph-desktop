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
      case 'available': return `Version ${state.version} is available. This build cannot install it itself, so download it from its page.`;
      case 'downloading': return `Downloading version ${state.version}…`;
      case 'ready': return `Version ${state.version} is ready. It installs when you restart, or the next time you quit.`;
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

  async function choose(next: UpdateTrack, control: HTMLInputElement): Promise<void> {
    failure = '';
    if (!(await onSetTrack(next))) {
      control.checked = false;
      failure = 'The setting could not be saved.';
    }
  }
</script>

<section class="card" aria-labelledby="updates-title">
  <h2 id="updates-title">Updates</h2>
  <label class="extension-switch">
    <span class="extension-text">
      <span class="extension-name">Check for updates</span>
      <span class="hint">Once a day, while online. It asks whether there is a newer version and sends nothing about you.</span>
    </span>
    <input type="checkbox" role="switch" id="update-check" checked={check}
      onchange={event => { void flip(event.currentTarget); }} />
  </label>
  <fieldset class="update-track" disabled={!check}>
    <legend class="extension-name">Which versions</legend>
    <label><input type="radio" name="update-track" id="update-track-stable" checked={track === 'stable'}
      onchange={event => { void choose('stable', event.currentTarget); }} />
      Stable <span class="hint">full releases only</span></label>
    <label><input type="radio" name="update-track" id="update-track-early" checked={track === 'early'}
      onchange={event => { void choose('early', event.currentTarget); }} />
      Early <span class="hint">pre-releases too, the newest the day it is out</span></label>
  </fieldset>
  <p class="hint" id="update-state" role="status">{words(update)}</p>
  <div class="about-links">
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
  .update-track { border: 0; margin: 12px 0 0; padding: 0; display: grid; gap: 6px; }
  .update-track label { display: flex; gap: 8px; align-items: baseline; }
</style>
