// SPDX-License-Identifier: GPL-3.0-only
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  hardCodedHosts, violations, NETWORK_EXCEPTIONS, NETWORK_MODULE, productSources
} from '../scripts/network-static.mjs';

describe('QGD-CRD-0007 static gate', () => {
  // The three that evaded the regex this replaced, plus the rest of the surface.
  it.each([
    ["import { net } from 'electron';\nnet.request('https://example.invalid/');", 'electron net'],
    ["import https from 'https';\nhttps.get('https://example.invalid/');", 'unprefixed https'],
    ['fetch ("https://example.invalid/");', 'fetch with a space'],
    ["import http from 'node:http';", 'prefixed http'],
    ["const net = require('net');", 'require net'],
    ["await import('node:tls');", 'dynamic import of tls'],
    ["await import('https://example.invalid/x.js');", 'import over the network'],
    ['new WebSocket("wss://example.invalid/");', 'WebSocket'],
    ['new XMLHttpRequest();', 'XMLHttpRequest'],
    ['new EventSource("https://example.invalid/");', 'EventSource'],
    ['navigator.sendBeacon("https://example.invalid/", "x");', 'sendBeacon'],
    ['window["fetch"]("https://example.invalid/");', 'bracket access'],
    ["import { netLog } from 'electron';", 'electron netLog'],
    ["import {\n  get\n} from 'node:https';\nget(url);", 'multiline import'],
    ["import {\n  net\n} from 'electron';", 'multiline electron import'],
    ['const text = `${JSON.stringify({}) + fetch(url)}`;', 'fetch after an object literal in a template hole'],
    ['const text = `${ { a: `${fetch(url)}` } }`;', 'fetch in a nested template hole'],
    ['const text = `${ /* don\'t cache */ fetch(url) }`;', 'fetch behind an apostrophe in a comment in a template hole'],
    ["import {\n  get /* /* xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx */ */\n} from 'node:https';", 'import whose comment runs past any character bound'],
    ["const pattern = /'/;\nfetch(url);", 'fetch after a regex literal containing a quote'],
    ['const text = `${ // note\n fetch(url) }`;', 'fetch after a line comment in a template hole'],
    ["import { net as alias } from 'electron';", 'renamed electron networking import'],
    ['require(`node:https`);', 'a template-literal module specifier'],
    ['globalThis[`fetch`](url);', 'a template-literal property name'],
    ['self.importScripts(url);', 'importScripts as a property'],
    ["self['importScripts'](url);", 'importScripts by string key'],
    ["import { get as from } from 'node:https';\nfrom(url);", 'an import binding aliased to from'],
    ["const { netLog } = require('electron');\nnetLog.startLogging(path);", 'netLog destructured from a require'],
    ['electron.netLog.startLogging(path);', 'netLog reached as a property'],
    ["import https from 'node:https'\nexport { join } from 'node:path';\nhttps.get(url);", 'a semicolonless import followed by a re-export'],
    ["import https from 'node:https'\nimport { join } from 'node:path';", 'a semicolonless import followed by another import'],
    ["export { get } from 'node:https';", 'a networking re-export'],
    ["export * from 'node:net';", 'a star re-export of a networking module'],
    ["import { join } from 'node:path'\nexport { get } from 'node:https';", 'a safe import then a networking re-export'],
    ["export { net } from 'electron';", "a re-export of electron's networking"],
    ["export { join } from 'node:path'\nfetch(url);", 'a call after a semicolonless re-export'],
    ["import { join } from 'node:path'\nfetch(url);", 'a call after a semicolonless import'],
    ["import './side-effect.js'\nfetch(url);", 'a call after a semicolonless side-effect import'],
    ["export * from './safe.js'\nnew WebSocket(url);", 'a client after a semicolonless star re-export']
  ])('catches %#: %s', source => {
    expect(violations(source).length).toBeGreaterThan(0);
  });

  it.each([
    ["import { net } from './settings.js';\nimport { app } from 'electron';", 'a net import from a local module, then an electron import'],
    ['const text = "fetch(url)";', 'a call inside a string'],
    ['// fetch(url)', 'a call inside a line comment'],
    ['/* fetch(url) */', 'a call inside a block comment'],
    ['const text = `fetch(url)`;', 'a call inside template text'],
    ["import { app } from 'electron';\nimport { join } from 'node:path';", 'ordinary imports'],
    ['const pattern = /fetch\\(/;', 'a call inside a regex literal'],
    ['export const limit = 1;\nexport default limit;', 'ordinary exports'],
    ["export { join } from 'node:path';", 'a re-export of a safe module']
  ])('does not flag %#: %s', source => {
    expect(violations(source)).toEqual([]);
  });

  it('does not flag the in-process resource scheme the product actually uses', () => {
    expect(violations("protocol.handle('qg', async request => new Response(null, { status: 403 }));")).toEqual([]);
    expect(violations("void window.loadURL('qg://desktop/index.html');")).toEqual([]);
    expect(violations("session.defaultSession.webRequest.onBeforeRequest((d, cb) => cb({ cancel: true }));")).toEqual([]);
  });

  it('reports every product source clean, except the two that are named', async () => {
    const files = await productSources();
    // The product has more than the seven files this gate used to list.
    expect(files.length).toBeGreaterThan(30);
    const offenders = {};
    for (const file of files) {
      const found = violations(await readFile(file, 'utf8'), file);
      if (found.length) offenders[file] = found.map(entry => entry.what);
    }
    // Exactly the named exceptions, and nothing else. A third use of a
    // networking API shows up here as an unexplained file rather than as a
    // silence (QGD-SEC-0020).
    expect(Object.keys(offenders).sort()).toEqual(Object.keys(NETWORK_EXCEPTIONS).sort());
  });
});

describe('QGD-SEC-0021 the gate reviews what is there, not what it was told about', () => {
  // This is the control. The scope was a list of seven file names written at
  // P2, and it stayed seven while the product grew to thirty-six — so a fetch
  // added to the engine passed the gate. A file placed in the tree has to fail
  // it, or the scope has gone back to being a list.
  let root;
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'qg-scope-')); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('finds a file nobody listed, however deep', async () => {
    const deep = join(root, 'engine', 'reference', 'new');
    await mkdir(deep, { recursive: true });
    await writeFile(join(deep, 'telemetry.ts'), "fetch('https://example.invalid/ping');\n");
    await writeFile(join(root, 'shallow.cts'), "const net = require('net');\n");
    const files = await productSources(root);
    expect(files).toEqual([join(root, 'engine/reference/new/telemetry.ts'), join(root, 'shallow.cts')]);
    for (const file of files) {
      expect(violations(await readFile(file, 'utf8'), file).length, file).toBeGreaterThan(0);
    }
  });

  it('does not scan a declaration file, which declares and does not call', async () => {
    await writeFile(join(root, 'native.d.ts'), 'export declare function fetch(url: string): void;\n');
    expect(await productSources(root)).toEqual([]);
  });
});

describe('QGD-SEC-0020 the one outbound client', () => {
  it('is the only module with a client, and the engine listener is the other exception', () => {
    expect(Object.keys(NETWORK_EXCEPTIONS)).toContain(NETWORK_MODULE);
    expect(Object.keys(NETWORK_EXCEPTIONS)).toHaveLength(2);
    for (const reason of Object.values(NETWORK_EXCEPTIONS)) expect(reason.length).toBeGreaterThan(20);
  });

  it('takes its destination from the register, not from its own source', async () => {
    expect(hardCodedHosts(await readFile(NETWORK_MODULE, 'utf8'))).toEqual([]);
  });

  it('would notice a host written into it', () => {
    expect(hardCodedHosts("await fetch('https://adif.org.uk/317/x.zip');")).toEqual([
      { line: 1, file: NETWORK_MODULE, what: 'names https://adif.org.uk rather than reading it from the register' }
    ]);
  });

  it('refuses a URL that is not https', async () => {
    const { download } = await import('../src/engine/reference/fetch.js');
    await expect(download('http://adif.org.uk/317/x.zip')).rejects.toThrow(/HTTPS only/);
    await expect(download('file:///etc/passwd')).rejects.toThrow(/HTTPS only/);
  });
});
