// SPDX-License-Identifier: GPL-3.0-only
import {
  callsignLabel, type Callsign, type Snapshot, type CredentialStatus, type CredentialTest, type ExportResult,
  type ImportPreview, type ImportResult, type CallsignCommand, type CallsignReply, type ServiceSummary
} from '../callsigns/callsign-contract.js';
import type { SettingsCommand, SettingsReply, ThemeChoice, UpdateTrack } from '../main/settings-contract.js';
import { isUpdateState, type UpdateCommand } from '../main/update-contract.js';
import { isWhatsNewNotes } from '../main/whats-new-contract.js';
import type { LogsCommand, LogsReply } from '../main/logs-contract.js';
import { isStorageStatus, type StorageCommand, type StorageReply } from '../storage/storage-contract.js';
import type { AreaProgram } from '../storage/area-entry.js';
import type { FieldProblem, NamedReferences, ParkDraft, StationChoices, StationDraft } from '../storage/station-contract.js';
import type { Level } from '../logging/logging.js';
import { applyTheme, followSystem, isPinned, resolveTheme, type Appearance } from './theme.js';
import { mount } from 'svelte';
import Shell from './Shell.svelte';
import { isExtensionsReply, type ExtensionsCommand, type ExtensionsReply } from '../main/extensions-contract.js';
import { callsignDates, isExpired, orderCallsigns } from './callsign-order.js';
import { createShellStore } from './shell-store.js';
import type { LinkCommand } from '../main/links-contract.js';
import { createHomeStore } from './home-store.js';
import { forStore } from '../callsigns/credential-store.js';
declare const __QG_VERSION__: string;

declare global {
  interface Window {
    callsigns: { request(command: CallsignCommand): Promise<CallsignReply>; platform?: string };
    settings: { request(command: SettingsCommand): Promise<SettingsReply> };
    logs: { request(command: LogsCommand): Promise<LogsReply> };
    home?: {
      request(command: unknown): Promise<unknown>;
      onPage(listener: (page: unknown) => void): () => void;
      onNotice(listener: (notice: unknown) => void): () => void;
    };
    storage: {
      request(command: StorageCommand): Promise<StorageReply>;
      onStatus(listener: (status: unknown) => void): () => void;
    };
    extensions?: {
      inventory(command: ExtensionsCommand): Promise<ExtensionsReply>;
    };
    appearance?: Appearance;
    menu?: { onTroubleshooting(listener: () => void): () => void; onSetup?(listener: (action: string) => void): () => void };
    // What's new (QGD-FRM-0016): the notes, from the changelog that ships.
    whatsNew?: { notes(since: string | null): Promise<unknown> };
    // A page in the browser, built by main from its register (QGD-SEC-0009).
    links?: { open(command: LinkCommand): Promise<boolean> };
    // Updates (QGD-FRM-0019): asked for once, then pushed when it changes.
    updates?: {
      request(command: UpdateCommand): Promise<unknown>;
      onState(listener: (state: unknown) => void): () => void;
    };
  }
}
// QGD-FRM-0005: the shell is Svelte, and it is mounted before a single line
// below looks for an element. The Callsign screen's markup moved into
// CallsignsPage.svelte unchanged and this file still finds it by id, so the
// workflow signed off at P1 is the same code driving the same markup.
// The inventory and the grant writer were here until 2026-10-10, feeding the
// Applications section of Settings. Both are gone with it (QGD-APP-0012.1): an
// official application's grants are what the application is, so there was no
// decision to put to anybody. The enforcement did not move — it is in
// extension-runtime.ts and extension-serve.ts, with the settings channel still the way a
// grant is allowed or withdrawn, and tests/extension-serve.test.ts proving a
// withdrawal takes effect with nothing restarted.
// The credential store this platform has, named on screen (credential-store.ts).
const PLATFORM = window.callsigns.platform ?? 'darwin';
const shell = createShellStore();
// Home's pins and the open page: read once, then pushed (QGD-HOM-0005).
const home = createHomeStore(window.home);
home.start();
// Offline or online, as the operating system says, with no polling: the
// events fire only when it changes (KI7MT, 2026-10-23).
home.setConnection(navigator.onLine);
window.addEventListener('online', () => home.setConnection(true));
window.addEventListener('offline', () => home.setConnection(false));

mount(Shell, {
  target: document.body,
  props: {
    store: shell, home, onChooseTheme: setThemeChoice, onSetExtension: setExtensionEnabled, onUpdateReference: updateReference,
    onSaveStation: saveStation, onDeleteStation: deleteStation, onSetActiveStation: setActiveStation, onStationFromPark: stationFromPark, onStationChoices: stationChoices, onLookUpParks: lookUpParks, onCountiesAt: countiesAt, onCloseUpdate: closeUpdate, onOpenWhatsNew: openWhatsNew, onCloseWhatsNew: closeWhatsNew, onStationFromSummit: stationFromSummit, onOpenPage: openPage, onAreaChoices: areaChoices, onAreaDefault: areaDefault, onSaveArea: saveArea,
    onSetLevel: setLogLevel, onExport: exportDiagnostics,
    onExportCallsigns: exportCallsigns, onInspectImport: inspectImport, onApplyImport: applyImport,
    onCreateCallsign: createCallsign, onSaveCredential: saveSetupCredential,
    onFinishSetup: finishSetup,
    onSetUpdateCheck: (on: boolean) => writeUpdateSetting('updateCheck', on),
    onSetUpdateTrack: (track: UpdateTrack) => writeUpdateSetting('updateTrack', track),
    onCheckUpdates: () => { void window.updates?.request({ type: 'check' }); },
    onRestartToUpdate: () => { void window.updates?.request({ type: 'restart' }); },
    onOpenRelease: () => { void window.updates?.request({ type: 'release' }); },
    // Injected at build time from package.json, so the number on screen is the
    // number that was built rather than one typed twice.
    version: __QG_VERSION__
  }
});

// Guided setup's two actions. Both are the real ones: the callsign is created
// when it is named and the credential is saved when it is entered, so there
// is nothing in setup that is lost by leaving it. A refusal comes back as its
// sentence for the screen to show.
export async function createCallsign(call: string, description: string): Promise<string | undefined> {
  const before = new Set(snapshot.callsigns.map(entry => entry.id));
  const reply = await window.callsigns.request({ type: 'create', call, description });
  if (!reply.ok) return reply.error;
  snapshot = reply.data as Snapshot;
  // The one that was not there before: the core chose its id.
  const made = snapshot.callsigns.find(entry => !before.has(entry.id));
  if (!made) return 'The callsign was not saved.';
  const activated = await window.callsigns.request({ type: 'set-active', id: made.id });
  if (activated.ok) snapshot = activated.data as Snapshot;
  // Remembered, not drawn. The Callsigns screen's markup is not mounted while
  // setup is showing — setup is in its place — and select() reaches straight
  // into that markup, so calling it here threw and the operator was left
  // looking at a callsign box that had already made their callsign.
  selected = made.id;
  shell.set({ activeCallsign: made.call, activeCallsignId: made.id, activeCallsignLabel: callsignLabel(made), firstRun: false });
  return undefined;
}

// Drawing the Callsigns screen again, once it is back on screen. Called when
// setup finishes, which is the first moment its markup exists again.
export function finishSetup(): void {
  shell.endSetup();
  select(selected ?? snapshot.active ?? snapshot.callsigns[0]?.id ?? null);
}

export async function saveSetupCredential(
  service: string,
  values: Record<string, string>
): Promise<string | undefined> {
  const id = snapshot.active ?? snapshot.callsigns[0]?.id;
  if (!id) return 'Add a callsign first.';
  const reply = await window.callsigns.request({
    type: 'save-credentials',
    id,
    provider: service,
    credentials: {
      ...(values.username ? { username: values.username } : {}),
      ...(values.password ? { password: values.password } : {}),
      ...(values.api_key ? { apiKey: values.api_key } : {})
    }
  });
  return reply.ok ? undefined : reply.error;
}

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const input = (id: string) => element<HTMLInputElement>(id);
let snapshot: Snapshot = { callsigns: [], active: null };
// The callsign on screen, by id.
let selected: string | null = null;
// Which secret fields the operator has actually typed into since they were
// last cleared (QGD-CRD-0006, QGD-APP-0007's sibling concern in the shell).
//
// The save used to send whatever the password and API key inputs held, with
// blank meaning "keep what is saved". That reads correctly and it makes the
// stored secret depend on the field's value being right at the instant the
// button is pressed — so any way a value reaches that field without the
// operator putting it there ends up in the Keychain. A stale value, an
// autofill, a paste that lands late while focus is moving: each of those
// writes a secret the operator did not supply.
//
// KI7MT, 2026-10-09, after packaged-launch stored a password into an entry
// whose field the suite had just emptied: treat it as a security bug, not a
// record entry. It has not been reproduced in twelve runs since, eight of them
// under load, so this does not fix a known mechanism — it removes the product's
// dependence on that field being right, which is what every candidate
// mechanism had in common.
//
// Intent is now read from the operator's own input events rather than from the
// value: a field nobody typed into sends nothing, whatever it contains.
const edited = new Set<string>();

function clearSecretFields() {
  for (const id of ['password', 'api-key']) {
    input(id).value = '';
    // Cleared by the application, so the operator has said nothing about it.
    edited.delete(id);
  }
}

// Only what the operator entered in this action. Blank still means "keep what
// is saved" — that is the documented behaviour and the Remove buttons are how
// a secret is deleted — but now so does untouched.
function enteredSecret(id: 'password' | 'api-key'): string | undefined {
  if (!edited.has(id)) return undefined;
  return input(id).value || undefined;
}

const testResults = new Map<string, { text: string; success: boolean }>();
const testKey = () => `${selected}:${element<HTMLSelectElement>('provider').value}`;
function setTestResult(text: string, kind: 'success' | 'error' | 'plain' = 'plain') {
  const target = element('credential-test-result');
  target.textContent = text;
  target.classList.toggle('success', kind === 'success');
  target.classList.toggle('error', kind === 'error');
}

// The one writer of that line, so a remembered result and the reason the
// button is unavailable cannot overwrite each other. They used to: saving a
// credential drew the reason and then invalidateTest() immediately replaced it
// with "Not tested yet." — a claim about a service that cannot be tested.
let serviceState: CredentialStatus | undefined;

function showTestResult() {
  if (serviceState === undefined) { setTestResult('Checking saved credentials…'); return; }
  if (!serviceState.testable) { setTestResult('Testing for this service is not implemented yet.'); return; }
  if (!serviceState.stored) { setTestResult('Save a username and password or API key first, then this can be tested.'); return; }
  const result = testResults.get(testKey());
  setTestResult(result?.text ?? 'Not tested yet.',
    result ? (result.success ? 'success' : 'error') : 'plain');
}
function invalidateTest() { testResults.delete(testKey()); showTestResult(); }
function message(text: string, error = false) { const status = element('message'); status.textContent = text; status.classList.toggle('error', error); }
async function request(command: CallsignCommand) {
  const reply = await window.callsigns.request(command);
  if (!reply.ok) throw new Error(reply.error);
  return reply.data;
}
function current(): Callsign | undefined { return snapshot.callsigns.find(entry => entry.id === selected); }
// The list as Locations draws its own (#70, KI7MT 2026-10-24): a row for
// each, active first, then those in use, then those whose end date has
// passed; the call, its description and dates, an Active badge, and Make
// active and Edit. The row being edited is marked.
function list() {
  const container = element('callsign-list'); container.replaceChildren();
  const today = new Date().toISOString().slice(0, 10);
  const span = (className: string, text: string): HTMLSpanElement => {
    const node = document.createElement('span'); node.className = className; node.textContent = text; return node;
  };
  const action = (label: string, aria: string, onClick: () => void): HTMLButtonElement => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary';
    button.textContent = label; button.setAttribute('aria-label', aria); button.addEventListener('click', onClick);
    return button;
  };
  for (const callsign of orderCallsigns(snapshot.callsigns, snapshot.active, today)) {
    const row = document.createElement('li');
    row.className = 'extension-row station-row callsign-row';
    row.dataset.callsign = callsign.call;
    row.classList.toggle('selected', callsign.id === selected);
    const text = span('extension-text', '');
    const name = span('extension-name', callsign.call);
    if (callsign.description) name.append(span('station-kind', callsign.description));
    if (callsign.id === snapshot.active) name.append(span('badge', 'Active'));
    else if (isExpired(callsign, today)) name.append(span('station-kind', 'Expired'));
    text.append(name);
    const dates = callsignDates(callsign.start, callsign.end);
    if (dates) text.append(span('hint', dates));
    const actions = span('station-actions', '');
    if (callsign.id !== snapshot.active) {
      actions.append(action('Make active', `Make ${callsign.call} active`, () => void makeActive(callsign.id)));
    }
    const edit = action('Edit', `Edit ${callsign.call}`, () => select(callsign.id));
    edit.classList.add('callsign-edit');
    edit.setAttribute('aria-pressed', String(callsign.id === selected));
    actions.append(edit);
    row.append(text, actions);
    container.append(row);
  }
  if (!snapshot.callsigns.length) { const empty = document.createElement('li'); empty.className = 'hint'; empty.textContent = 'No callsigns yet. Start with your own.'; container.append(empty); }
  const active = snapshot.callsigns.find(entry => entry.id === snapshot.active);
  // Both read from the callsigns every time they are drawn, so the offer of
  // guided setup goes away the moment there is a callsign rather than staying
  // up because it was decided once at start (QGD-PSN-0004).
  shell.set({
    activeCallsign: active?.call ?? '',
    activeCallsignId: active?.id ?? '',
    activeCallsignLabel: active ? callsignLabel(active) : '',
    firstRun: snapshot.callsigns.length === 0
  });
}
async function credentialStatus() {
  const id = selected;
  const provider = element<HTMLSelectElement>('provider').value;
  if (!id) return;
  // Nothing is known about this service until the answer comes back, and the
  // line says so rather than making a claim it has not checked.
  serviceState = undefined;
  showTestResult();
  element<HTMLButtonElement>('test-credential').disabled = true;
  for (const id of ['password', 'api-key']) {
    input(id).placeholder = '';
    element(`${id}-saved`).hidden = true;
    element(`remove-${id}`).hidden = true;
  }
  element<HTMLSelectElement>('credential-preference').disabled = true;
  element('credential-effective').textContent = '';
  element('remove-credential').hidden = true;
  element('credential-status').textContent = 'Checking saved credentials…';
  try {
    const status = await request({ type: 'status', id, provider }) as CredentialStatus;
    if (id !== selected || provider !== element<HTMLSelectElement>('provider').value) return;
    showCredentialStatus(status);
  } catch (error) { if (id === selected) message((error as Error).message, true); }
}
function showCredentialStatus(status: CredentialStatus) {
  // A control that cannot be used says why, without being pressed. Both
  // reasons are knowable in advance: the service may not be testable at all,
  // or there may be nothing saved to test. Leaving the button simply dead was
  // the bug — on Club Log it was disabled, offered no reason, and the shared
  // disabled style drew a busy cursor over it, so a control that was doing
  // nothing looked like one that was working.
  const test = element<HTMLButtonElement>('test-credential');
  serviceState = status;
  test.disabled = !status.testable || !status.stored;
  test.setAttribute('aria-describedby', 'credential-test-result');
  showTestResult();
  // An entry saved before the index recorded which kinds it holds says so,
  // rather than being drawn as holding neither (QGD-CRD-0010). Both removal
  // controls are offered, because each is an explicit action that will read
  // the entry — and reading it is what records the kinds for next time.
  const unknown = status.stored && !status.kindsKnown;
  for (const [id, saved] of [['password', status.hasPassword], ['api-key', status.hasApiKey]] as const) {
    // Fixed display marker, independent of the stored value or its length.
    input(id).placeholder = saved || unknown ? '••••••••' : '';
    element(`${id}-saved`).hidden = !saved;
    element(`remove-${id}`).hidden = !saved && !unknown;
  }
  const preference = element<HTMLSelectElement>('credential-preference');
  preference.value = status.preferred;
  preference.disabled = !status.stored;
  const effective = status.effective === 'api_key' ? 'API key' : 'password';
  element('credential-effective').textContent = status.effective ? `Selected for use: ${effective}. If the preferred credential is missing, the other saved credential is used.` : '';
  const parts = [status.hasPassword ? 'password' : '', status.hasApiKey ? 'API key' : ''].filter(Boolean);
  element('credential-status').textContent = !status.stored
    ? 'No credential saved for this service.'
    : unknown
      ? forStore('Stored in Keychain. Test it or save it again to show what it holds.', PLATFORM)
      : forStore(`Stored in Keychain${parts.length ? ` · ${parts.join(' and ')}` : ''}.`, PLATFORM);
  element('remove-credential').hidden = !status.stored;
}
function select(id: string | null) {
  selected = id; const callsign = current(); list(); message('');
  element('page-title').textContent = callsign ? callsign.call : 'Add a callsign';
  // Both the description and the call can be changed: the id is what is
  // kept (KI7MT, 2026-10-22).
  input('callsign-description').value = callsign?.description ?? '';
  input('callsign').value = callsign?.call ?? '';
  input('start-date').value = callsign?.start ?? new Date().toISOString().slice(0, 10);
  input('end-date').value = callsign?.end ?? '';
  element('save-callsign').textContent = callsign ? 'Save callsign details' : 'Add callsign';
  element('remove-callsign').hidden = !callsign;
  element('credential-card').hidden = !callsign;
  input('username').value = callsign?.call ?? '';
  element('keychain-id').textContent = callsign?.id ?? '';
  clearSecretFields();
  if (callsign) void credentialStatus(); else input('callsign').focus();
}
async function busy(buttonId: string, action: () => Promise<void>) {
  const button = element<HTMLButtonElement>(buttonId);
  button.disabled = true;
  // Working, as opposed to merely unavailable. The two look different now,
  // because they are different and the operator should be able to tell.
  button.classList.add('working');
  button.setAttribute('aria-busy', 'true');
  try { await action(); } catch (error) { message((error as Error).message, true); }
  finally {
    button.classList.remove('working');
    button.removeAttribute('aria-busy');
    if (buttonId === 'test-credential' || buttonId === 'credential-preference') void credentialStatus();
    else button.disabled = false;
  }
}
element('new-callsign').addEventListener('click', () => select(null));
element('callsign-form').addEventListener('submit', event => {
  event.preventDefault(); void busy('save-callsign', async () => {
    const details = {
      call: input('callsign').value, description: input('callsign-description').value,
      start: input('start-date').value || undefined, end: input('end-date').value || undefined
    };
    if (selected) {
      snapshot = await request({ type: 'update', id: selected, ...details }) as Snapshot;
      select(selected);
    } else {
      const before = new Set(snapshot.callsigns.map(entry => entry.id));
      snapshot = await request({ type: 'create', ...details }) as Snapshot;
      select(snapshot.callsigns.find(entry => !before.has(entry.id))?.id ?? null);
    }
    message('Callsign saved.');
  });
});
// Make active, from a row: that callsign is the active one, and the one
// being edited stays as it was.
async function makeActive(id: string): Promise<void> {
  try {
    snapshot = await request({ type: 'set-active', id }) as Snapshot;
    select(selected ?? id); message('Active callsign selected.');
  } catch (error) { message((error as Error).message, true); }
}
element('remove-callsign').addEventListener('click', () => void busy('remove-callsign', async () => {
  if (!selected || !window.confirm(forStore('Remove this callsign and ALL its saved service credentials from Keychain? This cannot be undone.', PLATFORM))) return;
  const id = selected;
  snapshot = await request({ type: 'remove-callsign', id }) as Snapshot;
  for (const key of testResults.keys()) if (key.startsWith(`${id}:`)) testResults.delete(key);
  select(snapshot.active ?? snapshot.callsigns[0]?.id ?? null);
  message('Callsign and its saved service credentials removed.');
}));
element('provider').addEventListener('change', () => { clearSecretFields(); message(''); void credentialStatus(); });
for (const id of ['password', 'api-key']) {
  // 'input' rather than 'change': it fires for typing, pasting, autofill the
  // operator accepted, and a cleared field — every way a person puts a value
  // in — and does not fire when something else assigns .value, which is the
  // case this exists to refuse.
  input(id).addEventListener('input', () => { edited.add(id); });
}
element('credential-form').addEventListener('submit', event => {
  event.preventDefault(); void busy('save-credential', async () => {
    if (!selected) return;
    const credentials = {
      username: input('username').value || undefined,
      password: enteredSecret('password'),
      apiKey: enteredSecret('api-key')
    };
    clearSecretFields();
    const id = selected;
    const provider = element<HTMLSelectElement>('provider').value;
    const status = await request({ type: 'save-credentials', id, provider, credentials }) as CredentialStatus;
    if (id === selected && provider === element<HTMLSelectElement>('provider').value) {
      showCredentialStatus(status); message(forStore('Credential saved in macOS Keychain.', PLATFORM));
      invalidateTest();
    }
  });
});
element('remove-credential').addEventListener('click', () => void busy('remove-credential', async () => {
  if (!selected || !window.confirm('Remove the saved credential for this callsign and service?')) return;
  const id = selected;
  const provider = element<HTMLSelectElement>('provider').value;
  const status = await request({ type: 'delete-credentials', id, provider }) as CredentialStatus;
  if (id === selected && provider === element<HTMLSelectElement>('provider').value) {
    showCredentialStatus(status); message('Saved credential removed.');
    invalidateTest();
  }
}));
for (const [id, field, label] of [['remove-password', 'password', 'password'], ['remove-api-key', 'api_key', 'API key']] as const) {
  element(id).addEventListener('click', () => void busy(id, async () => {
    if (!selected || !window.confirm(`Remove only the saved ${label} for this callsign and service?`)) return;
    const id = selected;
    const provider = element<HTMLSelectElement>('provider').value;
    const status = await request({ type: 'remove-secret', id, provider, field }) as CredentialStatus;
    if (id === selected && provider === element<HTMLSelectElement>('provider').value) {
      const cleared = field === 'api_key' ? 'api-key' : 'password';
      input(cleared).value = '';
      edited.delete(cleared);
      showCredentialStatus(status); message(`Saved ${label} removed.`);
      invalidateTest();
    }
  }));
}
element('credential-preference').addEventListener('change', () => void busy('credential-preference', async () => {
  if (!selected) return;
  const id = selected;
  const provider = element<HTMLSelectElement>('provider').value;
  const preferred = element<HTMLSelectElement>('credential-preference').value as CredentialStatus['preferred'];
  const status = await request({ type: 'set-preference', id, provider, preferred }) as CredentialStatus;
  if (id === selected && provider === element<HTMLSelectElement>('provider').value) {
    showCredentialStatus(status); message('Preferred credential saved.');
    invalidateTest();
  }
}));
// What to call a service on screen: the label its own option carries, so the
// name a message uses is the name the operator just chose from. Falls back to
// the identifier, which is better than naming the wrong service.
function serviceName(provider: string): string {
  const select = element<HTMLSelectElement>('provider');
  for (const option of select.options) if (option.value === provider) return option.text;
  return provider;
}

element('test-credential').addEventListener('click', () => void busy('test-credential', async () => {
  if (!selected) return;
  const id = selected;
  const provider = element<HTMLSelectElement>('provider').value;
  const key = testKey();
  setTestResult('Testing saved credential…');
  const result = await request({ type: 'test-credential', id, provider }) as CredentialTest;
  // The service this result is about, named from the register's own label
  // rather than written into the sentence.
  //
  // Four of these said "QRZ" whatever was being tested, so testing eQSL
  // reported that QRZ had rejected the credential. The provider being tested
  // is read here rather than taken from the select, because a result can
  // arrive after the operator has moved to a different service.
  const service = serviceName(provider);
  const messages: Record<CredentialTest['outcome'], string> = {
    success: `Success — ${service} accepted the saved credential.`,
    rejected: `Failed — ${service} rejected the credential or denied API access.`,
    'network-error': `Could not connect securely to ${service}. Check your connection and try again.`,
    'rate-limited': `${service} is limiting requests from this account at the moment. Try again shortly.`,
    'invalid-response': `${service} returned an unexpected response. Credential validity could not be confirmed.`,
    missing: 'No usable credential is saved. Save a username and password or API key first.',
    unsupported: 'Testing for this service is not implemented yet.'
  };
  testResults.set(key, { text: `${messages[result.outcome]} (${new Date().toLocaleTimeString()})`, success: result.outcome === 'success' });
  if (id === selected && provider === element<HTMLSelectElement>('provider').value) showTestResult();
}));
async function initialize() {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      snapshot = await request({ type: 'list' }) as Snapshot;
      select(snapshot.active ?? snapshot.callsigns[0]?.id ?? null);
      // The register, for the setup screen to draw itself from. Whether to
      // offer setup at all is decided by the callsign list every time it is
      // drawn, above.
      const listed = await window.callsigns.request({ type: 'services' });
      // An empty list is what a register that could not be read looks like
      // from here, and setup then has a callsign step and nothing after it —
      // which is still a working setup (QGD-PSN-0004).
      shell.set({ services: listed.ok && Array.isArray(listed.data) ? listed.data as ServiceSummary[] : [] });
      return;
    }
    catch (error) { if (attempt === 9) message((error as Error).message, true); else await new Promise(resolve => setTimeout(resolve, 250)); }
  }
}
void initialize();


// QGD-FRM-0001 and QGD-FRM-0002: follow the operating system unless the user
// has chosen otherwise, and change with it while running.
let themeChoice: ThemeChoice = 'dark';
let stopFollowing: (() => void) | undefined;

function startTheme(): void {
  stopFollowing?.();
  stopFollowing = followSystem(prefersDark =>
    applyTheme(resolveTheme(themeChoice, prefersDark), isPinned(themeChoice)));
}

export async function setThemeChoice(choice: ThemeChoice): Promise<boolean> {
  const reply = await window.settings.request({ type: 'write', key: 'theme', value: choice });
  if (!reply.ok) return false;
  themeChoice = reply.data.theme;
  shell.set({ themeChoice });
  startTheme();
  return true;
}

async function loadTheme(): Promise<void> {
  const reply = await window.settings.request({ type: 'read' });
  // A settings channel that cannot answer must not leave the window unthemed.
  if (reply.ok) themeChoice = reply.data.theme;
  // What's new (QGD-FRM-0016): a different version from the one last seen
  // was an update, and Home says so in one line. A new install records its
  // version and says nothing.
  if (reply.ok && reply.data.seenVersion === '') void window.settings.request({ type: 'write', key: 'seenVersion', value: __QG_VERSION__ });
  else if (reply.ok && reply.data.seenVersion !== __QG_VERSION__) shell.set({ updatedFrom: reply.data.seenVersion });
  if (reply.ok) shell.set({ area: reply.data.area, updateCheck: reply.data.updateCheck, updateTrack: reply.data.updateTrack });
  shell.set({ themeChoice });
  startTheme();
}

void loadTheme();

// Updates (QGD-FRM-0019): what the updater says, checked before it is shown.
// A change to the switch or the track asks again at once; with the switch
// off, the updater says so itself.
async function writeUpdateSetting(key: 'updateCheck' | 'updateTrack', value: boolean | UpdateTrack): Promise<boolean> {
  const reply = await window.settings.request({ type: 'write', key, value });
  if (!reply.ok) return false;
  shell.set({ updateCheck: reply.data.updateCheck, updateTrack: reply.data.updateTrack });
  if (window.updates) void window.updates.request({ type: 'check' });
  return true;
}
if (window.updates) {
  const showUpdate = (state: unknown): void => { if (isUpdateState(state)) shell.set({ update: state }); };
  window.updates.onState(showUpdate);
  void window.updates.request({ type: 'state' }).then(showUpdate);
}

// Settings' switches for the extensions (QGD-HOM-0007). Every reply is checked
// and read back, so a switch shows what the main process recorded rather than
// what was clicked.
function takeExtensions(reply: unknown): boolean {
  if (!isExtensionsReply(reply) || !reply.ok) return false;
  shell.set({
    extensions: reply.inventory.extensions.map(({ id, name, pages, enabled }) => ({ id, name, pages: [...pages], enabled })),
    // The folder alone, never the path to it (QGD-ENG-0016).
    refusedExtensions: (reply.inventory.refused ?? []).map(({ source, reason }) => ({ folder: source.split(/[\\/]/).at(-2) ?? 'An extension', reason }))
  });
  return true;
}

export async function setExtensionEnabled(id: string, enabled: boolean): Promise<boolean> {
  try {
    return takeExtensions(await window.extensions?.inventory({ type: 'set-enabled', id, enabled }));
  } catch {
    return false;
  }
}

void window.extensions?.inventory({ type: 'inventory' }).then(takeExtensions, () => undefined);
// What Settings needs to show the applications and their grants
// (QGD-APP-0012). Asked for once at start and re-read after every change;
// nothing waits for it, and Settings says it is reading until it answers.


// QGD-LOG-0013. The page shows the level that is in force, so every reply is
// read back into the shell rather than the renderer assuming the change took.
async function readLogs(): Promise<void> {
  const reply = await window.logs.request({ type: 'read' });
  if (reply.ok && reply.kind === 'status') shell.set({ logs: reply.status });
}

export async function setLogLevel(level: Level): Promise<boolean> {
  const reply = await window.logs.request({ type: 'set-level', level });
  if (!reply.ok || reply.kind !== 'status') return false;
  shell.set({ logs: reply.status });
  return true;
}

// Returns the line the page displays. The wording is here because this is the
// only place that knows which of the three outcomes happened.
export async function exportDiagnostics(): Promise<string> {
  const reply = await window.logs.request({ type: 'export' });
  if (!reply.ok) return reply.error;
  if (reply.kind === 'cancelled') return 'Export cancelled.';
  if (reply.kind !== 'exported') return '';
  const megabytes = reply.bytes / (1024 * 1024);
  const size = megabytes >= 0.1 ? `${megabytes.toFixed(1)} MB` : `${Math.max(1, Math.round(reply.bytes / 1024))} KB`;
  const files = reply.files === 1 ? '1 log file' : `${reply.files} log files`;
  return `Saved ${files} (${size}). Passwords and keys were removed.`;
}

// Moving callsigns between machines (QGD-PSN-0007 to QGD-PSN-0011).
//
// The renderer asks and shows the answer: the file is chosen, read and
// written by the main process. A refusal is returned as its sentence
// rather than thrown, because every one of them is something the operator can
// act on.
export async function exportCallsigns(): Promise<ExportResult | string> {
  const reply = await window.callsigns.request({ type: 'export-callsigns' });
  if (!reply.ok) return reply.error;
  const data = reply.data as ExportResult | null;
  return data && typeof data.written === 'string' ? data : 'The export could not be written.';
}

export async function inspectImport(): Promise<ImportPreview | string> {
  const reply = await window.callsigns.request({ type: 'import-callsigns', apply: false, replace: false });
  if (!reply.ok) return reply.error;
  const data = reply.data as ImportPreview | null;
  return data && Array.isArray(data.arriving) ? data : 'That file could not be read.';
}

// `replace`: what is on this computer is removed first (a clean slate).
export async function applyImport(replace: boolean): Promise<ImportResult | string> {
  const reply = await window.callsigns.request({ type: 'import-callsigns', apply: true, replace });
  if (!reply.ok) return reply.error;
  const data = reply.data as ImportResult | null;
  if (!data || typeof data.callsigns !== 'number') return 'The import did not finish.';
  // The callsigns on screen are now out of date, because some of them arrived
  // a moment ago. Reloaded rather than left for the operator to discover.
  try {
    snapshot = await request({ type: 'list' }) as Snapshot;
    select(snapshot.active ?? snapshot.callsigns[0]?.id ?? null);
  } catch { /* the import worked; the list will catch up at the next action */ }
  return data;
}

// QGD-LOG-0010: a raise expires on its own, after an hour and at restart. The
// page has to notice, or it goes on offering `debug` while the loggers have
// been back on `info` for an hour — and somebody collects diagnostics
// believing they have detail that was never recorded.
//
// Read when Troubleshooting opens, and again while it stays open. The level is
// owned by the main process and changed by a clock, so the renderer has
// nothing to derive it from; asking is the only honest answer.
//
// Keyed on the panel, not on Settings. It was keyed on `page === 'settings'`
// because that is where the logs used to be shown; after the move, opening
// Troubleshooting from Home left the panel reading "Reading the log settings…"
// for ever, with no level switch and no way to save a bundle. A lifecycle has
// to follow the surface it feeds. Found in review.
const LOGS_REFRESH_MS = 30_000;
let logsRefresh: ReturnType<typeof setInterval> | undefined;
shell.subscribe(state => {
  if (state.troubleshooting && logsRefresh === undefined) {
    void readLogs();
    logsRefresh = setInterval(() => { void readLogs(); }, LOGS_REFRESH_MS);
  } else if (!state.troubleshooting && logsRefresh !== undefined) {
    clearInterval(logsRefresh);
    logsRefresh = undefined;
  }
});


// QGD-ENG-0003 and QGD-ENG-0006. Storage is asked how it is once, and after
// that it says so itself: the broker pushes its status whenever it changes (an
// exit, a restart, a finished reference build). Nothing polls. The engine this
// replaced had to be polled, because there was no push and a postmaster could
// exit without telling anyone; a status pushed on every change cannot go stale
// that way. Each status is checked before it is used (QGD-SEC-0006).
//
// A pushed status is always newer than the answer to the first request, which
// may have been composed before it (or be the broker's own "did not answer in
// time"). So once anything has been pushed, that first answer is ignored.
let pushed = false;
function takeStatus(status: unknown): void {
  if (isStorageStatus(status)) shell.set({ storage: status });
}
const stopListening = window.storage.onStatus(status => { pushed = true; takeStatus(status); });
window.addEventListener('pagehide', () => { stopListening(); }, { once: true });
void window.storage.request({ type: 'status' }).then(reply => { if (reply.ok && !pushed) takeStatus(reply.status); });

// Loading or updating the reference data, when the operator asks for it: a
// start fetches nothing (KI7MT, 2026-10-11). The reply says it is running; the
// finished status arrives pushed, like every other change.
// Undefined when it started; otherwise the reason, in words, to show.
export async function updateReference(resource: string): Promise<string | undefined> {
  try {
    const reply = await window.storage.request({ type: 'update-reference', resource });
    if (reply.ok) { takeStatus(reply.status); return undefined; }
    return reply.error;
  } catch {
    return 'The update could not be started.';
  }
}

// Stations (QGD-STN-*). Each command is QG Storage's to carry out, and the
// changed list arrives pushed like every other change to its status. Each
// returns undefined when it worked, or what to say when it did not.
//
// A reply's status is not taken: QG Storage pushes the changed list after
// every change, and a reply composed before a newer push would put an older
// list back on screen (found by Turing in review). And a reply from a storage
// process that is not ready, which the broker gives when it is restarting or
// did not answer in time, is a failure, never a success.
async function stationRequest(command: StorageCommand): Promise<StorageReply> {
  try {
    const reply = await window.storage.request(command);
    if (reply.ok && reply.status.state !== 'ready') {
      return { ok: false, error: reply.status.reason ?? 'Storage is not ready. Try again shortly.' };
    }
    return reply;
  } catch {
    return { ok: false, error: 'Storage could not be reached.' };
  }
}

export async function saveStation(
  draft: StationDraft, makeDefault: boolean
): Promise<{ error: string; problems?: FieldProblem[] } | undefined> {
  // The callsign the operator saw when they ticked the box, taken before the
  // save is sent, so a callsign changed meanwhile is not the one changed.
  const callsign = shell.get().activeCallsignId;
  const reply = await stationRequest({ type: 'save-station', station: draft });
  if (!reply.ok) return { error: reply.error, ...(reply.problems ? { problems: reply.problems } : {}) };
  const saved = reply.saved;
  if (!saved) return { error: 'The location could not be saved: storage did not say it was.' };
  if (!callsign) return undefined;
  // The checkbox is the whole answer: ticked makes it this callsign's default,
  // unticked on the station that is the default clears it, and unticked on
  // any other station leaves the default where it is.
  const current = shell.get().storage?.stations?.defaults[callsign];
  if (makeDefault && current !== saved) {
    const set = await stationRequest({ type: 'set-default-station', callsign, id: saved });
    if (!set.ok) return { error: `Saved, but not made the default: ${set.error}` };
  } else if (!makeDefault && current === saved) {
    const cleared = await stationRequest({ type: 'set-default-station', callsign, id: null });
    if (!cleared.ok) return { error: `Saved, but still the default: ${cleared.error}` };
  }
  return undefined;
}

export async function deleteStation(id: string): Promise<string | undefined> {
  const reply = await stationRequest({ type: 'delete-station', id });
  return reply.ok ? undefined : reply.error;
}

export async function setActiveStation(id: string | null): Promise<string | undefined> {
  const reply = await stationRequest({ type: 'set-active-station', id });
  return reply.ok ? undefined : reply.error;
}

// A location from a SOTA summit (QGD-REF-0018).
// A document or a park's or summit's page, in the browser (QGD-SEC-0009).
function openPage(command: LinkCommand): void {
  void window.links?.open(command);
}

export async function stationFromSummit(reference: string): Promise<ParkDraft | string> {
  if (!/^[0-9A-Z]{1,7}\/[0-9A-Z]{2}-[0-9]{3}$/.test(reference)) return 'A SOTA summit reference looks like W7I/SI-001.';
  const reply = await stationRequest({ type: 'station-from-summit', reference });
  if (!reply.ok) return reply.error;
  return reply.park ?? 'The summit could not be read.';
}

export async function stationFromPark(reference: string): Promise<ParkDraft | string> {
  if (!/^[0-9A-Z]{1,4}-[0-9]{4,5}$/.test(reference)) return 'A POTA park reference looks like US-0001.';
  const reply = await stationRequest({ type: 'station-from-park', reference });
  if (!reply.ok) return reply.error;
  return reply.park ?? 'The park could not be read.';
}

// ADIF's pick lists for the station editor, for an entity and a state.
// My Area (KI7MT, 2026-10-23): its choices and the Location's own, from QG
// Storage, and the choice saved in the settings.
export async function areaChoices(): Promise<readonly AreaProgram[] | string> {
  const reply = await stationRequest({ type: 'area-choices' });
  return reply.ok ? reply.areaChoices ?? [] : reply.error;
}

export async function areaDefault(): Promise<string | undefined> {
  const reply = await stationRequest({ type: 'area-default' });
  return reply.ok ? reply.areaDefault ?? undefined : undefined;
}

export async function saveArea(area: readonly string[]): Promise<boolean> {
  const reply = await window.settings.request({ type: 'write', key: 'area', value: [...area] });
  if (reply.ok) shell.set({ area: reply.data.area });
  return reply.ok;
}

export async function stationChoices(entity: string | null, state: string | null): Promise<StationChoices | undefined> {
  const reply = await stationRequest({ type: 'station-choices', entity, state });
  return reply.ok ? reply.choices : undefined;
}

// The US counties at a position or over a grid square, as LoTW names them
// (QGD-STN-0010). A string is why there is no answer.
export async function countiesAt(area: { south: number; west: number; north: number; east: number }):
  Promise<{ counties: string[]; sections: Record<string, string> } | string> {
  const reply = await stationRequest({ type: 'counties-at', ...area });
  if (!reply.ok) return reply.error;
  return { counties: reply.counties ?? [], sections: reply.sections ?? {} };
}

// The names of the parks a POTA reference names, from POTA's list.
export async function lookUpParks(references: string): Promise<NamedReferences | undefined> {
  const reply = await stationRequest({ type: 'look-up-parks', references });
  return reply.ok ? reply.named : undefined;
}

// What's new (QGD-FRM-0016). Home's line, closed, stays closed until the next
// update; the notes are this version's, or every version's since the one
// last seen when they are opened from that line.
export function closeUpdate(): void {
  shell.set({ updatedFrom: null });
  void window.settings.request({ type: 'write', key: 'seenVersion', value: __QG_VERSION__ });
}
export function openWhatsNew(): void {
  const since = shell.get().updatedFrom;
  shell.set({ whatsNew: {} });
  void window.whatsNew?.notes(since).then(notes => {
    if (shell.get().whatsNew) shell.set({ whatsNew: isWhatsNewNotes(notes) ? { notes } : { notes: { version: __QG_VERSION__, sections: [] } } });
  });
}
export function closeWhatsNew(): void {
  const updated = shell.get().updatedFrom !== null;
  shell.set({ whatsNew: null });
  // Read from Home's line, the notes count as seen.
  if (updated) closeUpdate();
}

// Help → Troubleshooting… opens the same panel as the status bar's button.
window.menu?.onTroubleshooting(() => { shell.set({ troubleshooting: true }); });
// The Setup menu (KI7MT, 2026-10-22): the places, the reference data, and
// the pins. A reference download starts, and Settings shows it going.
window.menu?.onSetup?.(action => {
  if (action === 'whats-new') { openWhatsNew(); return; }
  if (action === 'callsigns') shell.set({ page: 'callsigns', extensionPage: null });
  else if (action === 'locations') shell.set({ page: 'stations', extensionPage: null });
  // My Area is the last card on Locations (KI7MT, 2026-10-23).
  else if (action === 'area') {
    shell.set({ page: 'stations', extensionPage: null });
    requestAnimationFrame(() => document.getElementById('my-area')?.scrollIntoView({ block: 'start' }));
  }
  else if (action === 'settings') shell.set({ page: 'settings', extensionPage: null });
  else if (action === 'pins') shell.set({ page: 'home', extensionPage: null, customizing: true });
  // Tools (KI7MT, 2026-10-23): Settings' Back up and restore, at the button
  // the step needs.
  else if (action === 'export-callsigns' || action === 'import-callsigns') {
    shell.set({ page: 'settings', extensionPage: null });
    const field = action === 'export-callsigns' ? 'backup-export' : 'backup-import';
    requestAnimationFrame(() => {
      const input = document.getElementById(field);
      input?.scrollIntoView({ block: 'center' });
      input?.focus();
    });
  }
  else if (action === 'adif' || action === 'pota' || action === 'sota') {
    shell.set({ page: 'settings', extensionPage: null });
    void updateReference(action);
  }
});
