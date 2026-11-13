<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  Focus Area, on Parks On the Air's Settings tab (POTA's
  alone, so in POTA's area; it was a card on Locations): the parts of POTA the
  operator works in, chosen before anything is fetched for them, at POTA's
  own three levels: Program, Entity and Location. Built from POTA's lists
  already downloaded; starts from the active Location's own; at most ten
  (settings-contract.ts MAX_AREA).
-->
<script lang="ts">
  import { createAreaWork, type AreaWork } from '../area-work.js';
  import type { PageWork } from '../page-work.js';
  import AreaPicker from '../../ui/AreaPicker.svelte';
  import { labelOf, type PickNode } from '../../ui/tree-pick.js';
  import type { AreaProgram } from '../../storage/area-entry.js';

  interface Props {
    // What is saved: the operator's choice, or empty for the Location's own.
    work?: AreaWork;
    registerWork?: (work: PageWork) => () => void;
    area: readonly string[];
    most: number;
    parksLoaded: boolean;
    loadChoices: () => Promise<readonly AreaProgram[] | string>;
    loadDefault: () => Promise<string | undefined>;
    onSave: (area: readonly string[]) => Promise<boolean>;
    onDownloadParks?: () => void;
  }
  const { work: externalWork, registerWork, area, most, parksLoaded, loadChoices, loadDefault, onSave, onDownloadParks }: Props = $props();

  let nodes = $state<readonly PickNode[]>([]);
  let problem = $state('');
  let own = $state<string | undefined>(undefined);
  const ownWork = $state(createAreaWork(area => onSave(area)));
  const draft = $derived(externalWork ?? ownWork);
  const chosen = $derived(draft.chosen ?? []);
  let saved = $state('');

  // Unset until the first load: '' is the saved area when it is the
  // Location's own, and starting from '' skipped that first load (#57, found
  // in review: the picker showed no choices).
  let loadedFor: string | undefined;

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
      if (!draft.dirty) draft.chosen = area.length > 0 ? area : own ? [own] : [];
    })();
  });

  async function save(): Promise<boolean> {
    const confirmed = await draft.save();
    saved = confirmed ? 'Saved.' : 'The focus area could not be saved.';
    return confirmed;
  }
  $effect(() => registerWork?.({
    isDirty: () => draft.isDirty(), save,
    discard() { draft.discard(); draft.chosen = area.length > 0 ? area : own ? [own] : []; saved = ''; }
  }));

</script>

<section class="extension-setting" aria-labelledby="area-title" id="my-area">
  <!-- Named for what it is for, which "My Area" did not say; "Focus Area"
       under Parks On the Air. -->
  <h3 id="area-title">Focus Area</h3>
  <p class="hint">
    The part of POTA you activate and chase in: a whole program, an entity, or locations, as
    POTA's own park list narrows them. Parks On the Air's Most Wanted fetches activation counts
    for these alone, and Spots offers them as "My focus area". Left as it is, it is your
    Location's own entity.
  </p>
  {#if !parksLoaded}
    <p class="hint">It is chosen from POTA's lists. Download POTA Parks first.</p>
    {#if onDownloadParks}<button type="button" class="secondary" onclick={onDownloadParks}>Download POTA Parks</button>{/if}
  {:else if problem}
    <p class="field-error" role="status">{problem}</p>
  {:else}
    <AreaPicker {nodes} {chosen} {most} searchLabel="Find a program, entity or location" onChange={next => { draft.choose(next); saved = ''; }} />
    <div class="form-footer">
      {#if own}<button type="button" class="secondary" id="area-own" onclick={() => { draft.choose([own!]); saved = ''; }}>Just my Location's ({labelOf(nodes, own) ?? own})</button>{/if}
      <button type="button" id="area-save" onclick={save}>Save focus area</button>
    </div>
    {#if saved}<p class="hint" role="status" id="area-saved">{saved}</p>{/if}
  {/if}
</section>
