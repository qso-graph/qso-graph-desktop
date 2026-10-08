// SPDX-License-Identifier: GPL-3.0-only
// QGD-CRD-0007: the renderer never holds a credential and never opens a network
// connection. QGD-PRC-0002: the renderer holds screens only. QGD-PRC-0006:
// outbound fetch from the renderer is refused.
//
// Issue #3, item 2: capture the application's connections and confirm external
// requests originate only in the credential core.
//
// What this proves: across a full credential workflow — create, save, status,
// test, delete, remove — no process in the application's tree opens a single
// TCP endpoint outside loopback, the renderer opens none at all, and the
// credential core opens none either, because nothing here presses Test
// credential against a supported provider.
//
// What it deliberately does not do: transmit a synthetic credential to a live
// provider. The core's destinations are two fixed HTTPS URLs under https_only
// with no proxy, no redirects and TLS 1.3 only (native/persona-core/src/
// validation.rs), and its ClientHello is asserted by the rust-unit suite
// without connecting. A real external request happens only when a user presses
// Test credential with a real credential, which no automated suite does.
import { _electron as electron, expect } from '@playwright/test';
import { mkdir, mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { redact } from './report.mjs';

const directory = await mkdtemp(join(tmpdir(), 'qg-connection-capture-'));
const profile = join(directory, 'profile');
const userData = join(directory, 'chromium');
await mkdir(userData, { recursive: true });
const persona = `qg-test-${randomUUID()}`;
const password = `QG_FAKE_CREDENTIAL_${randomUUID()}`;
const LOOPBACK = /^(127\.0\.0\.1|\[?::1\]?|localhost)$/;
let application;
let stage = 'launch';
let credentialSaved = false;
let listener;

// Every process Electron owns, labelled by Chromium's own process type.
function tree(root) {
  const ps = spawnSync('/bin/ps', ['-ax', '-o', 'pid=,ppid=,command='], { encoding: 'utf8' });
  const rows = (ps.stdout || '').split('\n').map(line => line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/)).filter(Boolean);
  const found = new Map();
  const queue = [root];
  while (queue.length) {
    const pid = queue.shift();
    const row = rows.find(entry => Number(entry[1]) === pid);
    const command = row ? row[3] : '';
    const type = command.match(/--type=([\w.]+)/)?.[1] ?? 'main';
    const sub = command.match(/--utility-sub-type=([\w.]+)/)?.[1];
    found.set(pid, sub ? `${type}:${sub}` : type);
    for (const entry of rows) if (Number(entry[2]) === pid) queue.push(Number(entry[1]));
  }
  return found;
}

const host = endpoint => endpoint.replace(/:\d+$/, '').replace(/^\[|\]$/g, '');

// One lsof sample over the whole tree, parsed into endpoints per process.
function sample(label, processes) {
  const pids = [...processes.keys()];
  const run = spawnSync('/usr/sbin/lsof', ['-nP', '-w', '-i', '-a', '-p', pids.join(',')], { encoding: 'utf8' });
  if (run.status !== 0 && !run.stdout) throw new Error('Connections could not be captured.');
  const endpoints = [];
  for (const line of (run.stdout || '').split('\n').slice(1)) {
    const columns = line.trim().split(/\s+/);
    if (columns.length < 9) continue;
    const pid = Number(columns[1]);
    const protocol = columns[7];
    const name = columns.slice(8).join(' ');
    const state = name.match(/\((\w+)\)$/)?.[1] ?? '';
    const [local, remote] = name.replace(/\s*\(\w+\)$/, '').split('->');
    const hosts = [local, remote].filter(Boolean).map(host);
    endpoints.push({
      pid, process: processes.get(pid) ?? 'unknown', protocol, state,
      local: local ?? '', remote: remote ?? '',
      external: hosts.some(value => !LOOPBACK.test(value))
    });
  }
  return { label, processes: Object.fromEntries(processes), endpoints };
}

const ask = (page, command) => page.evaluate(sent => window.personas.request(sent), command);

try {
  application = await electron.launch({
    args: ['.'], cwd: process.cwd(),
    env: { ...process.env, QG_DESKTOP_PROFILE_DIR: profile, QG_DESKTOP_USER_DATA_DIR: userData },
    timeout: 30_000
  });
  const page = await application.firstWindow();
  const mainPid = await application.evaluate(() => process.pid);
  await expect(page.getByRole('heading', { name: 'Create a persona' })).toBeVisible();
  await expect.poll(() => ask(page, { type: 'list' }).then(reply => reply.ok)).toBe(true);

  const processes = tree(mainPid);
  const samples = [sample('idle', processes)];

  // The whole credential workflow, sampled after every step.
  stage = 'credential workflow';
  const steps = [
    ['persona created', { type: 'upsert', name: persona, callsign: 'w1aw' }],
    ['persona activated', { type: 'set-active', name: persona }],
    ['credential saved', { type: 'save-credentials', persona, provider: 'qrz_logbook', credentials: { username: 'W1AW', password } }],
    ['status read', { type: 'status', persona, provider: 'qrz_logbook' }],
    // An unsupported provider returns a fixed outcome without connecting.
    ['credential tested on an unsupported provider', { type: 'test-credential', persona, provider: 'eqsl' }],
    ['credential deleted', { type: 'delete-credentials', persona, provider: 'qrz_logbook' }],
    ['persona removed', { type: 'remove-persona', name: persona }]
  ];
  for (const [label, command] of steps) {
    const reply = await ask(page, command);
    expect(reply, `${label} was refused`).toMatchObject({ ok: true });
    if (label === 'credential saved') credentialSaved = true;
    if (label === 'credential deleted') credentialSaved = false;
    if (label === 'credential tested on an unsupported provider') expect(reply.data.outcome).toBe('unsupported');
    samples.push(sample(label, tree(mainPid)));
  }

  // A sample of nothing must not pass: the tree has to be the real one.
  stage = 'the capture is not vacuous';
  expect(samples.length).toBe(steps.length + 1);
  for (const taken of samples) {
    const kinds = Object.values(taken.processes);
    expect(kinds, `${taken.label}: no renderer in the tree`).toContain('renderer');
    expect(kinds, `${taken.label}: no credential core in the tree`).toContain('utility:node.mojom.NodeService');
    expect(kinds.length, `${taken.label}: tree too small to be the application`).toBeGreaterThanOrEqual(4);
  }

  stage = 'no external connection anywhere in the application';
  for (const taken of samples) {
    const external = taken.endpoints.filter(endpoint => endpoint.external);
    expect(external, `${taken.label}: ${external.map(e => `${e.process} ${e.protocol} ${e.local}->${e.remote}`).join(', ')}`).toEqual([]);
  }

  stage = 'the renderer and the credential core hold no socket at all';
  for (const taken of samples) {
    for (const kind of ['renderer', 'utility:node.mojom.NodeService']) {
      const held = taken.endpoints.filter(endpoint => endpoint.process === kind);
      expect(held, `${taken.label}: ${kind} holds ${held.length} endpoint(s)`).toEqual([]);
    }
  }

  // QGD-PRC-0006 / QGD-CRD-0007: the renderer cannot reach the network by any
  // route, not only by fetch. Each route is aimed at a loopback server this
  // test owns, and the assertion is that nothing arrives — not that each API
  // reports an error. navigator.sendBeacon returns true for a queued beacon
  // whether or not it is ever delivered, so its return value proves nothing;
  // an empty request log does.
  stage = 'the renderer reaches nothing by any outbound route';
  const arrivals = [];
  listener = createServer((request, response) => { arrivals.push(request.url ?? ''); response.end('x'); });
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  const routes = await page.evaluate(async target => {
    const attempt = async (name, run) => {
      try { await run(`${target}/${name}`); return [name, 'reported allowed']; }
      catch { return [name, 'reported denied']; }
    };
    const outcomes = await Promise.all([
      attempt('fetch', url => fetch(url)),
      attempt('xhr', url => new Promise((resolve, reject) => {
        const request = new XMLHttpRequest();
        request.onerror = () => reject(new Error('denied'));
        request.onload = resolve;
        request.open('GET', url); request.send();
      })),
      attempt('websocket', url => new Promise((resolve, reject) => {
        const socket = new WebSocket(url.replace('http', 'ws'));
        socket.onerror = () => reject(new Error('denied'));
        socket.onopen = resolve;
      })),
      attempt('eventsource', url => new Promise((resolve, reject) => {
        const source = new EventSource(url);
        source.onerror = () => reject(new Error('denied'));
        source.onopen = resolve;
      })),
      attempt('beacon', url => { if (!navigator.sendBeacon(url, 'x')) throw new Error('denied'); }),
      attempt('image', url => new Promise((resolve, reject) => {
        const image = new Image();
        image.onerror = () => reject(new Error('denied'));
        image.onload = resolve;
        image.src = `${url}.png`;
      })),
      attempt('dynamicImport', url => import(`${url}.js`))
    ]);
    return Object.fromEntries(outcomes);
  }, `http://127.0.0.1:${port}`);
  // Give anything that was queued rather than refused a chance to be delivered.
  await page.waitForTimeout(1500);
  expect(arrivals, `the renderer reached the listener: ${arrivals.join(', ')}`).toEqual([]);
  expect(Object.keys(routes).length).toBe(7);

  // Nothing new may have appeared in the tree as a result of trying.
  const afterRoutes = sample('renderer outbound routes attempted', tree(mainPid));
  samples.push(afterRoutes);
  expect(afterRoutes.endpoints.filter(endpoint => endpoint.external)).toEqual([]);
  expect(afterRoutes.endpoints.filter(endpoint => endpoint.process === 'renderer')).toEqual([]);

  // QGD-CRD-0007 is Static as well as Test: the product's TypeScript holds no
  // outbound-network API at all, so the core is the only place one can exist.
  stage = 'no outbound-network API in the product TypeScript';
  const forbidden = /fetch\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|node:(?:http|https|net|tls|dgram)|require\(['"](?:http|https|net|tls)/;
  for (const file of ['src/main.ts', 'src/persona-broker.ts', 'src/persona-contract.ts', 'src/persona-service.ts', 'src/policy.ts', 'src/preload.cts', 'src/renderer/app.ts']) {
    expect(forbidden.test(await readFile(file, 'utf8')), `${file} contains an outbound-network API`).toBe(false);
  }

  await mkdir('report', { recursive: true });
  await writeFile('report/connections.json', JSON.stringify({
    date: new Date().toISOString(),
    note: 'TCP and UDP endpoints of every process in the application tree, sampled through a full credential workflow. Loopback endpoints on the main process are the test harness inspector channel.',
    rendererOutboundRoutes: routes,
    rendererRequestsThatArrived: arrivals,
    allowedCoreDestinations: ['https://xmldata.qrz.com/xml/current/', 'https://logbook.qrz.com/api'],
    coreTransport: 'HTTPS only, no proxy, no redirects, TLS 1.3 only, FIPS provider',
    liveRequestExercised: false,
    samples
  }, null, 2) + '\n');

  await application.close(); application = undefined;
  console.log('Connection capture: no external endpoint in any process; renderer and credential core hold none: PASS');
  console.log('Renderer reached nothing by fetch, XHR, WebSocket, EventSource, beacon, image or dynamic import: PASS');
} catch (error) {
  console.error(`Connection capture failed at: ${stage}`);
  console.error(redact(error.message).split('\n').slice(0, 20).join('\n'));
  process.exitCode = 1;
} finally {
  if (credentialSaved && application) {
    const page = await application.firstWindow().catch(() => undefined);
    if (page) await ask(page, { type: 'delete-credentials', persona, provider: 'qrz_logbook' }).catch(() => {});
  }
  if (application) await application.close().catch(() => {});
  if (listener) await new Promise(resolve => listener.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
