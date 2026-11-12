// SPDX-License-Identifier: GPL-3.0-or-later
// Exercise the real component script handlers with runes as plain values.
// Rendering is checked separately through Svelte's compiler; no socket or DOM
// emulator is required. The window suites own native modal focus and keys.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { compile } from 'svelte/compiler';
import { render } from 'svelte/server';
import type { Component } from 'svelte';
import { isCredentialStatus } from '../packages/callsigns/callsign-contract.js';
import { createAreaWork } from '../packages/renderer/area-work.js';
import type { PageWork } from '../packages/renderer/page-work.js';

function script(path: string, props: Record<string, unknown>, expose: string, extra: Record<string, unknown> = {}) {
  const source = readFileSync(path, 'utf8').match(/<script lang="ts">([\s\S]*?)<\/script>/)?.[1];
  if (!source) throw new Error(`No script in ${path}`);
  const effects: (() => unknown)[] = [];
  const context = {
    $props: Object.assign(() => props, { id: () => 'test-dialog' }), $state: (value: unknown) => value,
    $derived: Object.assign((value: unknown) => value, { by: () => undefined }),
    $effect: (effect: () => unknown) => { effects.push(effect); },
    untrack: (read: () => unknown) => read(), ...extra
  };
  // Imports are separately supplied real helpers where the handler uses them.
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const body = file.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(file)).join('\n');
  runInNewContext(ts.transpileModule(body + '\n' + expose, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, context);
  for (const effect of effects) effect();
  return context as typeof context & { subject: Record<string, (...args: never[]) => unknown> };
}

function station(onSave: () => Promise<unknown>) {
  let work!: PageWork;
  const ctx = script('packages/renderer/pages/StationsPage.svelte', {
    callsignId: '', callsignLabel: '', parksLoaded: false, onSave,
    registerWork: (value: PageWork) => { work = value; return () => {}; }
  }, `globalThis.subject = { open, save, edit: () => { name = 'QG0TEST location'; place = { MY_GRIDSQUARE: 'DN13' }; },
    invalid: () => { name = ''; }, changed: () => { notes = 'new edit'; }, editing: () => editing };`);
  return { ctx, work };
}

describe('real page work participants', () => {
  it('Locations saves only valid drafts and keeps refused, failed or still-pending edits', async () => {
    const onSave = vi.fn(async () => undefined);
    const { ctx, work } = station(onSave);
    ctx.subject.open(); expect(work.isDirty()).toBe(false);
    ctx.subject.edit(); expect(work.isDirty()).toBe(true);
    ctx.subject.invalid(); expect(await work.save()).toBe(false); expect(onSave).not.toHaveBeenCalled();
    ctx.subject.edit(); onSave.mockResolvedValueOnce({ error: 'Refused', problems: [] } as never);
    expect(await work.save()).toBe(false); expect(work.isDirty()).toBe(true);
    onSave.mockRejectedValueOnce(new Error('unknown')); expect(await work.save()).toBe(false); expect(work.isDirty()).toBe(true);
    expect(await work.save()).toBe(true); expect(work.isDirty()).toBe(false); expect(ctx.subject.editing()).toBe(false);
  });

  it('Locations preserves an edit made after its save request started', async () => {
    let finish!: () => void;
    const { ctx, work } = station(() => new Promise(resolve => { finish = () => resolve(undefined); }));
    ctx.subject.open(); ctx.subject.edit(); const save = work.save();
    ctx.subject.changed(); finish(); expect(await save).toBe(false); expect(work.isDirty()).toBe(true);
    work.discard(); expect(work.isDirty()).toBe(false);
  });

  it('Integrations refuses invalid settings, saves pending adapters, and retains an unconfirmed edit', async () => {
    let work!: PageWork;
    const onSet = vi.fn(async () => undefined);
    const adapter = { id: 'test', port: 2237, network: null, allow: [] };
    const ctx = script('packages/renderer/pages/IntegrationsPage.svelte', {
      view: { adapters: [adapter] }, onSet,
      registerWork: (value: PageWork) => { work = value; return () => {}; }
    }, `globalThis.subject = { edit: () => edit(view.adapters[0], { port: '2238' }), invalid: () => edit(view.adapters[0], { port: 'bad' }) };`, { isAddress: () => true });
    expect(work.isDirty()).toBe(false); ctx.subject.invalid();
    expect(await work.save()).toBe(false); expect(onSet).not.toHaveBeenCalled();
    ctx.subject.edit(); onSet.mockResolvedValueOnce('Unknown outcome' as never);
    expect(await work.save()).toBe(false); expect(work.isDirty()).toBe(true);
    expect(await work.save()).toBe(true); expect(work.isDirty()).toBe(false);
    ctx.subject.edit(); work.discard(); expect(work.isDirty()).toBe(false);
  });

  it('Focus Area keeps choices after a refused save and discards only when asked', async () => {
    let work!: PageWork; const onSave = vi.fn(async () => false);
    script('packages/renderer/pages/AreaCard.svelte', { area: [], most: 10, parksLoaded: false, onSave,
      registerWork: (value: PageWork) => { work = value; return () => {}; }
    }, `draft.choose(['US-ID']);`, { createAreaWork });
    expect(work.isDirty()).toBe(true); expect(await work.save()).toBe(false); expect(work.isDirty()).toBe(true);
    expect(onSave).toHaveBeenCalledWith(['US-ID']); onSave.mockResolvedValueOnce(true);
    expect(await work.save()).toBe(true); expect(work.isDirty()).toBe(false);
  });

  it('guided setup guards unsaved callsign and credential fields and clears saved secrets', async () => {
    let work!: PageWork; const create = vi.fn(async () => 'Refused');
    script('packages/renderer/pages/SetupPage.svelte', { services: [], onCreateCallsign: create,
      registerWork: (value: PageWork) => { work = value; return () => {}; }
    }, `callsign = 'QG0TEST'; name = 'Test';`);
    expect(work.isDirty()).toBe(true); expect(await work.save()).toBe(false); expect(create).toHaveBeenCalledWith('QG0TEST', 'Test');
    create.mockResolvedValueOnce(undefined as never); expect(await work.save()).toBe(true); expect(work.isDirty()).toBe(false);
    const save = vi.fn(async () => 'Refused');
    const ctx = script('packages/renderer/pages/SetupPage.svelte', { existing: 'QG0TEST', services: [{ id: 'test', fields: [] }], onSaveCredential: save,
      registerWork: (value: PageWork) => { work = value; return () => {}; }
    }, `entered.test = { password: 'fixture-secret' }; globalThis.subject = { held: () => entered.test };`);
    expect(work.isDirty()).toBe(true); expect(await work.save()).toBe(false); expect(work.isDirty()).toBe(true);
    save.mockResolvedValueOnce(undefined as never); expect(await work.save()).toBe(true); expect(ctx.subject.held()).toEqual({});
  });
});

function callsigns() {
  const source = readFileSync('packages/renderer/app.ts', 'utf8');
  const file = ts.createSourceFile('app.ts', source, ts.ScriptTarget.Latest, true);
  const names = ['edited', 'callsignRevision', 'callsignSaved', 'credentialRevision', 'credentialSaved', 'savingCallsign', 'savingCredential'];
  const functions = ['clearSecretFields', 'enteredSecret', 'saveCallsignDetails', 'saveCredentialDetails'];
  const nodes = file.statements.filter(node =>
    ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => names.includes(declaration.name.getText(file)))
    || ts.isFunctionDeclaration(node) && !!node.name && functions.includes(node.name.text)
    || ts.isForOfStatement(node) && (node.getText(file).includes('callsignRevision++') || node.getText(file).includes('edited.add(id)'))
    || ts.isExpressionStatement(node) && node.getText(file).startsWith("shell.registerWork('callsigns'"));
  expect(nodes.length).toBe(14);
  const listeners = new Map<string, Map<string, (event: unknown) => void>>();
  const inputs = new Map<string, { value: string; disabled: boolean; reportValidity: () => boolean; addEventListener: (name: string, fn: (event: unknown) => void) => void }>();
  const input = (id: string) => {
    if (!inputs.has(id)) inputs.set(id, { value: '', disabled: false, reportValidity: () => true,
      addEventListener(name, fn) { const events = listeners.get(id) ?? new Map(); events.set(name, fn); listeners.set(id, events); } });
    return inputs.get(id)!;
  };
  let work!: PageWork;
  const status = { testable: true, stored: true, kindsKnown: true, hasUsername: true, hasPassword: true, hasApiKey: false, preferred: 'service' };
  const request = vi.fn(async (command: { type: string }) => command.type === 'update'
    ? { callsigns: [{ id: 'fixture-id', call: '', description: 'Test description' }], active: null } : status);
  const context = {
    isCredentialStatus, element: input, input, request, selected: 'fixture-id', snapshot: { callsigns: [] },
    list: () => {}, select: vi.fn(), message: () => {}, showCredentialStatus: vi.fn(), invalidateTest: () => {}, forStore: (message: string) => message, PLATFORM: 'darwin',
    shell: { registerWork: (_id: string, value: PageWork) => { work = value; }, set: () => {} }
  };
  runInNewContext(ts.transpileModule(nodes.map(node => node.getText(file)).join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  const edit = (form: string, field: string, value: string) => { input(field).value = value; listeners.get(field)?.get('input')?.({ target: { id: field } }); listeners.get(form)?.get('input')?.({ target: { id: field } }); };
  return { work, edit, input, request, context };
}

describe('Callsigns imperative form participant', () => {
  it('saves both forms without clearing credential edits when callsign details are saved', async () => {
    const { work, edit, input, request } = callsigns();
    edit('callsign-form', 'callsign-description', 'Test description'); edit('credential-form', 'username', 'QG0TEST');
    input('password').value = 'fixture-secret'; // Untouched fields must not be sent.
    expect(work.isDirty()).toBe(true); expect(await work.save()).toBe(true); expect(work.isDirty()).toBe(false);
    expect(request.mock.calls).toHaveLength(2);
    const credential = request.mock.calls[1][0] as unknown as { credentials: { password?: string; username: string } };
    expect(credential.credentials.password).toBeUndefined(); expect(credential.credentials.username).toBe('QG0TEST');
    expect(input('password').value).toBe('');
  });

  it('keeps credentials on a failed or malformed save and keeps edits made while saving', async () => {
    const { work, edit, input, request } = callsigns();
    edit('credential-form', 'username', 'QG0TEST'); input('password').value = 'fixture-secret';
    request.mockRejectedValueOnce(new Error('unknown'));
    expect(await work.save()).toBe(false); expect(work.isDirty()).toBe(true); expect(input('password').value).toBe('fixture-secret');
    request.mockResolvedValueOnce({} as never);
    expect(await work.save()).toBe(false); expect(input('password').value).toBe('fixture-secret'); expect(work.isDirty()).toBe(true);
    let finish!: (value: never) => void;
    request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const saving = work.save(); edit('credential-form', 'username', 'QG1TEST'); finish({} as never);
    expect(await saving).toBe(false); expect(work.isDirty()).toBe(true);
  });
});

let Dialog: Component;
beforeAll(async () => {
  const source = readFileSync('packages/ui/ConfirmDialog.svelte', 'utf8');
  const compiled = compile(source, { generate: 'server', filename: 'ConfirmDialog.svelte' }).js.code;
  const code = compiled.replaceAll("'svelte/internal/server'", JSON.stringify(import.meta.resolve('svelte/internal/server')));
  Dialog = (await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))).default;
});

it('renders Save, Don’t save and Cancel as distinct native buttons with text-only tab names', () => {
  const props = { open: true, title: 'Save changes before closing?', message: 'Callsigns, Locations <test>', confirmLabel: 'Save', alternateLabel: "Don't save", onConfirm: vi.fn(), onAlternate: vi.fn(), onCancel: vi.fn() };
  const body = render(Dialog, { props }).body;
  expect(body).toContain('Callsigns, Locations &lt;test>');
  expect(body).toMatch(/<button[^>]*>Save<\/button>/);
  expect(body).toMatch(/<button[^>]*>Don't save<\/button>/);
  expect(body).toMatch(/<button[^>]*>Cancel<\/button>/);
  const ctx = script('packages/ui/ConfirmDialog.svelte', props, 'globalThis.subject = { onConfirm, onAlternate, onCancel };');
  ctx.subject.onConfirm(); ctx.subject.onAlternate(); ctx.subject.onCancel();
  expect(props.onConfirm).toHaveBeenCalledOnce(); expect(props.onAlternate).toHaveBeenCalledOnce(); expect(props.onCancel).toHaveBeenCalledOnce();
});

it('retains Focus Area choices across settings view unmounts and refuses an unknown or changed save', async () => {
  let finish!: (saved: boolean) => void;
  const save = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; }));
  const work = createAreaWork(save);
  work.choose(['US-ID']);
  const props = { work, area: [], most: 10, parksLoaded: false, onSave: save };
  const first = script('packages/renderer/pages/AreaCard.svelte', props,
    'globalThis.subject = { held: () => chosen };', { createAreaWork });
  expect(first.subject.held()).toEqual(['US-ID']);
  const second = script('packages/renderer/pages/AreaCard.svelte', props,
    'globalThis.subject = { held: () => chosen };', { createAreaWork });
  expect(second.subject.held()).toEqual(['US-ID']); expect(work.isDirty()).toBe(true);
  let saving = work.save(); finish(false); expect(await saving).toBe(false); expect(work.isDirty()).toBe(true);
  saving = work.save(); work.choose(['US-MT']); finish(true);
  expect(await saving).toBe(false); expect(work.chosen).toEqual(['US-MT']); expect(work.isDirty()).toBe(true);
  work.discard(); expect(work.isDirty()).toBe(false); expect(work.chosen).toBeUndefined();
});

it('the real extension switch invokes the close guard before sending an off request', async () => {
  const { createShellStore } = await import('../packages/renderer/shell-store.js');
  const shell = createShellStore(); shell.openExtension('test/page', 'test/page');
  const save = vi.fn(async () => false); const discard = vi.fn();
  shell.registerWork('ext:test/page', { isDirty: () => true, save, discard });
  const inventory = vi.fn(async () => ({ ok: true })); const refresh = vi.fn();
  const source = readFileSync('packages/renderer/app.ts', 'utf8');
  const file = ts.createSourceFile('app.ts', source, ts.ScriptTarget.Latest, true);
  const fn = file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'setExtensionEnabled');
  if (!fn) throw new Error('No extension switch');
  const context = { exports: {}, shell, window: { extensions: { inventory } }, home: { refresh }, takeExtensions: () => true };
  runInNewContext(ts.transpileModule(fn.getText(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
  const set = (context.exports as { setExtensionEnabled(id: string, enabled: boolean): Promise<boolean> }).setExtensionEnabled;
  let off = set('test', false); shell.answerClose('cancel');
  expect(await off).toBe(false); expect(inventory).not.toHaveBeenCalled(); expect(refresh).not.toHaveBeenCalled();
  off = set('test', false); shell.answerClose('save');
  expect(await off).toBe(false); expect(inventory).not.toHaveBeenCalled();
  off = set('test', false); shell.answerClose('discard');
  expect(await off).toBe(true); expect(discard).toHaveBeenCalledOnce(); expect(shell.get().tabs).not.toContain('ext:test/page');
  expect(inventory).toHaveBeenCalledWith({ type: 'set-enabled', id: 'test', enabled: false }); expect(refresh).toHaveBeenCalledOnce();
});

it('Callsigns retains an explicitly entered secret and its input intent through a failed save', async () => {
  const { work, edit, input, request } = callsigns();
  edit('callsign-form', 'callsign-description', 'Test description');
  edit('credential-form', 'username', 'QG0TEST');
  edit('credential-form', 'password', 'fixture-secret');
  request.mockImplementationOnce(async () => ({ callsigns: [{ id: 'fixture-id', call: '', description: 'Test description' }], active: null }));
  request.mockRejectedValueOnce(new Error('unknown'));
  expect(await work.save()).toBe(false); expect(work.isDirty()).toBe(true); expect(input('password').value).toBe('fixture-secret');
  expect(request.mock.calls).toHaveLength(2);
  expect(await work.save()).toBe(true);
  expect(request.mock.calls[2][0]).toMatchObject({ type: 'save-credentials', credentials: { password: 'fixture-secret' } });
  expect(input('password').value).toBe(''); expect(work.isDirty()).toBe(false);
});
