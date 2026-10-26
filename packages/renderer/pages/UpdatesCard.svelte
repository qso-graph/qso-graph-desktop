<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!--
  Updates, in Settings (QGD-FRM-0019, KI7MT 2026-10-23: "an easy update is a
  must"). The switch, on by default because asking is going online and
  Privacy names it; the track, Stable for hams who want it to just work and
  Early for those who want the newest; and what the last check found.
  Nothing restarts from here without the operator pressing Restart.

  Choose a version… (#77, QGD-FRM-0020): what the feed lists, forward as
  the track allows and back to Stable releases only (KI7MT, 2026-10-26).
  Going back says first what is lost, in a confirmation.
-->
<script lang="ts">
  import type { UpdateTrack } from '../../main/settings-contract.js';
  import type { UpdateState, VersionChoice } from '../../main/update-contract.js';
  import ConfirmDialog from '../../ui/ConfirmDialog.svelte';

  interface Props {
    // Undefined until the main process has answered.
    update?: UpdateState;
    check: boolean;
    track: UpdateTrack;
    onSetCheck?: (on: boolean) => Promise<boolean>;
    onSetTrack?: (track: UpdateTrack) => Promise<boolean>;
    onCheckNow?: () => void;
    onInstall?: () => void;
    onRestart?: () => void;
    onOpenRelease?: () => void;
    onListVersions?: () => Promise<VersionChoice[]>;
    onInstallVersion?: (version: string) => void;
  }
  const {
    update, check, track,
    onSetCheck = () => Promise.resolve(false), onSetTrack = () => Promise.resolve(false),
    onCheckNow = () => {}, onInstall = () => {}, onRestart = () => {}, onOpenRelease = () => {},
    onListVersions = () => Promise.resolve([]), onInstallVersion = () => {}
  }: Props = $props();

  // The list, read when it is opened; undefined while closed.
  let choices: VersionChoice[] | undefined = $state();
  let goingBack: VersionChoice | undefined = $state();
  const busy = $derived(update?.kind === 'checking' || update?.kind === 'downloading');

  async function toggleVersions(): Promise<void> {
    if (choices) { choices = undefined; return; }
    choices = await onListVersions();
  }

  function pick(choice: VersionChoice): void {
    if (choice.way === 'back') { goingBack = choice; return; }
    onInstallVersion(choice.version);
  }

  const TRACK_NAME = { stable: 'Stable', early: 'Early', preview: 'Preview' } as const;

  function backMessage(choice: VersionChoice): string {
    return choice.snapshot
      ? `This goes back to version ${choice.version}, and puts back your callsigns, Locations and settings as they were when you left it. Changes made since then are lost. Your logins are not touched.`
      : `This goes back to version ${choice.version}. No copy of your data from that version is kept on this computer, so it will open today's data, and may not read all of it. Today's data is kept first, so updating again puts it back.`;
  }

  let failure = $state('');

  function at(time: number): string {
    const when = new Date(time);
    const two = (value: number) => String(value).padStart(2, '0');
    return `${two(when.getUTCHours())}:${two(when.getUTCMinutes())} UTC`;
  }

  function words(state: UpdateState | undefined): string {
    if (state === undefined) return 'Reading…';
    switch (state.kind) {
      case 'off':
        if (state.why === 'development') return 'This is a development build, which does not check for updates.';
        if (state.why === 'preview') return 'This Preview does not check for updates. Install a release to get them.';
        // A Store copy keeps its data in the Store's private place, which
        // Windows deletes on uninstall (Microsoft's MSIX rules).
        if (state.why === 'store') return 'Updates come from the Microsoft Store. Uninstalling this copy also deletes your callsigns, Locations and settings, so back them up first (Back up and restore, below).';
        return 'Not checking for updates.';
      case 'idle': return 'Will check shortly.';
      case 'checking': return 'Checking…';
      case 'current': return `Up to date. Checked at ${at(state.checkedAt)}.`;
      case 'available': return state.installable
        ? `Version ${state.version} is available.`
        : `Version ${state.version} is available: What's new has its page.`;
      case 'downloading': return `Downloading version ${state.version}…`;
      case 'ready': return state.back
        ? `Version ${state.version} is ready. It goes back on restart, or when you quit.`
        : `Version ${state.version} is ready. It installs on restart, or when you quit.`;
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
    const next: UpdateTrack = control.value === 'early' ? 'early' : control.value === 'preview' ? 'preview' : 'stable';
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
        title="Stable: full releases only. Early: pre-releases too, the newest the day it is out. Previews: last night's build too. Early and Previews carry no guarantee."
        onchange={event => { void choose(event.currentTarget); }}>
        <option value="stable">Stable</option>
        <option value="early">Early</option>
        <option value="preview">Previews</option>
      </select>
    </label>
    <span class="hint update-state" id="update-state" role="status">{words(update)}</span>
    {#if update?.kind === 'available' && update.installable}
      <button type="button" id="update-install" onclick={onInstall}>Download and install</button>
    {/if}
    {#if update?.kind === 'ready'}
      <button type="button" id="update-restart" onclick={onRestart}>{update.back ? 'Restart to go back' : 'Restart to update'}</button>
    {/if}
    {#if update?.kind === 'available' || update?.kind === 'ready'}
      <button type="button" class="secondary" id="update-release" onclick={onOpenRelease}>What's new</button>
    {/if}
    <button type="button" class="secondary" id="update-check-now" disabled={!check || update?.kind === 'checking' || update?.kind === 'downloading' || update?.kind === 'off'}
      onclick={onCheckNow}>Check now</button>
    <button type="button" class="secondary" id="update-versions" aria-expanded={choices !== undefined}
      disabled={!check || update?.kind === 'off'} onclick={() => { void toggleVersions(); }}>Choose a version…</button>
  </div>
  {#if choices}
    {#if choices.length === 0}
      <p class="hint" id="update-versions-empty">No list yet: Check now fills it.</p>
    {:else}
      <ul class="update-versions" id="update-versions-list">
        {#each choices as choice (choice.version)}
          <li>
            <span class="update-version">v{choice.version}</span>
            <span class="hint">{choice.date.slice(0, 10)} · {TRACK_NAME[choice.track]}{choice.track === 'stable' ? '' : ', no guarantee'}</span>
            {#if choice.way === 'running'}
              <span class="hint update-running">Running</span>
            {:else}
              <button type="button" class="secondary" disabled={busy} onclick={() => pick(choice)}>
                {choice.way === 'back' ? 'Go back' : 'Install'}
              </button>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
  <ConfirmDialog open={goingBack !== undefined} title={`Go back to version ${goingBack?.version ?? ''}?`}
    message={goingBack ? backMessage(goingBack) : ''} confirmLabel="Go back" destructive
    onConfirm={() => { if (goingBack) onInstallVersion(goingBack.version); goingBack = undefined; choices = undefined; }}
    onCancel={() => { goingBack = undefined; }} />
  {#if failure}<p class="extension-error" role="alert">{failure}</p>{/if}
</section>

<style>
  .update-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-top: 8px; }
  .update-track { display: flex; align-items: center; gap: 8px; margin: 0; }
  .update-track select { width: auto; }
  .update-state { flex: 1; min-width: 12em; }
  .update-versions { list-style: none; margin: 8px 0 0; padding: 0; }
  .update-versions li { display: flex; align-items: center; gap: 12px; padding: 4px 0; }
  .update-version { min-width: 6em; font-variant-numeric: tabular-nums; }
  .update-versions .hint { flex: 1; }
  .update-running { flex: 0 0 auto; }
</style>
