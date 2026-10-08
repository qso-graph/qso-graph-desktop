// SPDX-License-Identifier: GPL-3.0-only
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { violations, PRODUCT_SOURCES } from '../scripts/network-static.mjs';

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
    ["import { net as alias } from 'electron';", 'renamed electron networking import']
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
    ['const pattern = /fetch\\(/;', 'a call inside a regex literal']
  ])('does not flag %#: %s', source => {
    expect(violations(source)).toEqual([]);
  });

  it('does not flag the in-process resource scheme the product actually uses', () => {
    expect(violations("protocol.handle('qg', async request => new Response(null, { status: 403 }));")).toEqual([]);
    expect(violations("void window.loadURL('qg://desktop/index.html');")).toEqual([]);
    expect(violations("session.defaultSession.webRequest.onBeforeRequest((d, cb) => cb({ cancel: true }));")).toEqual([]);
  });

  it('reports every product source clean', async () => {
    for (const file of PRODUCT_SOURCES) {
      expect(violations(await readFile(file, 'utf8'), file), file).toEqual([]);
    }
  });
});
