// SPDX-License-Identifier: GPL-3.0-only
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { PAGES, INITIAL_SHELL, createShellStore, isPageId, type ShellState } from '../src/renderer/shell-store.js';

describe('the shell store', () => {
  it('starts on Home with no active persona and the system theme', () => {
    expect(INITIAL_SHELL).toEqual({
      page: 'home', activePersona: '', themeChoice: 'system', logs: undefined, engine: undefined,
      // Not setup: that is decided once the personas have been read, so a
      // machine with personas never sees a frame of the setup screen
      // (QGD-PSN-0004).
      setup: false, firstRun: false, services: []
    });
    expect(createShellStore().get()).toEqual(INITIAL_SHELL);
  });

  it('calls a new subscriber immediately, so nothing renders a frame of defaults', () => {
    const store = createShellStore({ ...INITIAL_SHELL, page: 'settings' });
    const seen: ShellState[] = [];
    store.subscribe(state => seen.push(state));
    expect(seen).toHaveLength(1);
    expect(seen[0].page).toBe('settings');
  });

  it('publishes a change to every subscriber', () => {
    const store = createShellStore();
    const first: string[] = [];
    const second: string[] = [];
    store.subscribe(state => first.push(state.page));
    store.subscribe(state => second.push(state.page));
    store.set({ page: 'settings' });
    expect(first).toEqual(['home', 'settings']);
    expect(second).toEqual(['home', 'settings']);
  });

  it('merges rather than replaces, so one writer does not erase another', () => {
    const store = createShellStore();
    store.set({ activePersona: 'W1AW · Home station' });
    store.set({ page: 'settings' });
    expect(store.get()).toMatchObject({
      page: 'settings', activePersona: 'W1AW · Home station', themeChoice: 'system'
    });
  });

  it('publishes nothing when nothing moved', () => {
    // app.ts reports the active persona on every list refresh, which is most of
    // them, and the same value must not redraw the shell.
    const store = createShellStore();
    let notifications = 0;
    store.subscribe(() => { notifications += 1; });
    expect(notifications).toBe(1);
    store.set({ page: 'home' });
    store.set({ activePersona: '' });
    store.set({});
    expect(notifications).toBe(1);
    store.set({ page: 'settings' });
    expect(notifications).toBe(2);
  });

  it('stops notifying after unsubscribe', () => {
    const store = createShellStore();
    const seen: string[] = [];
    const stop = store.subscribe(state => seen.push(state.page));
    stop();
    store.set({ page: 'settings' });
    expect(seen).toEqual(['home']);
  });

  it('survives a subscriber that unsubscribes while being notified', () => {
    // Iterating the live set would skip the second listener here. The first
    // unsubscribes on the change rather than on the immediate call, because
    // subscribe notifies before it has returned anything to unsubscribe with.
    const store = createShellStore();
    const seen: string[] = [];
    let stop = () => {};
    let calls = 0;
    stop = store.subscribe(() => { calls += 1; if (calls > 1) stop(); });
    store.subscribe(state => seen.push(state.page));
    store.set({ page: 'settings' });
    expect(calls).toBe(2);
    expect(seen).toEqual(['home', 'settings']);
    store.set({ page: 'home' });
    expect(calls).toBe(2);
  });

  it('does not return the same object after a change', () => {
    const store = createShellStore();
    const before = store.get();
    store.set({ page: 'settings' });
    expect(store.get()).not.toBe(before);
    expect(before.page).toBe('home');
  });
});

describe('the rail', () => {
  it('offers Personas and Settings, in that order', () => {
    // QGD-LOG-0013 puts the Logs page inside Settings, so it is not a third
    // rail item and this list is the whole of the navigation.
    expect(PAGES.map(page => page.id)).toEqual(['home', 'personas', 'settings']);
    expect(PAGES.map(page => page.label)).toEqual(['Home', 'Personas', 'Settings']);
    // Home at the top, Settings at the foot: it is where you change how the
    // places you work behave, not one of them.
    expect(PAGES[0].placement).toBe('top');
    expect(PAGES.at(-1)?.placement).toBe('bottom');
  });

  it('accepts only a page that exists', () => {
    for (const page of PAGES) expect(isPageId(page.id)).toBe(true);
    for (const value of ['logs', 'Personas', '', '__proto__', 'constructor', 'toString', 0, null, undefined, {}]) {
      expect(isPageId(value), `${String(value)} must not be a page`).toBe(false);
    }
  });
});

describe('P3-personas-intact: the P1 screen moved without changing', () => {
  it('still carries every element app.ts looks for', async () => {
    // Read out of app.ts rather than listed here, so renaming an element in
    // one file and not the other fails this test instead of the application.
    const app = await readFile('src/renderer/app.ts', 'utf8');
    const page = await readFile('src/renderer/pages/PersonaPage.svelte', 'utf8');
    const looked = new Set<string>();
    for (const match of app.matchAll(/\b(?:element|input)(?:<[^>]*>)?\('([a-z0-9-]+)'\)/g)) {
      looked.add(match[1]);
    }
    // The ids app.ts builds from a template literal, which the scan above
    // cannot see: element(`${id}-saved`) and element(`remove-${id}`).
    for (const id of ['password-saved', 'api-key-saved', 'remove-password', 'remove-api-key']) looked.add(id);
    expect(looked.size).toBeGreaterThan(15);

    // active-persona is the status bar's, which is StatusBar.svelte now and
    // reached through the store rather than the document.
    expect(app).not.toMatch(/element\('active-persona'\)/);

    const missing = [...looked].filter(id => !page.includes(`id="${id}"`)).sort();
    expect(missing).toEqual([]);
  });

  it('keeps the labels and roles the packaged suite drives it by', async () => {
    const page = await readFile('src/renderer/pages/PersonaPage.svelte', 'utf8');
    for (const label of ['Persona name', 'Callsign', 'Username', 'Password', 'API key',
                         'Service', 'Preferred credential', 'Start date', 'End date']) {
      expect(page, `${label} must still label a field`).toContain(label);
    }
    for (const name of ['Create persona', 'Use this persona', 'Save in Keychain', 'Test credential',
                        'Remove persona', 'Remove password', 'Remove API key', 'Remove saved credential']) {
      expect(page, `${name} must still name a button`).toContain(name);
    }
    expect(page).toContain('aria-labelledby="identity-title"');
    expect(page).toContain('aria-labelledby="credentials-title"');
  });

  it('holds no behaviour of its own', async () => {
    // app.ts owns this screen. A handler appearing here would mean two owners.
    const page = await readFile('src/renderer/pages/PersonaPage.svelte', 'utf8');
    expect(page).not.toMatch(/\bon(?:click|submit|change|input)=/);
    expect(page).not.toContain('$state');
    expect(page).not.toContain('$props');
  });
});

describe('one page, one framework, one Svelte configuration', () => {
  it('mounts the shell into a body that holds no markup of its own', async () => {
    const html = await readFile('src/renderer/index.html', 'utf8');
    const body = html.slice(html.indexOf('<body>') + '<body>'.length, html.indexOf('</body>'));
    // Comments only: anything else is markup the shell does not own.
    expect(body.replace(/<!--[\s\S]*?-->/g, '').trim()).toBe('');
    const app = await readFile('src/renderer/app.ts', 'utf8');
    expect(app).toContain("mount(Shell, {");
  });

  it('builds the application and the gallery from the same Svelte config', async () => {
    // vite-plugin-svelte looks beside the Vite root, which is src/renderer, so
    // without an explicit configFile the application silently used the plugin
    // defaults while the gallery used svelte.config.js.
    const vite = await readFile('vite.config.mjs', 'utf8');
    expect(vite).toContain('svelte.config.js');
    expect(vite).toContain('configFile');
    const config = await readFile('svelte.config.js', 'utf8');
    expect(config).toContain('runes: true');
    expect(config).toContain('vitePreprocess');
  });

  it('keeps the content policy intact after the framework arrived', async () => {
    // QGD-SEC-0008: Svelte must not have brought an inline script or style with
    // it, and the policy that would have refused one is unchanged.
    const html = await readFile('src/renderer/index.html', 'utf8');
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("script-src 'self'");
    expect(html).toContain("style-src 'self'");
    expect(html).not.toContain('unsafe-inline');
    expect(html).not.toContain('unsafe-eval');
  });
});

describe('QGD-CRD-0003: a fixture persona cannot collide with a real one', () => {
  it('names every suite persona in the reserved qg- space', async () => {
    // The credential core keys Keychain entries by the service and
    // `persona:provider`. The profile directory is NOT part of that key, so a
    // temporary profile does not isolate a suite's persona from the operator's
    // own. A fixture called "Home station" — which is the placeholder text in
    // the persona name field — read the operator's saved credentials into a
    // screenshot baseline and could have raised a Keychain prompt in the
    // middle of a verification run.
    //
    // Reserved rather than remembered: every persona a suite creates starts
    // with qg-, which no operator would type.
    const { readdir, readFile } = await import('node:fs/promises');
    const names: { file: string; name: string }[] = [];
    for (const file of await readdir('scripts')) {
      if (!file.endsWith('.mjs')) continue;
      const text = await readFile(`scripts/${file}`, 'utf8');
      for (const match of text.matchAll(/\bconst\s+(?:persona|PERSONA)\s*=\s*(.+)/g)) {
        const literal = /`([^`]*)`/.exec(match[1]) ?? /name:\s*'([^']*)'/.exec(match[1]) ?? /'([^']*)'/.exec(match[1]);
        if (literal) names.push({ file, name: literal[1] });
      }
    }
    expect(names.length, 'the scan must be finding the suites that create personas').toBeGreaterThan(5);
    for (const { file, name } of names) {
      expect(name.startsWith('qg-'), `${file} names a persona "${name}", outside the reserved qg- space`).toBe(true);
    }
  });
});

describe('QGD-PSN-0004 guided setup', () => {
  it('is off until the personas have been read', () => {
    // A shell that opened on setup and then swapped to the list would show
    // setup for a frame to somebody who already has personas.
    expect(createShellStore().get().setup).toBe(false);
  });

  it('is entered from the offer and left by finishing', () => {
    const store = createShellStore();
    store.beginSetup();
    expect(store.get().setup).toBe(true);
    store.endSetup();
    expect(store.get().setup).toBe(false);
  });

  it('offers setup only on a machine with no personas', () => {
    const store = createShellStore();
    expect(store.get().firstRun, 'not before the personas have been read').toBe(false);
    store.set({ firstRun: true });
    // Entering setup does not withdraw the offer, because leaving setup
    // without making a persona has to come back to it.
    store.beginSetup();
    expect(store.get().firstRun).toBe(true);
  });

  it('tells its subscriber when setup ends, and not when it has already ended', () => {
    const store = createShellStore();
    store.beginSetup();
    const seen: boolean[] = [];
    store.subscribe(state => seen.push(state.setup));
    store.endSetup();
    store.endSetup();
    // The first is the immediate call, the second the change. The third
    // endSetup publishes nothing, because nothing moved.
    expect(seen).toEqual([true, false]);
  });
});
