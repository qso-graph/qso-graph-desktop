// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import type { MenuItemConstructorOptions } from 'electron';
import { TAB_ACTIONS, tabMenu } from '../packages/main/tab-menu.js';
import { resourceName } from '../packages/main/policy.js';
import { createShellStore, shownTab } from '../packages/renderer/shell-store.js';
import { createTabKeyboard } from '../packages/renderer/tab-keyboard.js';
import { focusShownTab } from '../packages/ui/tab-focus.js';

function fixture(platform = 'linux') {
  const shell = createShellStore();
  shell.set({ page: 'callsigns' }); shell.set({ page: 'stations' });
  const focusShown = vi.fn(async () => {});
  const env = { platform, focusShown, blocked: () => false, editing: () => false, now: () => 100 };
  return { shell, env, keyboard: createTabKeyboard(shell, env), focusShown };
}

function key(key: string, modifiers: Partial<KeyboardEvent> = {}) {
  return { key, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false,
    repeat: false, isComposing: false, defaultPrevented: false, preventDefault: vi.fn(), ...modifiers } as unknown as KeyboardEvent;
}

describe('P14-tab-shortcuts (QGD-FRM-0028)', () => {
  it('switches in display order, wrapping both ways, independent of MRU', async () => {
    const { shell, keyboard } = fixture();
    shell.showTab('callsigns');
    await keyboard.action('next'); expect(shownTab(shell.get())).toBe('stations');
    await keyboard.action('next'); expect(shownTab(shell.get())).toBe('home');
    await keyboard.action('previous'); expect(shownTab(shell.get())).toBe('stations');
    await keyboard.action('previous'); expect(shownTab(shell.get())).toBe('callsigns');
    expect(shell.get().tabs).toEqual(['home', 'callsigns', 'stations']);
  });

  it('switches to the most recently shown open tab, including an area with an inner page', async () => {
    const { shell, keyboard } = fixture();
    shell.openExtension('test/one', 'test/one'); shell.openExtension('test/two', 'test/one');
    shell.showTab('callsigns');
    await keyboard.action('recent'); expect(shownTab(shell.get())).toBe('ext:test/one');
    expect(shell.get().extensionPage).toBe('test/two');
    await keyboard.action('recent'); expect(shownTab(shell.get())).toBe('callsigns');
    await shell.closeTab('ext:test/one');
    await keyboard.action('recent'); expect(shownTab(shell.get())).toBe('stations');
  });

  it('moves the shown tab one place each way without changing selection or MRU, stopping at the edges', async () => {
    const { shell, keyboard } = fixture(); shell.showTab('callsigns');
    const recent = shell.get().tabMru;
    await keyboard.action('move-right'); expect(shell.get().tabs).toEqual(['home', 'stations', 'callsigns']);
    await keyboard.action('move-right'); expect(shell.get().tabs).toEqual(['home', 'stations', 'callsigns']);
    await keyboard.action('move-left'); expect(shell.get().tabs).toEqual(['home', 'callsigns', 'stations']);
    await keyboard.action('move-left'); expect(shell.get().tabs).toEqual(['callsigns', 'home', 'stations']);
    await keyboard.action('move-left'); expect(shell.get().tabs).toEqual(['callsigns', 'home', 'stations']);
    expect(shownTab(shell.get())).toBe('callsigns'); expect(shell.get().tabMru).toEqual(recent);
  });

  it('closes the shown tab and focuses its MRU successor only after closing completes', async () => {
    const { shell, keyboard, focusShown } = fixture(); shell.showTab('home'); shell.showTab('stations');
    const closing = keyboard.action('close'); expect(focusShown).not.toHaveBeenCalled();
    await closing;
    expect(shell.get().tabs).toEqual(['home', 'callsigns']); expect(shownTab(shell.get())).toBe('home');
    expect(focusShown).toHaveBeenCalledOnce();
  });

  it('asks the step 2 question, keeps Cancel and failed saves, waits for confirmed Save and honors Discard', async () => {
    const { shell, keyboard, focusShown } = fixture();
    let dirty = true;
    const save = vi.fn(async () => false); const discard = vi.fn(() => { dirty = false; });
    shell.registerWork('stations', { isDirty: () => dirty, save, discard });
    let close = keyboard.action('close');
    expect(shell.get().closeQuestion).toEqual(['Locations']);
    await keyboard.action('next'); expect(shownTab(shell.get())).toBe('stations');
    shell.answerClose('cancel'); await close;
    expect(shell.get().tabs).toContain('stations'); expect(focusShown).not.toHaveBeenCalled();
    close = keyboard.action('close'); shell.answerClose('save'); await close;
    expect(save).toHaveBeenCalledOnce(); expect(shell.get().tabs).toContain('stations'); expect(focusShown).not.toHaveBeenCalled();
    let finish!: () => void;
    save.mockImplementationOnce(() => new Promise(resolve => { finish = () => { dirty = false; resolve(true); }; }));
    close = keyboard.action('close'); shell.answerClose('save'); await Promise.resolve();
    expect(shell.get().tabs).toContain('stations'); expect(focusShown).not.toHaveBeenCalled();
    finish(); await close; expect(shell.get().tabs).not.toContain('stations'); expect(focusShown).toHaveBeenCalledOnce();
    shell.set({ page: 'stations' }); dirty = true;
    close = keyboard.action('close'); shell.answerClose('discard'); await close;
    expect(discard).toHaveBeenCalledTimes(2); expect(shell.get().tabs).not.toContain('stations');
  });

  it('keeps a single tab usable and reopens Home when the last tab closes', async () => {
    const { shell, keyboard } = fixture(); await shell.closeAllTabs();
    for (const action of TAB_ACTIONS) { await keyboard.action(action); expect(shell.get().tabs).toEqual(['home']); }
  });

  it('ignores malformed actions and leaves modal focus and selection alone', async () => {
    const { shell, env, keyboard, focusShown } = fixture();
    for (const value of [null, {}, 'constructor', 'close-window']) await keyboard.action(value);
    env.blocked = () => true;
    for (const action of TAB_ACTIONS) await keyboard.action(action);
    expect(shownTab(shell.get())).toBe('stations'); expect(shell.get().tabs).toHaveLength(3);
    expect(focusShown).not.toHaveBeenCalled();
  });

  it('moves with both macOS chord directions, allowing modifier transitions', () => {
    const { shell, keyboard } = fixture('darwin'); shell.showTab('callsigns');
    const prefix = key('k', { metaKey: true }); keyboard.keydown(prefix);
    expect(prefix.preventDefault).toHaveBeenCalledOnce();
    keyboard.keydown(key('Shift', { metaKey: true, shiftKey: true }));
    const right = key('ArrowRight', { metaKey: true, shiftKey: true }); keyboard.keydown(right);
    expect(right.preventDefault).toHaveBeenCalledOnce(); expect(shell.get().tabs).toEqual(['home', 'stations', 'callsigns']);
    keyboard.keydown(key('K', { metaKey: true })); keyboard.keydown(key('ArrowLeft', { metaKey: true, shiftKey: true }));
    expect(shell.get().tabs).toEqual(['home', 'callsigns', 'stations']);
    const standalone = key('ArrowLeft', { metaKey: true, shiftKey: true }); keyboard.keydown(standalone);
    expect(standalone.preventDefault).not.toHaveBeenCalled();
  });

  it('cancels the macOS chord on timeout, unrelated input, blur, menu action, modal or entry into a field', async () => {
    for (const cancel of ['timeout', 'unrelated', 'blur', 'menu', 'modal', 'editing']) {
      const { shell, env, keyboard } = fixture('darwin'); shell.showTab('callsigns');
      keyboard.keydown(key('k', { metaKey: true }));
      if (cancel === 'timeout') env.now = () => 1601;
      if (cancel === 'unrelated') keyboard.keydown(key('x'));
      if (cancel === 'blur') keyboard.reset();
      if (cancel === 'menu') await keyboard.action('recent');
      if (cancel === 'modal' || cancel === 'editing') {
        env[cancel === 'modal' ? 'blocked' : 'editing'] = () => true;
        keyboard.keydown(key('a'));
        env.blocked = env.editing = () => false;
      }
      const before = shell.get().tabs;
      const second = key('ArrowRight', { metaKey: true, shiftKey: true }); keyboard.keydown(second);
      expect(second.preventDefault, cancel).not.toHaveBeenCalled(); expect(shell.get().tabs, cancel).toEqual(before);
    }
  });

  it('does not steal ordinary editing, Tab/Shift+Tab, native accelerators, compositions, repeats or wrong modifiers', () => {
    for (const platform of ['darwin', 'linux', 'win32']) {
      const { env, keyboard } = fixture(platform);
      for (const event of [key('Tab'), key('Tab', { shiftKey: true }), key('Home'), key('End'), key('ArrowRight'),
        key('Tab', { ctrlKey: true }), key('PageDown', { ctrlKey: true }), key('w', { metaKey: true }),
        key('k', { ctrlKey: true }), key('k', { metaKey: true, altKey: true }), key('k', { metaKey: true, shiftKey: true }),
        key('k', { metaKey: true, isComposing: true }), key('k', { metaKey: true, repeat: true }), key('k', { metaKey: true, defaultPrevented: true })]) {
        keyboard.keydown(event); expect(event.preventDefault).not.toHaveBeenCalled();
      }
      env.editing = () => true;
      const prefix = key('k', { metaKey: true }); keyboard.keydown(prefix);
      expect(prefix.preventDefault).not.toHaveBeenCalled();
      env.editing = () => false; env.blocked = () => true;
      const modalPrefix = key('k', { metaKey: true }); keyboard.keydown(modalPrefix);
      expect(modalPrefix.preventDefault).not.toHaveBeenCalled(); env.blocked = () => false;
      if (platform !== 'darwin') {
        env.editing = () => false;
        keyboard.keydown(prefix); keyboard.keydown(key('ArrowRight', { metaKey: true, shiftKey: true }));
        expect(prefix.preventDefault).not.toHaveBeenCalled();
      }
    }
  });
});

function source(path: string) { return ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true); }
function evaluate(code: string, context: Record<string, unknown>) {
  runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, context);
}
function declaration(path: string, name: string): string {
  const file = source(path); let found = '';
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === name) found = `const ${node.getText(file)};`;
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node.getText(file);
    ts.forEachChild(node, visit);
  }
  visit(file); if (!found) throw new Error(`Missing ${name} in ${path}`); return found;
}
function flatten(items: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  return items.flatMap(item => [item, ...(Array.isArray(item.submenu) ? flatten(item.submenu) : [])]);
}

describe('P14-tab-menu: actual main/preload/renderer delivery', () => {
  it.each(['darwin', 'linux', 'win32'])('registers native accelerators exactly once in the real %s application template, overriding Close Window', async platform => {
    const { shell, keyboard } = fixture(platform); shell.showTab('callsigns');
    let sent: Promise<void> = Promise.resolve();
    const send = (action: string) => { sent = keyboard.action(action); };
    const context = { menu: [] as MenuItemConstructorOptions[], mac: platform === 'darwin', process: { platform },
      Menu: { buildFromTemplate: (items: MenuItemConstructorOptions[]) => items }, tabMenu, sendTabAction: send,
      setupItem: (_action: string, label: string) => ({ label }), settingsItem: {}, checkForUpdates: {}, HELP_DOCUMENTS: [], extensionBroker: undefined };
    evaluate(declaration('packages/main/main.ts', 'applicationMenu') + '\nglobalThis.menu = applicationMenu();', context);
    const items = flatten(context.menu);
    expect(items.some(item => item.role === 'close' || item.role === 'windowMenu')).toBe(false);
    const expected = platform === 'darwin'
      ? ['Command+Alt+Right', 'Command+Alt+Left', 'Control+Tab', 'CmdOrCtrl+W', undefined, undefined]
      : ['Control+PageDown', 'Control+PageUp', 'Control+Tab', 'CmdOrCtrl+W', 'Control+Shift+PageDown', 'Control+Shift+PageUp'];
    for (const [index, action] of TAB_ACTIONS.entries()) {
      const matches = items.filter(item => item.id === `tab-${action}`); expect(matches).toHaveLength(1);
      expect(matches[0].accelerator).toBe(expected[index]);
    }
    if (platform === 'darwin') {
      expect(items.find(item => item.id === 'tab-move-right')?.label).toContain('⌘K, ⌘⇧→');
      expect(items.find(item => item.id === 'tab-move-left')?.label).toContain('⌘K, ⌘⇧←');
    }
    const click = async (action: string) => { items.find(item => item.id === `tab-${action}`)!.click!(undefined!, undefined!, undefined!); await sent; };
    await click('next'); expect(shownTab(shell.get())).toBe('stations');
    await click('previous'); expect(shownTab(shell.get())).toBe('callsigns');
    await click('recent'); expect(shownTab(shell.get())).toBe('stations');
    await click('move-left'); expect(shell.get().tabs).toEqual(['home', 'stations', 'callsigns']);
    await click('move-right'); expect(shell.get().tabs).toEqual(['home', 'callsigns', 'stations']);
    await click('close'); expect(shell.get().tabs).toEqual(['home', 'callsigns']);
  });

  it('sends only to the focused live shell, never a password window or an unfocused fallback', () => {
    const send = vi.fn(); let url = 'qg://desktop/index.html'; let destroyed = false;
    const window = { isDestroyed: () => destroyed, webContents: { getURL: () => url, send } };
    let focused: typeof window | null = window;
    const context = { BrowserWindow: { getFocusedWindow: () => focused }, resourceName, sendTabAction: undefined as unknown as (action: string) => void };
    evaluate(declaration('packages/main/main.ts', 'sendTabAction'), context);
    context.sendTabAction('close'); expect(send).toHaveBeenCalledWith('menu:tab', 'close'); send.mockClear();
    url = 'qg://lotw-password/index.html'; context.sendTabAction('close');
    url = 'qg://desktop/index.html'; destroyed = true; context.sendTabAction('close');
    focused = null; context.sendTabAction('close'); expect(send).not.toHaveBeenCalled();
  });

  it('the real sandbox preload admits only named actions, strips the event and removes its listener', () => {
    const exposed: Record<string, { onTab(listener: unknown): () => void }> = {};
    const handlers = new Map<string, (event: unknown, action: unknown) => void>();
    const file = source('packages/preload/preload.cts');
    evaluate(file.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(file)).join('\n'), {
      contextBridge: { exposeInMainWorld: (name: string, value: typeof exposed[string]) => { exposed[name] = value; } }, process: { platform: 'darwin' },
      ipcRenderer: { on: (name: string, handler: typeof handlers extends Map<string, infer V> ? V : never) => handlers.set(name, handler),
        removeListener: (name: string, handler: unknown) => { if (handlers.get(name) === handler) handlers.delete(name); } }
    });
    exposed.menu.onTab(null)(); expect(handlers.size).toBe(0);
    const listener = vi.fn(); const stop = exposed.menu.onTab(listener);
    const handler = handlers.get('menu:tab')!;
    for (const action of TAB_ACTIONS) handler({ sender: 'must not cross' }, action);
    expect(listener.mock.calls).toEqual(TAB_ACTIONS.map(action => [action]));
    for (const bad of [null, {}, [], 1, 'quit', 'close-window']) handler({}, bad);
    expect(listener).toHaveBeenCalledTimes(TAB_ACTIONS.length); stop(); expect(handlers.size).toBe(0);
  });

  it('the real renderer wires menu actions, text-entry protection and blur reset without a second accelerator listener', async () => {
    const { shell } = fixture('darwin'); shell.showTab('callsigns');
    const events = new Map<string, (event: KeyboardEvent) => void>(); let menu!: (action: string) => void;
    let active: { closest(selector: string): unknown } | null = null; let modal = false;
    const focus = vi.fn(async () => {});
    const context = { shell, PLATFORM: 'darwin', createTabKeyboard, focusShownTab: focus, performance: { now: () => 100 },
      document: { get activeElement() { return active; }, querySelector: () => modal ? {} : null },
      window: { menu: { onTab: (listener: typeof menu) => { menu = listener; } }, addEventListener: (name: string, listener: (event: KeyboardEvent) => void) => events.set(name, listener) } };
    const file = source('packages/renderer/app.ts');
    const wiring = file.statements.filter(node => ts.isExpressionStatement(node) && /^(window\.menu\?\.onTab|window\.addEventListener\('(keydown|blur)')/.test(node.getText(file)));
    evaluate(declaration('packages/renderer/app.ts', 'tabKeyboard') + wiring.map(node => node.getText(file)).join('\n'), context);
    expect(events.size).toBe(2); menu('next'); await Promise.resolve(); expect(shownTab(shell.get())).toBe('stations');
    for (const tag of ['input', 'textarea', 'select', '[role="textbox"]', '[contenteditable]']) {
      active = { closest: selector => selector.includes(tag) ? {} : null };
      const prefix = key('k', { metaKey: true }); events.get('keydown')!(prefix); expect(prefix.preventDefault).not.toHaveBeenCalled();
    }
    // Close Tab intentionally works while typing.
    menu('close'); await Promise.resolve(); expect(shell.get().tabs).not.toContain('stations');
    active = null; modal = true; menu('next'); expect(shownTab(shell.get())).toBe('callsigns');
    modal = false;
    const prefix = key('k', { metaKey: true }); events.get('keydown')!(prefix); expect(prefix.preventDefault).toHaveBeenCalled();
    events.get('blur')!(key('')); const second = key('ArrowLeft', { metaKey: true, shiftKey: true }); events.get('keydown')!(second);
    expect(second.preventDefault).not.toHaveBeenCalled();
  });
});

describe('P14-tab-focus (QGD-FRM-0028, QGD-FRM-0022)', () => {
  it('waits for rendering, focuses the roving tab and scrolls it into view without scrolling the document', async () => {
    const focus = vi.fn(); const scrollIntoView = vi.fn(); const querySelector = vi.fn(() => ({ focus, scrollIntoView }));
    const focused = focusShownTab({ querySelector } as unknown as ParentNode);
    expect(querySelector).not.toHaveBeenCalled(); await focused;
    expect(querySelector).toHaveBeenCalledWith('[role="tab"][tabindex="0"]');
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
    await expect(focusShownTab(undefined)).resolves.toBeUndefined();
  });

  it('the actual tab bar waits for close and leaves Tab/Shift+Tab free to reach other landmarks and controls', async () => {
    const file = readFileSync('packages/ui/DestinationTabs.svelte', 'utf8');
    const body = ts.createSourceFile('tabs.ts', file.match(/<script lang="ts">([\s\S]*?)<\/script>/)![1], ts.ScriptTarget.Latest, true);
    const focus = vi.fn(async () => {}); let finish!: () => void;
    const context = { $props: () => ({ tabs: [{ id: 'home' }], current: 'home' }), $derived: (value: unknown) => value, $state: () => undefined,
      focusShownTab: focus, close: undefined as unknown as (action: () => Promise<void>) => Promise<void>, onKeydown: undefined as unknown as (event: KeyboardEvent, id: string) => void };
    evaluate(body.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(body)).join('\n'), context);
    const closing = context.close(() => new Promise(resolve => { finish = resolve; }));
    expect(focus).not.toHaveBeenCalled(); finish(); await closing; expect(focus).toHaveBeenCalledOnce();
    for (const shiftKey of [false, true]) { const tab = key('Tab', { shiftKey }); context.onKeydown(tab, 'home'); expect(tab.preventDefault).not.toHaveBeenCalled(); }
    expect(readFileSync('packages/renderer/Shell.svelte', 'utf8')).toContain('<header>');
    const status = readFileSync('packages/ui/StatusBar.svelte', 'utf8');
    expect(status).toMatch(/<button[^>]+id="open-troubleshooting"/);
    expect(status).not.toMatch(/tabindex="-1"/);
  });
});
