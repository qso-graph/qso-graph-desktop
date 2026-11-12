// SPDX-License-Identifier: GPL-3.0-or-later
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { compile } from 'svelte/compiler';
import type { Component } from 'svelte';
import { createServer, type ViteDevServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { isSettingsTab, readSettings, validateSettingsCommand } from '../packages/main/settings-contract.js';
import { createShellStore } from '../packages/renderer/shell-store.js';
import { createSettingsTabSession } from '../packages/renderer/settings-tab-session.js';
import { RESOURCES_NOT_LOADED } from '../packages/renderer/pages/reference-fixtures.js';
const read = (path: string) => readFileSync(path, 'utf8');
const source = () => read('packages/renderer/pages/SettingsPage.svelte');
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

it('validates the persisted tab strictly on reads and writes', () => {
  for (const value of ['general', 'data-sources', 'extensions']) {
    expect(isSettingsTab(value)).toBe(true);
    expect(readSettings({ settingsTab: value }).settingsTab).toBe(value);
    expect(validateSettingsCommand({ type: 'write', key: 'settingsTab', value })).toBe(true);
  }
  for (const value of [undefined, null, true, 1, '', 'General', ' general', 'extensions ', 'constructor', [], ['general'], { tab: 'general' }]) {
    expect(isSettingsTab(value)).toBe(false);
    expect(readSettings({ settingsTab: value }).settingsTab).toBe('general');
    expect(validateSettingsCommand({ type: 'write', key: 'settingsTab', value })).toBe(false);
  }
  expect(readSettings(Object.create({ settingsTab: 'extensions' })).settingsTab).toBe('general');
});
it('restores the last tab across restart without navigating or writing at startup', async () => {
  let saved = 'general';
  const shell = createShellStore(); const write = vi.fn(async tab => { saved = tab; });
  const session = createSettingsTabSession(shell, write);
  shell.set({ themeChoice: 'light' }); await flush(); expect(write).not.toHaveBeenCalled();
  session.restore('data-sources'); await session.settled();
  expect(shell.get().settingsTab).toBe('data-sources'); expect(shell.get().page).toBe('home');
  expect(write).not.toHaveBeenCalled();
  shell.set({ settingsTab: 'extensions' }); await session.settled(); expect(saved).toBe('extensions');
  shell.set({ page: 'settings' }); shell.set({ page: 'home' }); await session.settled(); expect(write).toHaveBeenCalledTimes(1);
  const next = createShellStore(); const restarted = createSettingsTabSession(next, write); restarted.restore(saved);
  expect(next.get().settingsTab).toBe('extensions');
  session.stop(); restarted.stop();
});
it('keeps explicit deep links and choices ahead of a delayed startup reply', async () => {
  for (const tab of ['general', 'extensions'] as const) {
    const shell = createShellStore(); const write = vi.fn(async () => true);
    const session = createSettingsTabSession(shell, write);
    shell.set({ page: 'settings', settingsTab: tab }); session.restore('data-sources'); await session.settled();
    expect(shell.get().settingsTab).toBe(tab); expect(write).toHaveBeenCalledWith(tab); session.stop();
  }
});
it('refuses an invalid restored tab and can persist after an unavailable startup read', async () => {
  for (const value of [undefined, 'General', { tab: 'extensions' }]) {
    const shell = createShellStore(); const write = vi.fn(async () => true);
    const session = createSettingsTabSession(shell, write); session.restore(value);
    expect(shell.get().settingsTab).toBe('general');
    shell.set({ settingsTab: 'extensions' }); await session.settled(); expect(write).toHaveBeenCalledWith('extensions');
    session.restore('data-sources'); expect(shell.get().settingsTab).toBe('extensions'); session.stop();
  }
});
it('serializes rapid choices and continues after a failed write', async () => {
  const shell = createShellStore(); let done!: () => void;
  const write = vi.fn().mockImplementationOnce(() => new Promise(resolve => { done = () => resolve(true); }))
    .mockRejectedValueOnce(new Error('unavailable')).mockResolvedValue(true);
  const session = createSettingsTabSession(shell, write); session.restore('general');
  shell.set({ settingsTab: 'extensions' }); await flush();
  shell.set({ settingsTab: 'data-sources' }); shell.set({ settingsTab: 'general' }); await flush();
  expect(write).toHaveBeenCalledTimes(1); done(); await expect(session.settled()).resolves.toBe(true);
  expect(write.mock.calls).toEqual([['extensions'], ['data-sources'], ['general']]); session.stop();
});

let server: ViteDevServer; let Page: Component; let render: typeof import('svelte/server').render;
beforeAll(async () => {
  server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false }, plugins: [svelte({ configFile: false })], appType: 'custom' });
  Page = (await server.ssrLoadModule('/packages/renderer/pages/SettingsPage.svelte')).default;
  render = (await server.ssrLoadModule('svelte/server')).render;
});
afterAll(async () => { await server?.close(); });
const html = (tab: string) => render(Page, { props: { tab, themeChoice: 'dark', onChooseTheme: async () => true,
  extensions: [{ id: 'fixture', name: 'Fixture extension', pages: ['Fixture page'], enabled: false, grants: ['secret:fixture'] }],
  refusedExtensions: [{ folder: 'Fixture refused', reason: 'Not allowed' }],
  storage: { state: 'ready', reference: { resources: [...RESOURCES_NOT_LOADED, { ...RESOURCES_NOT_LOADED[0], id: 'fixture-dataset', name: 'Fixture dataset' }] } }
} }).body;
const panel = (body: string, id: string) => {
  const match = body.match(new RegExp(`<div role="tabpanel" id="settings-panel-${id}"([^>]*)>([\\s\\S]*?)(?=<div role="tabpanel"|$)`));
  if (!match) throw new Error(`Missing panel ${id}`);
  return { attrs: match[1], body: match[2] };
};
it('groups all existing content by type, drawing every resource and no official grants', () => {
  const body = html('general'); const general = panel(body, 'general'); const data = panel(body, 'data-sources'); const extensions = panel(body, 'extensions');
  for (const text of ['About QSO Graph Desktop', 'Appearance', 'updates-title', 'backup-export', 'backup-import']) expect(general.body).toContain(text);
  for (const text of ['Reference data', ...RESOURCES_NOT_LOADED.map(row => row.name), 'Fixture dataset']) expect(data.body).toContain(text);
  for (const text of ['Fixture extension', 'role="switch"', 'Not loaded', 'Fixture refused', 'Not allowed']) expect(extensions.body).toContain(text);
  expect(general.body).not.toContain('data-resource='); expect(data.body).not.toContain('data-extension='); expect(extensions.body).not.toContain('backup-export');
  expect(body).not.toContain('secret:fixture');
});
it('exposes three named tabs with matching labelled panels and only one selected tab stop', () => {
  for (const tab of ['general', 'data-sources', 'extensions']) {
    const body = html(tab);
    expect(body).toContain('role="tablist" aria-label="Settings"');
    expect(body.match(/role="tab"/g)).toHaveLength(3);
    for (const label of ['General', 'Data sources', 'Extensions']) expect(body).toContain(`>${label}</button>`);
    expect(body.match(/aria-selected="true" tabindex="0"/g)).toHaveLength(1);
    for (const id of ['general', 'data-sources', 'extensions']) {
      expect(body).toContain(`id="settings-tab-${id}" aria-controls="settings-panel-${id}" aria-selected="${id === tab}" tabindex="${id === tab ? 0 : -1}"`);
      expect(panel(body, id).attrs).toContain(`aria-labelledby="settings-tab-${id}"`);
      expect(panel(body, id).attrs.includes('hidden')).toBe(id !== tab);
    }
  }
});
function keyboard() {
  const file = ts.createSourceFile('page.ts', source().match(/<script lang="ts">([\s\S]*?)<\/script>/)![1], ts.ScriptTarget.Latest, true);
  const code = file.statements.filter(node => ts.isFunctionDeclaration(node) && ['showTab', 'tabKey'].includes(node.name?.text ?? '')).map(node => node.getText(file)).join('\n');
  const onShowTab = vi.fn(); const focusShownTab = vi.fn();
  const context = { SETTINGS_TABS: ['general', 'data-sources', 'extensions'], tab: 'general', tablist: {}, onShowTab, focusShownTab };
  runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { ...context, getTab: () => context.tab, key: (context as unknown as { tabKey: (event: unknown, id: string) => void }).tabKey };
}
it('uses the destination tab keyboard pattern for arrows, wrapping, Home and End', () => {
  const { key, getTab, onShowTab, focusShownTab } = keyboard();
  for (const [pressed, from, to] of [['ArrowLeft', 'general', 'extensions'], ['ArrowUp', 'extensions', 'data-sources'], ['ArrowRight', 'extensions', 'general'], ['ArrowDown', 'general', 'data-sources'], ['Home', 'extensions', 'general'], ['End', 'general', 'extensions']]) {
    const preventDefault = vi.fn(); key({ key: pressed, preventDefault }, from);
    expect(getTab()).toBe(to); expect(onShowTab).toHaveBeenLastCalledWith(to); expect(preventDefault).toHaveBeenCalledOnce(); expect(focusShownTab).toHaveBeenCalled();
  }
  onShowTab.mockClear();
  for (const event of [{ key: 'Tab' }, { key: 'ArrowLeft', ctrlKey: true }, { key: 'ArrowLeft', metaKey: true }, { key: 'ArrowLeft', altKey: true }, { key: 'ArrowLeft', shiftKey: true }]) key({ ...event, preventDefault: vi.fn() }, 'general');
  expect(onShowTab).not.toHaveBeenCalled();
  const ast = compile(source(), { generate: false, modernAst: true }).ast;
  expect(JSON.stringify(ast)).toContain('onclick');
  expect(source()).toContain('onclick={() => showTab(id)}');
});
it('routes real menu actions to the matching tab and keeps Settings itself on the last tab', () => {
  const file = read('packages/renderer/app.ts');
  const handler = file.slice(file.indexOf('window.menu?.onSetup?.(action => {'), file.indexOf('\nasync function syncTqsl'));
  let callback!: (action: string) => void;
  const shell = createShellStore();
  runInNewContext(handler, { window: { menu: { onSetup: (fn: typeof callback) => { callback = fn; } } }, shell,
    requestAnimationFrame: (fn: () => void) => fn(), document: { getElementById: () => ({ scrollIntoView() {}, focus() {} }) }, updateReference: vi.fn() });
  for (const [action, tab] of [['about', 'general'], ['updates', 'general'], ['export-callsigns', 'general'], ['import-callsigns', 'general'], ['adif', 'data-sources'], ['pota', 'data-sources'], ['sota', 'data-sources']]) {
    shell.set({ page: 'home', settingsTab: 'extensions' }); callback(action);
    expect(shell.get().page).toBe('settings'); expect(shell.get().settingsTab).toBe(tab);
  }
  shell.set({ settingsTab: 'extensions' }); callback('settings'); expect(shell.get().settingsTab).toBe('extensions');
  expect(file).toContain('settingsTabSession.restore(reply.ok ? reply.data.settingsTab : undefined)');
  expect(file).toContain("key: 'settingsTab', value: tab");
});
it('wires Home welcome, area download and tab clicks to the shared selection', () => {
  const shell = createShellStore(); const text = read('packages/renderer/Shell.svelte');
  const handler = text.match(/onGo=\{place => \{([\s\S]*?)\n        \}\}/)![1];
  runInNewContext(handler, { place: 'extensions', store: shell, requestAnimationFrame: () => {} });
  expect(shell.get().page).toBe('settings'); expect(shell.get().settingsTab).toBe('extensions');
  expect(text).toContain("onDownloadParks={() => { store.set({ page: 'settings', extensionPage: null, settingsTab: 'data-sources' });");
  expect(text).toContain('tab={shell.settingsTab} onShowTab={settingsTab => store.set({ settingsTab })}');
});
it('keeps both Settings screenshot families and the Conditions containment check on the matching tabs', () => {
  const text = read('scripts/screenshots.mjs');
  expect(text).toContain("if (name === 'Settings') await page.getByRole('tab', { name: 'General', exact: true }).click();");
  expect(text).toContain("await page.getByRole('tab', { name: 'Data sources', exact: true }).click();\n  await expect.poll");
  const capture = text.slice(text.indexOf('// Extensions has its own inner tab'), text.indexOf('// "Customize your pins"'));
  expect(capture.indexOf("name: 'Extensions'")).toBeGreaterThan(0);
  expect(capture.indexOf("name: 'Extensions'")).toBeLessThan(capture.indexOf('await record('));
  expect(capture).toContain('`settings-extensions-${theme}.png`');
  expect(capture).toContain('switchBox.y + switchBox.height <= VIEW.height');
});
