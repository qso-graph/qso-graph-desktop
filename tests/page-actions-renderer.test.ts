// SPDX-License-Identifier: GPL-3.0-or-later
// Render the real Svelte components without a display. Interactive keyboard
// and axe coverage also run in the window suite in CI.
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createServer, type ViteDevServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
let renderPage: typeof import('svelte/server').render;
import type { Component } from 'svelte';
import type { HomeModel } from '../packages/renderer/home-store.js';
let server: ViteDevServer;
let Page: Component;
beforeAll(async () => {
  server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false }, plugins: [svelte({ configFile: false })], appType: 'custom' });
  Page = (await server.ssrLoadModule('/packages/renderer/pages/ExtensionPage.svelte')).default;
  renderPage = (await server.ssrLoadModule('svelte/server')).render;
});
afterAll(async () => { await server?.close(); });
const page: NonNullable<HomeModel['page']> = {
  key: 'lotw/certificates', name: 'Certificates', area: 'lotw/certificates', areaName: 'Certificates', hue: 'general', network: false,
  inputs: [], values: {}, tabs: [], views: [], settings: [],
  actions: [{ id: 'load', label: 'Load certificate…' }, { id: 'restore', label: 'Restore TQSL backup…' }], rowActions: [{ id: 'delete', label: 'Delete…' }],
  shown: { state: 'ready', observedAt: '2026-11-09T12:00:00Z', sections: [{ shape: 'table', columns: ['Call', 'Key'],
    rows: [{ key: 'opaque-never-drawn', cells: ['QG0TEST', 'Key: installed'] }, ['QG1TEST', 'Key: not installed']] }] }
};
const html = (extra: Partial<typeof page> = {}) => renderPage(Page, { props: { page: { ...page, ...extra }, extensionName: 'LoTW', onAction: () => {} } }).body;
const buttons = (body: string) => [...body.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)]
  .filter(match => /Load certificate|Restore TQSL|Delete…/.test(match[2]));
describe('core-drawn action controls', () => {
  it('wraps an unbroken action status within the page', () => {
    const body = html({ actionStatus: 'x'.repeat(240) });
    expect(body).toMatch(/<p class="page-action-status" role="status">x{240}<\/p>/);
    const css = readFileSync(new URL('../packages/renderer/style.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.page-action-status\s*\{[^}]*overflow-wrap:\s*anywhere\s*;/);
  });
  it('renders manifest buttons as named native controls and puts row actions only on keyed rows', () => {
    const body = html(); const controls = buttons(body);
    expect(controls).toHaveLength(3);
    for (const button of controls) { expect(button[1]).toContain('type="button"'); expect(button[1]).not.toContain('disabled'); expect(button[1]).not.toContain('tabindex="-1"'); }
    expect(controls[2][1]).toContain('aria-label="Delete… QG0TEST"');
    expect(body).not.toContain('opaque-never-drawn');
    expect(body).not.toContain('aria-label="Delete… QG1TEST"');
  });
  it('disables all page and row actions while running and exposes a live status line', () => {
    const running = html({ actionRunning: true });
    expect(buttons(running)).toHaveLength(3);
    for (const button of buttons(running)) expect(button[1]).toContain('disabled');
    expect(running).toContain('role="status">Working…');
    expect(html({ actionStatus: 'Deleted 1 certificate(s).' })).toContain('role="status">Deleted 1 certificate(s).');
  });
});
