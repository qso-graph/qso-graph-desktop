<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!--
  My Area, on the Locations page (KI7MT, 2026-10-23): the parts of POTA the
  operator works in, chosen before anything is fetched for them, at POTA's
  own three levels: Program, Entity and Location. Built from POTA's lists
  already downloaded; starts from the active Location's own; at most ten
  (settings-contract.ts MAX_AREA).
-->
<script lang="ts">
  import AreaPicker from '../../ui/AreaPicker.svelte';
  import { labelOf, type PickNode } from '../../ui/tree-pick.js';
  import type { AreaProgram } from '../../storage/area-entry.js';

  interface Props {
    // What is saved: the operator's choice, or empty for the Location's own.
    area: readonly string[];
    most: number;
    parksLoaded: boolean;
    loadChoices: () => Promise<readonly AreaProgram[] | string>;
    loadDefault: () => Promise<string | undefined>;
    onSave: (area: readonly string[]) => Promise<boolean>;
    onDownloadParks?: () => void;
  }
  const { area, most, parksLoaded, loadChoices, loadDefault, onSave, onDownloadParks }: Props = $props();

  let nodes = $state<readonly PickNode[]>([]);
  let problem = $state('');
  let own = $state<string | undefined>(undefined);
  let chosen = $state<readonly string[]>([]);
  let saved = $state('');
  let loadedFor = '';

  $effect(() => {
    if (!parksLoaded) return;
    const key = area.join(',');
    if (key === loadedFor) return;
    loadedFor = key;
    void (async () => {
      const choices = await loadChoices();
      if (typeof choices === 'string') { problem = choices; return; }
      problem = '';
      // The entity level only where a program has more than one, as the
      // United States (CONUS, Alaska, Hawaii …) and Great Britain do.
      const locationsOf = (entity: AreaProgram['entities'][number]) => entity.locations.map(location => ({ id: location.code, label: location.name }));
      nodes = choices.map(program => ({
        id: program.prefix, label: program.name,
        children: program.entities.length === 1 ? locationsOf(program.entities[0]!)
          : program.entities.map(entity => ({ id: entity.id, label: entity.name, children: locationsOf(entity) }))
      }));
      own = await loadDefault();
      chosen = area.length > 0 ? area : own ? [own] : [];
    })();
  });

  async function save(): Promise<void> {
    saved = (await onSave(chosen)) ? 'Saved.' : 'My Area could not be saved.';
  }
</script>

<section class="card" aria-labelledby="area-title" id="my-area">
  <h2 id="area-title">My Area</h2>
  <p class="hint">
    The parts of POTA you work in: a whole program, an entity, or locations, as POTA's own park
    list narrows them. Only these are fetched for, so nothing outside your area is downloaded,
    and pages that show parks start with them.
  </p>
  {#if !parksLoaded}
    <p class="hint">My Area is chosen from POTA's lists. Download POTA Parks first.</p>
    {#if onDownloadParks}<button type="button" class="secondary" onclick={onDownloadParks}>Download POTA Parks</button>{/if}
  {:else if problem}
    <p class="field-error" role="status">{problem}</p>
  {:else}
    <AreaPicker {nodes} {chosen} {most} searchLabel="Find a program, entity or location" onChange={next => { chosen = next; saved = ''; }} />
    <div class="form-footer">
      {#if own}<button type="button" class="secondary" id="area-own" onclick={() => { chosen = [own!]; saved = ''; }}>Just my Location's ({labelOf(nodes, own) ?? own})</button>{/if}
      <button type="button" id="area-save" onclick={save}>Save My Area</button>
    </div>
    {#if saved}<p class="hint" role="status" id="area-saved">{saved}</p>{/if}
  {/if}
</section>
