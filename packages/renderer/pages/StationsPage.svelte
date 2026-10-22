<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!--
  Stations (QGD-STN-*): where the operator is operating from, beside the
  persona that says who they are, as TQSL keeps station locations beside the
  callsign certificate.

  A station is a name, a kind (a label: Home, Portable, Mobile, Remote) and
  ADIF's own MY_* fields. It needs a name and a grid; every other field is
  optional (KI7MT, 2026-10-20). What a value
  may be is ADIF's to say: QG Storage checks it against the definitions and
  the reason it gives is shown beside the field, never rewritten here.

  This page holds no station state of its own. The list arrives in QG
  Storage's pushed status; what it keeps is only the form being edited.
-->
<script lang="ts">
  import PageLayout from '../../ui/PageLayout.svelte';
  import { caseAsTyped, type CaseRule } from '../../ui/typed-case.js';
  import ConfirmDialog from '../../ui/ConfirmDialog.svelte';
  import {
    STATION_KINDS, fromAdifLocation, gridBounds, gridOf as gridFromPosition, gridPosition, isLotwPark, typedLocation, type Choice, type FieldProblem, type NamedReferences,
    type StationChoices, type ParkDraft, type Place, type Station, type StationDraft, type StationField,
    type StationKind, type StationsView
  } from '../../storage/station-contract.js';

  interface Props {
    stations?: StationsView;
    // The active persona's name, and its callsign, which is how it is shown; empty when there is none.
    personaName: string;
    personaLabel: string;
    // Whether POTA's parks are downloaded, so "from a park" can be offered.
    parksLoaded: boolean;
    onSave: (draft: StationDraft, makeDefault: boolean) => Promise<{ error: string; problems?: FieldProblem[] } | undefined>;
    onDelete: (id: string) => Promise<string | undefined>;
    onSetActive: (id: string | null) => Promise<string | undefined>;
    onFromPark: (reference: string) => Promise<ParkDraft | string>;
    // ADIF's pick lists for an entity and state; undefined when they could
    // not be read, and the fields are then typed.
    onChoices?: (entity: string | null, state: string | null) => Promise<StationChoices | undefined>;
    // The parks a POTA reference names, from POTA's list where it is here.
    onLookUpParks?: (references: string) => Promise<NamedReferences | undefined>;
    // Whether SOTA's summits are downloaded, and a location from one
    // (QGD-REF-0018).
    summitsLoaded?: boolean;
    onFromSummit?: (reference: string) => Promise<ParkDraft | string>;
    // The US counties at a position or over a grid square (QGD-STN-0010).
    onCountiesAt?: (area: { south: number; west: number; north: number; east: number }) => Promise<{ counties: string[]; sections: Record<string, string> } | string>;
  }
  const {
    stations, personaName, personaLabel, parksLoaded, onSave, onDelete, onSetActive, onFromPark,
    onChoices = () => Promise.resolve(undefined),
    onLookUpParks = () => Promise.resolve(undefined),
    onCountiesAt = () => Promise.resolve({ counties: [], sections: {} }),
    summitsLoaded = false,
    onFromSummit = () => Promise.resolve('SOTA summits are not downloaded.')
  }: Props = $props();

  // ---- references checked against their lists (KI7MT, 2026-10-20) ---------
  // One rule for every reference: checked against its list where the list is
  // on this computer, and said so; otherwise checked for its form, and said
  // so. POTA's is checked here as it is typed, and again when it is saved.
  let parks = $state<NamedReferences | undefined>();
  let parksAsked = 0;
  async function lookUpParks() {
    const mine = ++parksAsked;
    const typed = (place.MY_POTA_REF ?? '').trim();
    if (!typed || !/^[0-9A-Za-z@,\- ]{1,100}$/.test(typed)) { parks = undefined; return; }
    const answer = await onLookUpParks(typed);
    if (mine === parksAsked) parks = answer;
  }
  const parkNote = $derived.by(() => {
    if (!parks || !(place.MY_POTA_REF ?? '').trim()) return '';
    if (!parks.checked) return 'POTA\'s parks are not downloaded, so this is checked for its form only.';
    return parks.found.map(park => `${park.code}: ${park.name}`).join(' · ');
  });

  // ---- pick lists (KI7MT, 2026-10-20) ------------------------------------
  // DXCC entity, state, county where ADIF lists them, ARRL section and the
  // zones are chosen, not typed: the lists are ADIF's own, from reference
  // data, and follow the entity and state chosen. Where a list is empty the
  // field is typed, as before.
  let choices = $state<StationChoices | undefined>();
  let asked = 0;
  async function loadChoices() {
    const mine = ++asked;
    loadingChoices = true;
    const entity = place.MY_DXCC && /^[0-9]{1,3}$/.test(place.MY_DXCC) ? place.MY_DXCC : null;
    const state = entity && place.MY_STATE && /^[0-9A-Za-z-]{1,8}$/.test(place.MY_STATE) ? place.MY_STATE : null;
    const answer = await onChoices(entity, state);
    if (mine !== asked) return;
    choices = answer;
    loadingChoices = false;
    // A state with one zone has that zone: filled in, never over a choice.
    if (answer?.cqZones.length === 1 && !place.MY_CQ_ZONE) place.MY_CQ_ZONE = answer.cqZones[0].code;
    if (answer?.ituZones.length === 1 && !place.MY_ITU_ZONE) place.MY_ITU_ZONE = answer.ituZones[0].code;
    // And a state with one ARRL section has that section (QGD-STN-0010).
    if (state && answer?.sections.length === 1 && !place.MY_ARRL_SECT) place.MY_ARRL_SECT = answer.sections[0].code;
  }
  // The options for a field, with what the station already holds kept in the
  // list even if ADIF's list no longer has it, so opening a station never
  // loses a value. Undefined: the field is typed.
  function optionsFor(field: StationField): Choice[] | undefined {
    if (!choices) return undefined;
    const list = field === 'MY_DXCC' ? choices.entities : field === 'MY_STATE' ? choices.states
      : field === 'MY_CNTY' ? choices.counties : field === 'MY_ARRL_SECT' ? choices.sections
      : field === 'MY_CQ_ZONE' ? choices.cqZones : field === 'MY_ITU_ZONE' ? choices.ituZones : undefined;
    if (!list || list.length === 0) return undefined;
    const held = place[field];
    return held && !list.some(option => option.code === held) ? [{ code: held, name: held }, ...list] : list;
  }
  // Nothing chosen is cleared by choosing something else: a value that no
  // longer fits is refused on save with ADIF's reason, never wiped unseen
  // (found by Turing in review). The lists that follow are reloaded, and
  // held still while they load, so a choice is never made from a stale one.
  function pick(field: StationField, value: string) {
    place[field] = value;
    if (field === 'MY_DXCC' || field === 'MY_STATE') void loadChoices();
  }
  const DEPENDENT: StationField[] = ['MY_STATE', 'MY_CNTY', 'MY_ARRL_SECT', 'MY_CQ_ZONE', 'MY_ITU_ZONE'];
  let loadingChoices = $state(false);

  // The fields, grouped as the operator thinks of them, each with the words
  // that say what ADIF wants. The order inside a group is TQSL's.
  interface FieldInfo { field: StationField; label: string; hint?: string }
  const GROUPS: { title: string; hint?: string; fields: FieldInfo[] }[] = [
    {
      title: 'Where it is',
      fields: [
        // One box for the grid, as an operator thinks of it (KI7MT,
        // 2026-10-20). What is typed is filed under ADIF's own fields when it
        // is saved: see gridFields below.
        { field: 'MY_GRIDSQUARE', label: 'Grid', hint: 'Required. Your Maidenhead grid, as DN13 or DN13sm; on a grid line or corner, give them all: DN13,DN14.' },
        { field: 'MY_DXCC', label: 'DXCC entity' },
        { field: 'MY_STATE', label: 'State, province or prefecture', hint: 'The lists are ADIF\'s for the entity above.' },
        { field: 'MY_CNTY', label: 'County', hint: 'From LoTW\'s list for the state, or filled from the position or the grid below.' },
        { field: 'MY_CQ_ZONE', label: 'CQ zone', hint: 'The state\'s own zones where ADIF gives them.' },
        { field: 'MY_ITU_ZONE', label: 'ITU zone' },
        { field: 'MY_ARRL_SECT', label: 'ARRL section' },
        // Paired in the two columns: latitude beside longitude (KI7MT).
        { field: 'MY_ALTITUDE', label: 'Elevation', hint: 'Metres above sea level, as on a map.' },
        { field: 'MY_LAT', label: 'Latitude', hint: 'In degrees, as 43.625; south is negative. Leave it empty and the grid gives the position.' },
        { field: 'MY_LON', label: 'Longitude', hint: 'In degrees, as -116.2083; west is negative.' }
      ]
    },
    {
      title: 'Activity',
      fields: [
        { field: 'MY_POTA_REF', label: 'POTA park', hint: 'As US-0001. On a two-fer or three-fer, every park, each counting the same: add them below.' },
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
  let notes = $state('');
  // A second or third park, for a two-fer or three-fer: added to the one
  // POTA field ADIF defines as a list, never a separate "primary" (KI7MT,
  // 2026-10-22).
  let anotherPark = $state('');
  function addPark() {
    const park = anotherPark.trim().toUpperCase();
    if (!park) return;
    const current = (place.MY_POTA_REF ?? '').trim();
    place.MY_POTA_REF = current ? `${current},${park}` : park;
    anotherPark = '';
    void lookUpParks();
  }
  let place = $state<Record<string, string>>({});
  let makeDefault = $state(false);
  let problems = $state<FieldProblem[]>([]);
  let formError = $state('');
  let note = $state('');
  let working = $state(false);

  let parkReference = $state('');
  let parkError = $state('');
  let summitReference = $state('');
  let summitError = $state('');
  let pageError = $state('');
  let deleting = $state<Station | undefined>();

  const list = $derived(stations?.list ?? []);
  const active = $derived(stations?.active ?? null);
  const defaultId = $derived(personaName ? stations?.defaults[personaName] : undefined);
  // A refusal of any of the grid's fields is shown on the one Grid box.
  const problemOf = (field: string) => problems.find(problem =>
    problem.field === field || (field === 'MY_GRIDSQUARE' && GRID_FIELDS.includes(problem.field)))?.reason;
  const labelOf = (field: string) => field === 'name' ? 'Name' : field === 'lotwPark' ? 'LoTW park' : field === 'notes' ? 'Notes'
    : GRID_FIELDS.includes(field) ? 'Grid'
    : GROUPS.flatMap(group => group.fields).find(info => info.field === field)?.label ?? field;

  // The one Grid box, filed under the field ADIF defines for it: two or four
  // grids on a line or corner are MY_VUCC_GRIDS; a 10-character locator is
  // MY_GRIDSQUARE's 8 and MY_GRIDSQUARE_EXT's last 2; anything else is
  // MY_GRIDSQUARE. Nothing is corrected: whatever is typed is ADIF's to accept
  // or refuse, and a refusal is shown on the Grid box.
  const GRID_FIELDS = ['MY_GRIDSQUARE', 'MY_GRIDSQUARE_EXT', 'MY_VUCC_GRIDS'];
  let gridShown = '';
  let gridStored: Place = {};
  function gridFields(typed: string): Place {
    if (!typed.trim()) return {};
    if (typed.includes(',')) return { MY_VUCC_GRIDS: typed };
    // A 10- or 12-character locator: ADIF's grid holds 8, its extension the rest.
    if (typed.length === 10 || typed.length === 12) return { MY_GRIDSQUARE: typed.slice(0, 8), MY_GRIDSQUARE_EXT: typed.slice(8) };
    return { MY_GRIDSQUARE: typed };
  }
  function gridOf(stored: Place | undefined): string {
    return stored?.MY_VUCC_GRIDS ?? `${stored?.MY_GRIDSQUARE ?? ''}${stored?.MY_GRIDSQUARE_EXT ?? ''}`;
  }

  function open(draft?: StationDraft, withNote = '') {
    editing = true;
    editingId = draft?.id;
    name = draft?.name ?? '';
    kind = draft?.kind ?? '';
    lotwPark = draft?.lotwPark ?? '';
    notes = draft?.notes ?? '';
    anotherPark = '';
    place = { ...(draft?.place ?? {}) };
    for (const field of GRID_FIELDS) delete place[field];
    const grid = gridOf(draft?.place);
    if (grid) place.MY_GRIDSQUARE = grid;
    // What the Grid box showed, and the fields it came from: saved back as
    // they were unless the box is changed, so opening and saving a station
    // never rewrites its grid (found by Turing in review).
    gridShown = grid;
    gridStored = Object.fromEntries(GRID_FIELDS.flatMap(field => draft?.place[field as StationField] ? [[field, draft.place[field as StationField]]] : []));
    // Shown in degrees; kept in ADIF's form (typedLocation, when saved).
    for (const field of ['MY_LAT', 'MY_LON'] as const) {
      const degrees = fromAdifLocation(place[field]);
      if (degrees !== undefined) place[field] = String(Math.round(degrees * 1e5) / 1e5);
    }
    parks = undefined;
    void lookUpParks();
    makeDefault = draft?.id !== undefined && draft.id === defaultId;
    parkFillNote = '';
    summitFillNote = '';
    countyNote = '';
    countyChoices = [];
    problems = [];
    formError = '';
    note = withNote;
    void loadChoices();
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
      if (field === 'MY_GRIDSQUARE') Object.assign(filled, value === gridShown ? gridStored : gridFields(value));
      else if ((field === 'MY_LAT' || field === 'MY_LON') && value.trim()) {
        filled[field] = typedLocation(value, field === 'MY_LAT' ? 'lat' : 'lon') ?? value;
      } else if (value.trim()) filled[field as StationField] = value;
    }
    return {
      ...(editingId ? { id: editingId } : {}),
      name: name.trim(),
      ...(kind ? { kind } : {}),
      place: filled,
      ...(lotwPark.trim() ? { lotwPark: lotwPark.trim().toUpperCase() } : {}),
      ...(notes.trim() ? { notes: notes.replace(/\r\n?/g, '\n') } : {})
    };
  }

  async function save() {
    // Two things are this product's own rather than ADIF's, so they are
    // checked here before the request is sent: a request off its shape is
    // refused whole at the boundary, and would say less (QGD-SEC-0006).
    const own: FieldProblem[] = [];
    if (name.trim() === '') own.push({ field: 'name', reason: 'A location needs a name.' });
    if (!(place.MY_GRIDSQUARE ?? '').trim()) own.push({ field: 'MY_GRIDSQUARE', reason: 'A location needs a grid.' });
    for (const [field, axis, example] of [['MY_LAT', 'lat', '43.625'], ['MY_LON', 'lon', '-116.2083']] as const) {
      const typed = (place[field] ?? '').trim();
      if (typed && typedLocation(typed, axis) === undefined) {
        own.push({ field, reason: `A ${axis === 'lat' ? 'latitude' : 'longitude'} in degrees, as ${example}.` });
      }
    }
    if (/[<>]/.test(notes)) own.push({ field: 'notes', reason: 'Notes cannot hold < or >.' });
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

  // The grid from latitude and longitude, as typed in degrees or in ADIF's
  // form: six characters, the precision LoTW and most loggers use.
  const typedPosition = $derived.by(() => {
    const lat = typedLocation(place.MY_LAT ?? '', 'lat');
    const lon = typedLocation(place.MY_LON ?? '', 'lon');
    const latitude = fromAdifLocation(lat);
    const longitude = fromAdifLocation(lon);
    return latitude !== undefined && longitude !== undefined ? { latitude, longitude } : undefined;
  });
  function fillGridFromPosition() {
    if (!typedPosition) return;
    const grid = gridFromPosition(typedPosition.latitude, typedPosition.longitude, 6);
    if (grid) place.MY_GRIDSQUARE = grid;
  }

  // The place from the first park in the POTA field, for a location being
  // edited, as "Fill in from the park" does for a new one (KI7MT,
  // 2026-10-22): grid, latitude, longitude, state and DXCC from POTA's list.
  // The parks themselves are left as they are.
  let parkFillNote = $state('');
  const firstPark = $derived(((place.MY_POTA_REF ?? '').split(',')[0] ?? '').split('@')[0].trim().toUpperCase());
  async function fillFromPark() {
    parkFillNote = '';
    if (!firstPark) return;
    const answer = await onFromPark(firstPark);
    if (typeof answer === 'string') { parkFillNote = answer; return; }
    const filled = answer.draft.place;
    for (const field of ['MY_DXCC', 'MY_STATE', 'MY_LAT', 'MY_LON'] as const) {
      if (filled[field]) place[field] = filled[field];
    }
    if (filled.MY_GRIDSQUARE) place.MY_GRIDSQUARE = filled.MY_GRIDSQUARE;
    for (const field of ['MY_LAT', 'MY_LON'] as const) {
      const degrees = fromAdifLocation(place[field]);
      if (degrees !== undefined) place[field] = String(Math.round(degrees * 1e5) / 1e5);
    }
    parkFillNote = answer.note ?? `Filled in from ${firstPark}.`;
    void loadChoices();
  }

  // The county, from LoTW's list (QGD-STN-0010, KI7MT 2026-10-22). A typed
  // position gives the county it is in; a grid alone gives the counties its
  // square reaches, and only one is filled in: where the square crosses a
  // county line the operator picks. A state already set is never changed: a
  // position in another state is said, not acted on.
  // The case each typed field takes as it is typed (QGD-CNV-0016). A field
  // not named here (latitude, longitude, elevation, zones, street, city,
  // postal code) is left as typed.
  function caseRule(field: StationField): CaseRule | undefined {
    if (field === 'MY_GRIDSQUARE' || field === 'MY_VUCC_GRIDS' || field === 'MY_GRIDSQUARE_EXT') return 'grid';
    if (field === 'MY_CNTY') return 'county';
    if (['MY_STATE', 'MY_ARRL_SECT', 'MY_POTA_REF', 'MY_SOTA_REF', 'MY_WWFF_REF', 'MY_IOTA'].includes(field)) return 'upper';
    return undefined;
  }

  let countyNote = $state('');
  let countyChoices = $state<string[]>([]);
  let countySections: Record<string, string> = {};
  const countyGrid = $derived((place.MY_GRIDSQUARE ?? '').split(',')[0].trim());
  const countyArea = $derived.by(() => {
    if (typedPosition) {
      const { latitude, longitude } = typedPosition;
      return { south: latitude, west: longitude, north: latitude, east: longitude };
    }
    return countyGrid.length >= 4 ? gridBounds(countyGrid) : undefined;
  });
  const countyName = (cnty: string) => cnty.slice(cnty.indexOf(',') + 1);
  function setCounty(cnty: string) {
    const state = cnty.slice(0, cnty.indexOf(','));
    if (place.MY_STATE && place.MY_STATE.toUpperCase() !== state) {
      countyNote = `That is ${countyName(cnty)} County in ${state}, and this location's state is ${place.MY_STATE.toUpperCase()}.`;
      return false;
    }
    place.MY_STATE = state;
    // The DXCC entity follows where it is not set: Alaska and Hawaii are
    // entities of their own.
    if (!place.MY_DXCC) place.MY_DXCC = state === 'AK' ? '6' : state === 'HI' ? '110' : '291';
    place.MY_CNTY = cnty;
    // The county's ARRL section with it, where the Section field is empty.
    if (!place.MY_ARRL_SECT && countySections[cnty]) place.MY_ARRL_SECT = countySections[cnty];
    countyChoices = [];
    void loadChoices();
    return true;
  }
  async function fillCounty() {
    countyNote = '';
    countyChoices = [];
    const area = countyArea;
    if (!area) return;
    const fromPosition = typedPosition !== undefined;
    const answer = await onCountiesAt(area);
    if (typeof answer === 'string') { countyNote = answer; return; }
    countySections = answer.sections;
    const found = answer.counties;
    if (found.length === 0) {
      countyNote = fromPosition ? 'There is no US county at that latitude and longitude.' : `There is no US county in ${countyGrid}.`;
    } else if (found.length === 1) {
      if (setCounty(found[0])) countyNote = `${countyName(found[0])}, from the ${fromPosition ? 'latitude and longitude' : 'grid'}.`;
    } else {
      countyChoices = found;
      countyNote = `${countyGrid} crosses a county line. Pick the county, or fill in latitude and longitude for the one you are in:`;
    }
  }

  function fillFromGrid() {
    const position = gridPosition((place.MY_GRIDSQUARE ?? '').trim());
    if (!position) return;
    place.MY_LAT = String(Math.round(position.latitude * 1e5) / 1e5);
    place.MY_LON = String(Math.round(position.longitude * 1e5) / 1e5);
  }

  // One park, or a two-fer or three-fer as "US-0001,US-0002" (KI7MT,
  // 2026-10-22): the first park gives the grid, position and state, and
  // every park goes into the POTA field, each checked when it is saved. The
  // editor opens so the place can be checked before it is: where parks
  // meet, the grid may be either's.
  async function fromPark() {
    parkError = '';
    const parks = parkReference.split(',').map(entry => entry.trim().toUpperCase()).filter(Boolean);
    if (parks.length === 0) return;
    const answer = await onFromPark(parks[0]);
    if (typeof answer === 'string') { parkError = answer; return; }
    parkReference = '';
    const draft = parks.length > 1
      ? { ...answer.draft, name: parks.join(' ').slice(0, 64), place: { ...answer.draft.place, MY_POTA_REF: parks.join(',') } }
      : answer.draft;
    const note = parks.length > 1
      ? `Filled in from ${parks[0]}; ${parks.slice(1).join(' and ')} added. Check the grid: where parks meet it may be either's.`
      : answer.note ?? '';
    open(draft, [answer.note, parks.length > 1 ? note : ''].filter(Boolean).join(' '));
  }

  // A new location from a SOTA summit: its grid, position and elevation
  // from SOTA's list (QGD-REF-0018), each changeable before saving.
  async function fromSummit() {
    summitError = '';
    const code = summitReference.trim().toUpperCase();
    if (!code) return;
    const answer = await onFromSummit(code);
    if (typeof answer === 'string') { summitError = answer; return; }
    summitReference = '';
    open(answer.draft, answer.note ?? '');
  }

  // The place from the summit in the SOTA field, for a location being edited:
  // grid, latitude, longitude and elevation.
  let summitFillNote = $state('');
  async function fillFromSummit() {
    summitFillNote = '';
    const code = (place.MY_SOTA_REF ?? '').trim().toUpperCase();
    if (!code) return;
    const answer = await onFromSummit(code);
    if (typeof answer === 'string') { summitFillNote = answer; return; }
    const filled = answer.draft.place;
    for (const field of ['MY_GRIDSQUARE', 'MY_ALTITUDE'] as const) { if (filled[field]) place[field] = filled[field]; }
    for (const field of ['MY_LAT', 'MY_LON'] as const) {
      const degrees = fromAdifLocation(filled[field]);
      if (degrees !== undefined) place[field] = String(Math.round(degrees * 1e5) / 1e5);
    }
    summitFillNote = answer.note ?? `Filled in from ${code}.`;
  }

  async function act(work: Promise<string | undefined>) {
    pageError = '';
    const failed = await work;
    if (failed) pageError = failed;
  }

  // One line saying where it is: what an operator reads to tell two apart.
  function summary(station: Station): string {
    const parts = [
      gridOf(station.place), station.place.MY_STATE, station.place.MY_POTA_REF, station.place.MY_SOTA_REF
    ].filter(Boolean);
    return parts.length ? parts.join(' · ') : 'No place given yet';
  }
</script>

<PageLayout eyebrow="WHERE YOU OPERATE" title="Station Locations">
  <section class="card" aria-labelledby="stations-title">
    <div class="section-title">
      <h2 id="stations-title">Your locations</h2>
      {#if !editing}<button type="button" id="add-station" onclick={() => open()}>Add a location</button>{/if}
    </div>
    {#if stations === undefined}
      <p class="hint">Reading the locations…</p>
    {:else if list.length === 0}
      <p class="hint" id="no-stations">
        No locations yet. Add one for each place you operate from: home, a park, a summit, the car.
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
      {#if active === null}<p class="hint" id="no-active-station">No location is active.</p>{/if}
    {/if}
    {#if pageError}<p class="extension-error" role="alert">{pageError}</p>{/if}
    {#if stations && !stations.checked}
      <p class="hint" id="stations-unchecked">
        ADIF's definitions are not downloaded, so location values cannot be checked yet. Download them in Settings.
      </p>
    {/if}
  </section>

  {#if !editing}
    <section class="card" aria-labelledby="from-park-title">
      <h2 id="from-park-title">A location from a POTA park</h2>
      {#if parksLoaded}
        <label for="park-reference">Park reference</label>
        <div class="inline-form">
          <input id="park-reference" type="text" autocapitalize="characters" placeholder="US-0001, or US-0001,US-0002" use:caseAsTyped={'upper'}
            bind:value={parkReference} aria-describedby={parkError ? 'park-reference-error' : undefined}
            aria-invalid={parkError ? true : undefined} />
          <button type="button" class="secondary" id="from-park" disabled={parkReference.trim() === ''}
            onclick={fromPark}>Fill in from the park</button>
        </div>
        {#if parkError}<p id="park-reference-error" class="field-error" role="status">{parkError}</p>{/if}
        <p class="hint">The park's grid, position and state come from POTA's park list. For a two-fer or three-fer, give every park, separated by commas. You can change any of it before saving.</p>
      {:else}
        <p class="hint" id="parks-not-downloaded">POTA parks are not downloaded. Download them in Settings to start a location from a park.</p>
      {/if}
    </section>
    <section class="card" aria-labelledby="from-summit-title">
      <h2 id="from-summit-title">A location from a SOTA summit</h2>
      {#if summitsLoaded}
        <label for="summit-reference">Summit reference</label>
        <div class="inline-form">
          <input id="summit-reference" type="text" autocapitalize="characters" placeholder="W7I/SI-001" use:caseAsTyped={'upper'}
            bind:value={summitReference} aria-describedby={summitError ? 'summit-reference-error' : undefined}
            aria-invalid={summitError ? true : undefined} />
          <button type="button" class="secondary" id="from-summit" disabled={summitReference.trim() === ''}
            onclick={fromSummit}>Fill in from the summit</button>
        </div>
        {#if summitError}<p id="summit-reference-error" class="field-error" role="status">{summitError}</p>{/if}
        <p class="hint">The summit's grid, position and elevation come from SOTA's summit list. You can change any of it before saving.</p>
      {:else}
        <p class="hint" id="summits-not-downloaded">SOTA summits are not downloaded. Download them in Settings to start a location from a summit.</p>
      {/if}
    </section>
  {:else}
    <section class="card station-editor" aria-labelledby="station-editor-title">
      <h2 id="station-editor-title">{editingId ? `Edit ${name || 'location'}` : 'New location'}</h2>
      {#if note}<p class="hint" id="station-note" role="status">{note}</p>{/if}
      <p class="hint">A location needs a name and a grid; every other field is optional. What a value may be is ADIF's to say, and it is checked when you save.</p>

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
            {@const options = optionsFor(info.field)}
            <div>
              <label for={id}>{info.label}</label>
              {#if options}
                <select {id} value={place[info.field] ?? ''} disabled={loadingChoices && DEPENDENT.includes(info.field)}
                  onchange={(event) => { pick(info.field, (event.currentTarget as HTMLSelectElement).value); }}
                  aria-describedby={[info.hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined}
                  aria-invalid={error ? true : undefined}>
                  <option value="">Not given</option>
                  {#each options as option (option.code)}
                    <option value={option.code}>{option.code === option.name ? option.name : `${option.name} (${option.code})`}</option>
                  {/each}
                </select>
              {:else}
                <input {id} type="text" maxlength="100" autocomplete="off"
                  use:caseAsTyped={caseRule(info.field)}
                  value={place[info.field] ?? ''}
                  oninput={(event) => { place[info.field] = (event.currentTarget as HTMLInputElement).value; }}
                  onchange={() => { if (info.field === 'MY_POTA_REF') void lookUpParks(); }}
                  aria-describedby={[info.hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined}
                  aria-invalid={error ? true : undefined} />
              {/if}
              {#if info.hint}<p id="{id}-hint" class="hint">{info.hint}</p>{/if}
              {#if info.field === 'MY_POTA_REF' && parkNote}<p id="station-park-names" class="hint" role="status">{parkNote}</p>{/if}
              {#if info.field === 'MY_POTA_REF'}
                <div class="inline-form add-park">
                  <input id="station-another-park" type="text" maxlength="20" autocapitalize="characters" placeholder="US-0002" use:caseAsTyped={'upper'}
                    aria-label="Another park, for a two-fer or three-fer" bind:value={anotherPark}
                    onkeydown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addPark(); } }} />
                  <button type="button" class="secondary" id="add-park" disabled={anotherPark.trim() === ''} onclick={addPark}>Add a park</button>
                </div>
              {/if}
              {#if error}<p id="{id}-error" class="field-error" role="status">{error}</p>{/if}
            </div>
          {/each}
          {#if group.title === 'Where it is'}
            <!-- The grid is a position, so latitude and longitude can be
                 filled from it: its centre, worked out here (KI7MT,
                 2026-10-20). Only when asked: typed ones are never replaced
                 unseen. -->
            <div class="fill-from-grid">
              <button type="button" class="secondary" id="fill-from-grid"
                disabled={gridPosition((place.MY_GRIDSQUARE ?? '').trim()) === undefined}
                onclick={fillFromGrid}>Fill latitude and longitude from the grid</button>
              <button type="button" class="secondary" id="fill-grid-from-position"
                disabled={typedPosition === undefined}
                onclick={fillGridFromPosition}>Fill the grid from latitude and longitude</button>
              {#if parksLoaded}
                <button type="button" class="secondary" id="fill-from-park"
                  disabled={!firstPark}
                  onclick={() => { void fillFromPark(); }}>Fill from the POTA park</button>
              {/if}
              <button type="button" class="secondary" id="fill-county"
                disabled={countyArea === undefined}
                onclick={() => { void fillCounty(); }}>Fill the county</button>
              {#if summitsLoaded}
                <button type="button" class="secondary" id="fill-from-summit"
                  disabled={!(place.MY_SOTA_REF ?? '').trim()}
                  onclick={() => { void fillFromSummit(); }}>Fill from the SOTA summit</button>
              {/if}
              {#if parkFillNote}<p class="hint" id="fill-from-park-note" role="status">{parkFillNote}</p>{/if}
              {#if summitFillNote}<p class="hint" id="fill-from-summit-note" role="status">{summitFillNote}</p>{/if}
              {#if countyNote}<p class="hint" id="fill-county-note" role="status">{countyNote}</p>{/if}
              {#if countyChoices.length}
                <div class="county-choices" role="group" aria-label="Counties in the grid">
                  {#each countyChoices as cnty (cnty)}
                    <button type="button" class="secondary" onclick={() => { if (setCounty(cnty)) countyNote = `${countyName(cnty)}.`; }}>{countyName(cnty)}, {cnty.slice(0, 2)}</button>
                  {/each}
                </div>
              {/if}
            </div>
          {/if}
          {#if group.title === 'Activity'}
            <div>
              <label for="station-lotw-park">LoTW park</label>
              <input id="station-lotw-park" type="text" maxlength="40" use:caseAsTyped={'upper'} bind:value={lotwPark}
                aria-describedby={problemOf('lotwPark') ? 'station-lotw-park-hint station-lotw-park-error' : 'station-lotw-park-hint'}
                aria-invalid={problemOf('lotwPark') ? true : undefined} />
              <p id="station-lotw-park-hint" class="hint">TQSL's Park, as NP33: a US national park unit. ADIF has no field for it.</p>
              {#if problemOf('lotwPark')}<p id="station-lotw-park-error" class="field-error" role="status">{problemOf('lotwPark')}</p>{/if}
            </div>
          {/if}
        </div>
      {/each}

      <h3>Notes</h3>
      <label for="station-notes" class="visually-hidden">Notes</label>
      <textarea id="station-notes" rows="4" maxlength="2000" bind:value={notes}
        aria-describedby="station-notes-hint"></textarea>
      <p id="station-notes-hint" class="hint">Your own: directions, parking, access, what worked. They stay on this computer.</p>
      {#if problemOf('notes')}<p id="station-notes-error" class="field-error" role="status">{problemOf('notes')}</p>{/if}

      {#if personaName}
        <label class="checkbox-row">
          <input id="station-default" type="checkbox" bind:checked={makeDefault} />
          The default location for {personaLabel}
        </label>
      {/if}

      {#if formError}<p class="extension-error" role="alert" id="station-form-error">{formError}</p>{/if}
      <div class="form-footer">
        <button type="button" class="secondary" onclick={close}>Cancel</button>
        <button type="button" id="save-station" disabled={working} onclick={save}>{working ? 'Saving…' : 'Save location'}</button>
      </div>
    </section>
  {/if}
</PageLayout>

<ConfirmDialog
  open={deleting !== undefined}
  title="Delete this location?"
  message={deleting ? `${deleting.name} is deleted from this computer. A callsign that has it as its default will have none.` : ''}
  confirmLabel="Delete location"
  destructive
  onConfirm={() => { const station = deleting; deleting = undefined; if (station) void act(onDelete(station.id)); }}
  onCancel={() => { deleting = undefined; }}
/>
