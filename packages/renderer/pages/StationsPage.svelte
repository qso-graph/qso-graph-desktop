<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!--
  Stations (QGD-STN-*): where the operator is operating from, beside the
  persona that says who they are, as TQSL keeps station locations beside the
  callsign certificate.

  A station is a name, a kind (a label: Home, Portable, Mobile, Remote) and
  ADIF's own MY_* fields. Every field is optional but the name. What a value
  may be is ADIF's to say: QG Storage checks it against the definitions and
  the reason it gives is shown beside the field, never rewritten here.

  This page holds no station state of its own. The list arrives in QG
  Storage's pushed status; what it keeps is only the form being edited.
-->
<script lang="ts">
  import PageLayout from '../../ui/PageLayout.svelte';
  import ConfirmDialog from '../../ui/ConfirmDialog.svelte';
  import {
    STATION_KINDS, isLotwPark, type FieldProblem, type ParkDraft, type Place, type Station, type StationDraft, type StationField,
    type StationKind, type StationsView
  } from '../../storage/station-contract.js';

  interface Props {
    stations?: StationsView;
    // The active persona's name and how it is shown, or empty when there is none.
    personaName: string;
    personaLabel: string;
    // Whether POTA's parks are downloaded, so "from a park" can be offered.
    parksLoaded: boolean;
    onSave: (draft: StationDraft, makeDefault: boolean) => Promise<{ error: string; problems?: FieldProblem[] } | undefined>;
    onDelete: (id: string) => Promise<string | undefined>;
    onSetActive: (id: string | null) => Promise<string | undefined>;
    onFromPark: (reference: string) => Promise<ParkDraft | string>;
  }
  const {
    stations, personaName, personaLabel, parksLoaded, onSave, onDelete, onSetActive, onFromPark
  }: Props = $props();

  // The fields, grouped as the operator thinks of them, each with the words
  // that say what ADIF wants. The order inside a group is TQSL's.
  interface FieldInfo { field: StationField; label: string; hint?: string }
  const GROUPS: { title: string; hint?: string; fields: FieldInfo[] }[] = [
    {
      title: 'Where it is',
      fields: [
        { field: 'MY_GRIDSQUARE', label: 'Grid square', hint: '2, 4, 6 or 8 characters, as DN13 or DN13sm.' },
        { field: 'MY_VUCC_GRIDS', label: 'Grids, on a line or corner', hint: 'Two or four grids, as DN13,DN14.' },
        { field: 'MY_DXCC', label: 'DXCC entity code', hint: 'ADIF\'s number for the entity: 291 is the United States.' },
        { field: 'MY_STATE', label: 'State, province or prefecture', hint: 'ADIF\'s code for it in the entity above, as ID.' },
        { field: 'MY_CNTY', label: 'County', hint: 'ADIF\'s form for the entity, as ID,Ada.' },
        { field: 'MY_CQ_ZONE', label: 'CQ zone', hint: '1 to 40.' },
        { field: 'MY_ITU_ZONE', label: 'ITU zone', hint: '1 to 90.' },
        { field: 'MY_ARRL_SECT', label: 'ARRL section' },
        { field: 'MY_LAT', label: 'Latitude', hint: 'ADIF\'s form: N043 37.500.' },
        { field: 'MY_LON', label: 'Longitude', hint: 'ADIF\'s form: W116 12.500.' },
        { field: 'MY_ALTITUDE', label: 'Altitude', hint: 'Metres above sea level.' },
        { field: 'MY_GRIDSQUARE_EXT', label: 'Grid square extension', hint: 'The 9th and 10th characters of a 10-character locator.' }
      ]
    },
    {
      title: 'Activity',
      fields: [
        { field: 'MY_POTA_REF', label: 'POTA park', hint: 'As US-0001; more than one, separated by commas.' },
        { field: 'MY_SOTA_REF', label: 'SOTA summit', hint: 'As W7I/SI-001.' },
        { field: 'MY_WWFF_REF', label: 'WWFF reference', hint: 'As KFF-0001.' },
        { field: 'MY_IOTA', label: 'IOTA', hint: 'As NA-001.' }
      ]
    },
    {
      title: 'Address',
      hint: 'Optional, and it stays on this computer. Mobile or off grid there may be none.',
      fields: [
        { field: 'MY_STREET', label: 'Street' },
        { field: 'MY_CITY', label: 'City' },
        { field: 'MY_POSTAL_CODE', label: 'Postal code' }
      ]
    }
  ];

  // ---- the form being edited -------------------------------------------
  let editing = $state(false);
  let editingId = $state<string | undefined>();
  let name = $state('');
  let kind = $state<StationKind | ''>('');
  let lotwPark = $state('');
  let place = $state<Record<string, string>>({});
  let makeDefault = $state(false);
  let problems = $state<FieldProblem[]>([]);
  let formError = $state('');
  let note = $state('');
  let working = $state(false);

  let parkReference = $state('');
  let parkError = $state('');
  let pageError = $state('');
  let deleting = $state<Station | undefined>();

  const list = $derived(stations?.list ?? []);
  const active = $derived(stations?.active ?? null);
  const defaultId = $derived(personaName ? stations?.defaults[personaName] : undefined);
  const problemOf = (field: string) => problems.find(problem => problem.field === field)?.reason;
  const labelOf = (field: string) => field === 'name' ? 'Name' : field === 'lotwPark' ? 'LoTW park'
    : GROUPS.flatMap(group => group.fields).find(info => info.field === field)?.label ?? field;

  function open(draft?: StationDraft, withNote = '') {
    editing = true;
    editingId = draft?.id;
    name = draft?.name ?? '';
    kind = draft?.kind ?? '';
    lotwPark = draft?.lotwPark ?? '';
    place = { ...(draft?.place ?? {}) };
    makeDefault = draft?.id !== undefined && draft.id === defaultId;
    problems = [];
    formError = '';
    note = withNote;
  }

  function close() {
    editing = false;
    problems = [];
    formError = '';
    note = '';
  }

  function draftOf(): StationDraft {
    const filled: Place = {};
    // Sent as typed. A value with a stray space is ADIF's to refuse, not this
    // page's to tidy into one it accepts (QGD-STN-0002); only a field left
    // empty, or holding nothing but spaces, is left out.
    for (const [field, value] of Object.entries(place)) {
      if (value.trim()) filled[field as StationField] = value;
    }
    return {
      ...(editingId ? { id: editingId } : {}),
      name: name.trim(),
      ...(kind ? { kind } : {}),
      place: filled,
      ...(lotwPark.trim() ? { lotwPark: lotwPark.trim().toUpperCase() } : {})
    };
  }

  async function save() {
    // Two things are this product's own rather than ADIF's, so they are
    // checked here before the request is sent: a request off its shape is
    // refused whole at the boundary, and would say less (QGD-SEC-0006).
    const own: FieldProblem[] = [];
    if (name.trim() === '') own.push({ field: 'name', reason: 'A station needs a name.' });
    if (lotwPark.trim() && !isLotwPark(lotwPark.trim().toUpperCase())) {
      own.push({ field: 'lotwPark', reason: 'TQSL\'s park codes are two letters and two digits, as NP33, separated by commas.' });
    }
    if (own.length) { problems = own; formError = ''; return; }
    working = true;
    try {
      const refused = await onSave(draftOf(), makeDefault);
      if (refused) {
        problems = refused.problems ?? [];
        // Said again beside the button, by field, because the field itself
        // may be scrolled out of sight.
        formError = problems.length
          ? `${refused.error} ${problems.map(problem => `${labelOf(problem.field)}: ${problem.reason}.`).join(' ')}`
          : refused.error;
        return;
      }
      close();
    } finally {
      working = false;
    }
  }

  async function fromPark() {
    parkError = '';
    const answer = await onFromPark(parkReference.trim().toUpperCase());
    if (typeof answer === 'string') { parkError = answer; return; }
    parkReference = '';
    open(answer.draft, answer.note ?? '');
  }

  async function act(work: Promise<string | undefined>) {
    pageError = '';
    const failed = await work;
    if (failed) pageError = failed;
  }

  // One line saying where it is: what an operator reads to tell two apart.
  function summary(station: Station): string {
    const parts = [
      station.place.MY_GRIDSQUARE, station.place.MY_STATE, station.place.MY_POTA_REF, station.place.MY_SOTA_REF
    ].filter(Boolean);
    return parts.length ? parts.join(' · ') : 'No place given yet';
  }
</script>

<PageLayout eyebrow="WHERE YOU OPERATE" title="Stations">
  <section class="card" aria-labelledby="stations-title">
    <div class="section-title">
      <h2 id="stations-title">Your stations</h2>
      {#if !editing}<button type="button" id="add-station" onclick={() => open()}>Add a station</button>{/if}
    </div>
    {#if stations === undefined}
      <p class="hint">Reading the stations…</p>
    {:else if list.length === 0}
      <p class="hint" id="no-stations">
        No stations yet. Add one for each place you operate from: home, a park, a summit, the car.
      </p>
    {:else}
      <ul class="extension-list station-list">
        {#each list as station (station.id)}
          <li class="extension-row station-row" data-station={station.name}>
            <span class="extension-text">
              <span class="extension-name">
                {station.name}
                {#if station.kind}<span class="station-kind">{station.kind}</span>{/if}
                {#if station.id === active}<span class="badge">Active</span>{/if}
                {#if station.id === defaultId}<span class="station-kind">Default for {personaLabel}</span>{/if}
              </span>
              <span class="hint">{summary(station)}</span>
            </span>
            <span class="station-actions">
              {#if station.id !== active}
                <button type="button" class="secondary" aria-label="Make {station.name} active"
                  onclick={() => act(onSetActive(station.id))}>Make active</button>
              {/if}
              <button type="button" class="secondary" aria-label="Edit {station.name}"
                onclick={() => open(station)}>Edit</button>
              <button type="button" class="secondary" aria-label="Delete {station.name}"
                onclick={() => { deleting = station; }}>Delete</button>
            </span>
          </li>
        {/each}
      </ul>
      {#if active === null}<p class="hint" id="no-active-station">No station is active.</p>{/if}
    {/if}
    {#if pageError}<p class="extension-error" role="alert">{pageError}</p>{/if}
    {#if stations && !stations.checked}
      <p class="hint" id="stations-unchecked">
        ADIF's definitions are not downloaded, so station values cannot be checked yet. Download them in Settings.
      </p>
    {/if}
  </section>

  {#if !editing}
    <section class="card" aria-labelledby="from-park-title">
      <h2 id="from-park-title">A station from a POTA park</h2>
      {#if parksLoaded}
        <label for="park-reference">Park reference</label>
        <div class="inline-form">
          <input id="park-reference" type="text" autocapitalize="characters" placeholder="US-0001"
            bind:value={parkReference} aria-describedby={parkError ? 'park-reference-error' : undefined}
            aria-invalid={parkError ? true : undefined} />
          <button type="button" class="secondary" id="from-park" disabled={parkReference.trim() === ''}
            onclick={fromPark}>Fill in from the park</button>
        </div>
        {#if parkError}<p id="park-reference-error" class="field-error" role="status">{parkError}</p>{/if}
        <p class="hint">The park's grid, position and state come from POTA's park list. You can change any of it before saving.</p>
      {:else}
        <p class="hint" id="parks-not-downloaded">POTA parks are not downloaded. Download them in Settings to start a station from a park.</p>
      {/if}
    </section>
  {:else}
    <section class="card station-editor" aria-labelledby="station-editor-title">
      <h2 id="station-editor-title">{editingId ? `Edit ${name || 'station'}` : 'New station'}</h2>
      {#if note}<p class="hint" id="station-note" role="status">{note}</p>{/if}
      <p class="hint">Every field is optional except the name. What a value may be is ADIF's to say, and it is checked when you save.</p>

      <label for="station-name">Name</label>
      <input id="station-name" type="text" maxlength="64" bind:value={name}
        aria-describedby={problemOf('name') ? 'station-name-error' : 'station-name-hint'}
        aria-invalid={problemOf('name') ? true : undefined} />
      <p id="station-name-hint" class="hint">How you tell it apart: Home, Field Day site, the car.</p>
      {#if problemOf('name')}<p id="station-name-error" class="field-error" role="status">{problemOf('name')}</p>{/if}

      <label for="station-kind">Kind</label>
      <select id="station-kind" bind:value={kind} aria-describedby="station-kind-hint">
        <option value="">No label</option>
        {#each STATION_KINDS as option (option)}<option value={option}>{option}</option>{/each}
      </select>
      <p id="station-kind-hint" class="hint">A label for you. It changes nothing else.</p>

      {#each GROUPS as group (group.title)}
        <h3>{group.title}</h3>
        {#if group.hint}<p class="hint">{group.hint}</p>{/if}
        <div class="fields">
          {#each group.fields as info (info.field)}
            {@const id = `station-${info.field.toLowerCase().replaceAll('_', '-')}`}
            {@const error = problemOf(info.field)}
            <div>
              <label for={id}>{info.label}</label>
              <input {id} type="text" maxlength="100" autocomplete="off"
                value={place[info.field] ?? ''}
                oninput={(event) => { place[info.field] = (event.currentTarget as HTMLInputElement).value; }}
                aria-describedby={[info.hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined}
                aria-invalid={error ? true : undefined} />
              {#if info.hint}<p id="{id}-hint" class="hint">{info.hint}</p>{/if}
              {#if error}<p id="{id}-error" class="field-error" role="status">{error}</p>{/if}
            </div>
          {/each}
          {#if group.title === 'Activity'}
            <div>
              <label for="station-lotw-park">LoTW park</label>
              <input id="station-lotw-park" type="text" maxlength="40" bind:value={lotwPark}
                aria-describedby={problemOf('lotwPark') ? 'station-lotw-park-hint station-lotw-park-error' : 'station-lotw-park-hint'}
                aria-invalid={problemOf('lotwPark') ? true : undefined} />
              <p id="station-lotw-park-hint" class="hint">TQSL's Park, as NP33: a US national park unit. ADIF has no field for it.</p>
              {#if problemOf('lotwPark')}<p id="station-lotw-park-error" class="field-error" role="status">{problemOf('lotwPark')}</p>{/if}
            </div>
          {/if}
        </div>
      {/each}

      {#if personaName}
        <label class="checkbox-row">
          <input id="station-default" type="checkbox" bind:checked={makeDefault} />
          The default station for {personaLabel}
        </label>
      {/if}

      {#if formError}<p class="extension-error" role="alert" id="station-form-error">{formError}</p>{/if}
      <div class="form-footer">
        <button type="button" class="secondary" onclick={close}>Cancel</button>
        <button type="button" id="save-station" disabled={working} onclick={save}>{working ? 'Saving…' : 'Save station'}</button>
      </div>
    </section>
  {/if}
</PageLayout>

<ConfirmDialog
  open={deleting !== undefined}
  title="Delete this station?"
  message={deleting ? `${deleting.name} is deleted from this computer. A persona that has it as its default will have none.` : ''}
  confirmLabel="Delete station"
  destructive
  onConfirm={() => { const station = deleting; deleting = undefined; if (station) void act(onDelete(station.id)); }}
  onCancel={() => { deleting = undefined; }}
/>
