// SPDX-License-Identifier: GPL-3.0-only
// QGD-CRD-0007: the renderer never holds a credential and never opens a network
// connection. QGD-PRC-0002: the renderer holds screens only. QGD-PRC-0006:
// outbound fetch from the renderer is refused.
//
// Issue #3, item 2: capture the application's connections and confirm external
// requests originate only in the credential core.
//
// Three kinds of evidence, because no one of them is complete:
//
//  1. Chromium request history, from webRequest listeners installed as the
//     first thing after launch and kept for the whole run. Not sampled, so a
//     request that opens and closes between two samples is still recorded. The
//     product navigates from app.whenReady, so the very first load can finish
//     before the listeners exist; the suite therefore reloads once with
//     everything in place and asserts that whole navigation. Blind to
//     anything that does not go through Chromium — Node's fetch in main, and
//     the Rust core's own client — and blind to attempts refused inside the
//     renderer by CSP before they reach the network stack.
//  2. A dense socket poll over every process in the tree, which covers the two
//     Chromium cannot see. Its resolution is the poll interval: a connection
//     open for less than that can be missed, which is why it is not the only
//     evidence here.
//  3. A static gate, scripts/network-static.mjs, asserting the product's
//     TypeScript holds no outbound-network API at all. That is what makes the
//     two runtime results meaningful rather than lucky: there is no code in the
//     TypeScript that could have connected between samples.
//
// A positive control proves the capture can see anything at all: the main
// process makes one deliberate loopback request that lingers, and both the
// listener and the poll are asserted to have observed it.
//
// What this does not do, deliberately: transmit a synthetic credential to a
// live provider. The core's destinations are two fixed HTTPS URLs under
// https_only with no proxy, no redirects and TLS 1.3 only (packages/callsign-core/
// packages/callsign-core/src/validation.rs), and its ClientHello is asserted by the rust-unit suite
// without connecting. A real external request happens only when a user presses
// Test credential with a real credential, which no automated suite does.
import { _electron as electron, expect } from '@playwright/test';
import { cp, mkdir, mkdtemp, readdir, rm, writeFile, readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { classify } from './endpoint.mjs';
import { violations, NETWORK_EXCEPTIONS, productSources } from './network-static.mjs';
import { sentinelsIn } from './artifact-scan.mjs';
import { redact } from './report.mjs';
import { enableTestKeychain } from './keychain-service.mjs';
import { assertNoVisibleWindow } from './no-visible-window.mjs';

// Fixtures go to this product's test Keychain service, never beside a real
// credential, and are swept on exit (QGD-CRD-0003). Called before the core is
// loaded, because the service name is read when an entry is made.
enableTestKeychain();

const POLL_MS = 40;
const directory = await mkdtemp(join(tmpdir(), 'qg-connection-capture-'));
const profile = join(directory, 'profile');
const userData = join(directory, 'chromium');
const logs = join(directory, 'logs');
await mkdir(userData, { recursive: true });

// Note on what this run costs POTA: QG Storage fetches POTA's three lists
// here, because that is what a first start does. The park list is a
// nightly-generated static file on a CDN rather than a volunteer-run API, and
// the daily limit in QGD-REF-0010 is what keeps a real user from asking twice.
// If POTA cannot be reached, storage still opens and this suite still passes,
// with no external endpoint to check.
//
// The reference archive, put where the product looks for it before it starts.
//
// This makes the run below an installed product whose reference data is
// already on the machine, which is what every run after the first looks like —
// and what the "no external connection" rule further down is a statement
// about. Without this the product would correctly fetch the archive from
// adif.org (QGD-REF-0001), and this suite would be measuring a first run while
// also making `make verify` depend on someone else's web server being up.
const referenceCache = join(directory, 'reference');
await mkdir(referenceCache, { recursive: true });
const register = JSON.parse(await readFile('data/reference-sources.json', 'utf8'));
const archive = join('vendor', '.cache', `adif-${register.adif.version}.zip`);
await cp(archive, join(referenceCache, `adif-${register.adif.version}.zip`))
  .catch(() => { throw new Error(`${archive} is not there. Fetch it with: make setup`); });
// The fixture's description, and its id once the core has made it.
const description = `qg-test-${randomUUID()}`;
let id;
const password = `QG_FAKE_CREDENTIAL_${randomUUID()}`;
let application;
let stage = 'start the listener';
let credentialSaved = false;
let listener;
let poller;

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

  // Two utility processes, and `ps` calls them the same thing: the credential
  // core and QG Storage are both utility:node.mojom.NodeService. They are not
  // held to the same rule, and conflating them would let one relax the other.
  // QG Storage is the one whose pid the storage broker logged when it started
  // it, every time it started it (QGD-ENG-0017).
  for (const pid of storagePids()) if (found.has(pid)) found.set(pid, 'utility:storage');
  return found;
}

function storagePids() {
  const pids = new Set();
  let text = '';
  try { text = readFileSync(join(logs, 'qg-desktop.log'), 'utf8'); } catch { return pids; }
  for (const line of text.split('\n')) {
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry?.msg === 'storage service started' && Number.isInteger(entry.storagePid)) pids.add(entry.storagePid);
  }
  return pids;
}

// lsof by a fixed path, never a search of PATH: macOS and Ubuntu put it in
// /usr/sbin, Rocky, RHEL and Fedora in /usr/bin. Only /usr/sbin was tried, so on
// Rocky every sample failed as "Connections could not be captured", which hid
// that lsof was not found (#137).
const LSOF = ['/usr/sbin/lsof', '/usr/bin/lsof'].find(path => existsSync(path));

function lsof(args) {
  if (!LSOF) throw new Error('lsof was not found at /usr/sbin/lsof or /usr/bin/lsof: install it.');
  return spawnSync(LSOF, args, { encoding: 'utf8' });
}

// Unix-domain sockets, which `lsof -i` does not show. Electron's own channels
// between its processes are unnamed socket pairs, which every process has; what
// QGD-ENG-0017 forbids is a socket bound to a path, which something else on the
// machine could reach. So the ones with a filesystem path are what is returned.
function unixSockets(pids) {
  if (pids.length === 0) return [];
  const run = lsof(['-nP', '-w', '-U', '-a', '-p', pids.join(',')]);
  const named = [];
  for (const line of (run.stdout || '').split('\n').slice(1)) {
    const columns = line.trim().split(/\s+/);
    if (columns.length < 8) continue;
    const name = columns.slice(7).join(' ').trim();
    const path = name.split(/\s+/).find(part => part.startsWith('/'));
    if (path) named.push({ pid: Number(columns[1]), path });
  }
  return named;
}

// QGD-ENG-0017: storage holds no listener and no connection of any kind,
// loopback included. The external-endpoint rule ignores loopback by design, so
// it would not catch a local listener; this one does. An *unbound* socket is
// not a finding (see the credential core's rule below on Chromium's).
function storageEndpoints(endpoints) {
  return endpoints.filter(endpoint => endpoint.process === 'utility:storage' && endpoint.kind !== 'unbound');
}

function sample(label, processes) {
  const run = lsof(['-nP', '-w', '-i', '-a', '-p', [...processes.keys()].join(',')]);
  if (run.status !== 0 && !run.stdout) throw new Error('Connections could not be captured.');
  const endpoints = [];
  for (const line of (run.stdout || '').split('\n').slice(1)) {
    const columns = line.trim().split(/\s+/);
    if (columns.length < 9) continue;
    const pid = Number(columns[1]);
    const name = columns.slice(8).join(' ');
    const [local, remote] = name.replace(/\s*\(\w+\)$/, '').split('->');
    const endpoint = { local: local ?? '', remote: remote ?? '' };
    const { kind, external } = classify(endpoint);
    endpoints.push({
      pid, process: processes.get(pid) ?? 'unknown', protocol: columns[7],
      state: name.match(/\((\w+)\)$/)?.[1] ?? '', ...endpoint, kind, external
    });
  }
  return { label, processes: Object.fromEntries(processes), endpoints };
}

const ask = (page, command) => page.evaluate(sent => window.callsigns.request(sent), command);
const arrivals = [];
const observed = new Map();   // every endpoint the poll ever saw, deduplicated
const labelled = [];          // named points in the workflow, for the record

try {
  listener = createServer((request, response) => {
    arrivals.push(request.url ?? '');
    // The control request lingers so the poll cannot miss it; a renderer route
    // that somehow arrived would be recorded either way.
    if ((request.url ?? '').startsWith('/control')) setTimeout(() => response.end('x'), 400);
    else response.end('x');
  });
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;

  stage = 'launch';
  application = await electron.launch({
    args: ['.'], cwd: process.cwd(),
    env: {
      ...process.env,
      QG_DESKTOP_PROFILE_DIR: profile, QG_DESKTOP_USER_DATA_DIR: userData, QG_DESKTOP_LOG_DIR: logs,
      QG_DESKTOP_REFERENCE_CACHE: referenceCache
    },
    timeout: 30_000
  });
  // Recording goes in before anything else is awaited. The product calls
  // loadURL() from app.whenReady, so the first navigation may already be in
  // flight or finished by now; the reload below is what gives a complete,
  // instrumented navigation rather than a partial one.
  // onBeforeRequest belongs to the product, which cancels there, so this
  // records the outcome events: onErrorOccurred catches what the filter refused.
  stage = 'install the Chromium request history';
  await application.evaluate(({ session }) => {
    globalThis.__qgRequests = [];
    const record = kind => details => globalThis.__qgRequests.push({ kind, url: details.url, error: details.error ?? '' });
    session.defaultSession.webRequest.onCompleted(record('completed'));
    session.defaultSession.webRequest.onErrorOccurred(record('error'));
  });
  const page = await application.firstWindow();
  await assertNoVisibleWindow(application, page, 'connection-capture');
  const mainPid = await application.evaluate(() => process.pid);

  poller = setInterval(() => {
    try {
      for (const endpoint of sample('poll', tree(mainPid)).endpoints) {
        observed.set(`${endpoint.pid}|${endpoint.local}|${endpoint.remote}|${endpoint.state}`, endpoint);
      }
    } catch { /* a process exiting mid-sample is not a finding */ }
  }, POLL_MS);

  // The application opens on Home now (QGD-FRM-0011).
  await page.getByRole('navigation', { name: 'Sections' })
    .getByRole('button', { name: 'Callsigns', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Add a callsign' })).toBeVisible();

  // One whole navigation inside instrumentation. The application's very first
  // load can complete before the listeners and the poll exist, so the same
  // resource path is exercised again with both in place, and the request
  // history is asserted to have recorded it.
  stage = 'a full navigation recorded from its first request';
  await page.reload();
  // A reload is a fresh start, so it lands on Home again.
  await page.getByRole('navigation', { name: 'Sections' })
    .getByRole('button', { name: 'Callsigns', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Add a callsign' })).toBeVisible();
  const navigation = await application.evaluate(() => globalThis.__qgRequests ?? []);
  expect(navigation.length, 'the request history recorded no navigation at all').toBeGreaterThan(0);
  expect(navigation.every(entry => entry.url.startsWith('qg://desktop/')),
    navigation.map(entry => `${entry.kind} ${entry.url}`).join(', ')).toBe(true);

  await expect.poll(() => ask(page, { type: 'list' }).then(reply => reply.ok)).toBe(true);
  labelled.push(sample('idle', tree(mainPid)));

  stage = 'credential workflow';
  const created = await ask(page, { type: 'create', call: 'w1aw', description });
  expect(created, 'callsign created was refused').toMatchObject({ ok: true });
  id = created.data.callsigns.find(entry => entry.description === description)?.id;
  expect(id, 'the created callsign must be listed').toBeTruthy();
  labelled.push(sample('callsign created', tree(mainPid)));
  const steps = [
    ['callsign activated', { type: 'set-active', id }],
    ['credential saved', { type: 'save-credentials', id, provider: 'qrz_logbook', credentials: { username: 'W1AW', password } }],
    ['status read', { type: 'status', id, provider: 'qrz_logbook' }],
    ['credential tested on an unsupported provider', { type: 'test-credential', id, provider: 'eqsl' }],
    ['credential deleted', { type: 'delete-credentials', id, provider: 'qrz_logbook' }],
    ['callsign removed', { type: 'remove-callsign', id }]
  ];
  for (const [label, command] of steps) {
    const reply = await ask(page, command);
    expect(reply, `${label} was refused`).toMatchObject({ ok: true });
    if (label === 'credential saved') credentialSaved = true;
    if (label === 'credential deleted') credentialSaved = false;
    if (label === 'credential tested on an unsupported provider') expect(reply.data.outcome).toBe('unsupported');
    labelled.push(sample(label, tree(mainPid)));
  }

  // Reference data is fetched only when the operator asks (KI7MT, 2026-10-11),
  // so this run asks, from Settings, for each resource in turn, and the capture
  // sees the fetches the core makes for them. ADIF comes from the archive put
  // in the cache above; POTA is fetched, or fails without a network.
  stage = 'load the reference data, as the operator does';
  for (const resource of register.resources) {
    const accepted = await page.evaluate(id => window.storage.request({ type: 'update-reference', resource: id }), resource.id);
    expect(accepted, `loading ${resource.name} must be accepted`).toMatchObject({ ok: true });
    await expect.poll(() => page.evaluate(() => window.storage.request({ type: 'status' })
      .then(reply => reply.ok && reply.status.reference && !reply.status.reference.refreshing)),
    { message: `loading ${resource.name} must finish`, timeout: 180_000 }).toBe(true);
    labelled.push(sample(`${resource.name} loaded`, tree(mainPid)));
  }

  // QGD-PRC-0006 / QGD-CRD-0007: every outbound route the renderer has, aimed
  // at a listener this test owns. The assertion is that nothing arrives, not
  // that each API reports an error: navigator.sendBeacon reports success for a
  // queued beacon whether or not it is ever delivered.
  stage = 'the renderer reaches nothing by any outbound route';
  const routes = await page.evaluate(async target => {
    const attempt = async (name, run) => {
      try { await run(`${target}/renderer/${name}`); return [name, 'reported allowed']; }
      catch { return [name, 'reported denied']; }
    };
    return Object.fromEntries(await Promise.all([
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
      // QGD-SEC-0003 forbids this in the product. Here it is the route being
      // proven unreachable, so the renderer has to be allowed to attempt it.
      // eslint-disable-next-line no-restricted-syntax
      attempt('dynamicImport', url => import(`${url}.js`))
    ]));
  }, `http://127.0.0.1:${port}`);
  await page.waitForTimeout(1500);
  labelled.push(sample('renderer outbound routes attempted', tree(mainPid)));
  expect(Object.keys(routes).length).toBe(7);

  // The positive control. Node's fetch in the main process is outside
  // Chromium's pipeline, so this also shows what the request history cannot
  // see and the poll can.
  stage = 'positive control';
  // The first argument of an Electron evaluate is the electron module itself.
  const control = await application.evaluate(async (_electron, target) => {
    try { await fetch(`${target}/control/linger`); return 'completed'; } catch (error) { return `failed: ${error.message}`; }
  }, `http://127.0.0.1:${port}`);
  expect(control).toBe('completed');
  expect(arrivals.filter(url => url.startsWith('/control'))).toEqual(['/control/linger']);
  const sawControl = [...observed.values()].some(endpoint => endpoint.remote.endsWith(`:${port}`));
  expect(sawControl, 'the socket poll did not observe the control connection, so it cannot be trusted to observe any').toBe(true);

  // A second control, for the third detector. Electron's net.request goes
  // through the session, so the product's own onBeforeRequest filter sees it:
  // this proves the request history is live AND that the filter cancels a
  // main-process request to an address that is not a bundled resource.
  stage = 'positive control for the request history';
  const filtered = await application.evaluate(({ net }, target) => new Promise(resolve => {
    const request = net.request(`${target}/control/filtered`);
    request.on('response', () => resolve('completed'));
    request.on('error', error => resolve(`refused: ${error.message}`));
    request.end();
  }), `http://127.0.0.1:${port}`);
  expect(filtered, 'the product let a main-process request to a non-resource address through').toMatch(/^refused:/);

  clearInterval(poller); poller = undefined;

  stage = 'nothing but the Node control ever reached the listener';
  // The filtered control must never have arrived: the product cancelled it.
  expect(arrivals, `unexpected arrivals: ${arrivals.join(', ')}`).toEqual(['/control/linger']);

  stage = 'the capture is not vacuous';
  // One sample at idle, one when the callsign is created, one per credential
  // step, one per reference resource loaded, and one after the renderer's
  // outbound routes. Counted from the same lists the samples were taken from,
  // so adding a resource or a step cannot leave this behind again (it did,
  // with 716cffa; and 062d013 took the callsign's sample out of the steps
  // without counting it, #137).
  expect(labelled.length, 'one sample per step taken').toBe(1 + 1 + steps.length + register.resources.length + 1);
  expect(observed.size, 'the poll observed nothing at all').toBeGreaterThan(0);
  for (const taken of labelled) {
    const kinds = Object.values(taken.processes);
    expect(kinds, `${taken.label}: no renderer in the tree`).toContain('renderer');
    expect(kinds, `${taken.label}: no credential core in the tree`).toContain('utility:node.mojom.NodeService');
    expect(kinds.length, `${taken.label}: tree too small to be the application`).toBeGreaterThanOrEqual(4);
  }

  stage = 'every external connection belongs to the credential core';
  // QGD-SEC-0020. The product does reach the network: it fetches ADIF's
  // archive and POTA's three lists, which QGD-REF-0001 and QGD-REF-0009
  // require it to do rather than ship them. So this is not a zero, and
  // pretending it were would mean either a false claim in the footer or a
  // suite that only passes offline.
  //
  // What is asserted is the whole of what QGD-SEC-0020 allows: **the
  // credential core's process**, TCP, port 443. KI7MT decided that (D-18,
  // D-31) — all outbound HTTPS goes through the Rust core, over rustls and
  // AWS-LC in FIPS mode, because Electron's networking is BoringSSL and not
  // the validated module.
  //
  // This rule said "the engine's own process" until a review checked P5 against
  // the decisions: the reference loader was using Node's fetch from the
  // database engine of the time, and this suite was asserting that was
  // correct. It is the other way round: only the credential core connects.
  //
  // Which hosts is held statically rather than here: no product source names
  // one, every URL comes from a register, and tests/network-static.test.mjs
  // proves it. Resolving the register's hostnames in this suite would make it
  // depend on a CDN answering with the same addresses twice, which is a flake
  // rather than a check.
  const CORE = 'utility:node.mojom.NodeService';
  const everyEndpoint = [...observed.values(), ...labelled.flatMap(taken => taken.endpoints)];
  const external = everyEndpoint.filter(endpoint => endpoint.external);
  const describe = list => list.map(e => `${e.process} ${e.protocol} ${e.local}->${e.remote}`).join(', ');
  // Before it connects, the core asks the system's resolver for the address,
  // and on Linux that is its own socket to a nameserver in /etc/resolv.conf.
  // On macOS (mDNSResponder) and on Ubuntu (127.0.0.53) that is never seen as
  // external; where the resolver is not loopback, as in a container, it was,
  // and the suite failed at random on the core's own name lookup (#137). So
  // port 53 is allowed from the core alone, and only to those nameservers.
  const nameservers = new Set((existsSync('/etc/resolv.conf') ? readFileSync('/etc/resolv.conf', 'utf8') : '').split('\n')
    .map(line => line.trim().split(/\s+/)).filter(([key, value]) => key === 'nameserver' && value).map(([, value]) => value));
  const remoteHost = remote => String(remote).slice(0, String(remote).lastIndexOf(':')).replace(/^\[|\]$/g, '');
  const lookup = endpoint => endpoint.process === CORE && String(endpoint.remote).endsWith(':53')
    && nameservers.has(remoteHost(endpoint.remote));
  const unexpected = external.filter(endpoint => !lookup(endpoint) && (
    endpoint.process !== CORE
    || endpoint.protocol !== 'TCP'
    || !String(endpoint.remote).endsWith(':443')));
  expect(unexpected, `external connection(s) QGD-SEC-0020 does not allow: ${describe(unexpected)}`).toEqual([]);
  const https = [...new Set(external.filter(endpoint => !lookup(endpoint)).map(e => e.remote))];
  if (https.length) console.log(`  the credential core reached ${https.length} address(es) on 443: ${https.join(', ')}`);

  // And the run said what happened to the reference load, either way. Without
  // this the rule above passes on a run where nothing was ever fetched — on a
  // machine with no network, which is a legitimate state and not a pass.
  stage = 'the run said what happened to the reference data';
  const storageLog = (await Promise.all((await readdir(logs).catch(() => []))
    .map(name => readFile(join(logs, name), 'utf8').catch(() => '')))).join('\n');
  // Each resource asked for, by name: one resource's line cannot stand in
  // for another's.
  const outcomes = storageLog.split('\n').filter(line => line.includes('"msg":"reference data"'));
  for (const resource of register.resources) {
    expect(outcomes.some(line => line.includes(`"resource":"${resource.id}"`)),
      `storage must say what became of ${resource.name}`).toBe(true);
  }

  stage = 'the renderer holds no socket at all';
  {
    const held = everyEndpoint.filter(endpoint => endpoint.process === 'renderer');
    expect(held, `the renderer held ${held.length} endpoint(s): ` +
      held.map(e => `${e.protocol} ${e.local}->${e.remote} ${e.state}`).join(', ')).toEqual([]);
  }

  stage = 'the credential core connects and never listens';
  {
    // It is the one process that may reach out (D-18, D-31), and that is all
    // it may do: a listener in the process that holds the keys would be
    // something on this machine able to reach them.
    const held = everyEndpoint.filter(endpoint => endpoint.process === CORE);
    const listening = held.filter(endpoint => endpoint.kind === 'listening');
    expect(listening, `the credential core listened on ${listening.length} endpoint(s): ` +
      listening.map(e => `${e.protocol} ${e.local}`).join(', ')).toEqual([]);
    const wrongPort = held.filter(endpoint =>
      endpoint.kind === 'connected' && !lookup(endpoint) && !String(endpoint.remote).endsWith(':443'));
    expect(wrongPort, `the credential core reached ${wrongPort.length} endpoint(s) off 443: ` +
      describe(wrongPort)).toEqual([]);
  }

  stage = 'QG Storage was actually identified';
  // Without this the rule below checks nothing: if the labelling stopped
  // matching, no endpoint would be storage's and the assertion would pass on
  // an empty array. The label has to have been applied to a real process.
  const everyLabel = new Set(labelled.flatMap(taken => Object.values(taken.processes)));
  expect([...everyLabel].includes('utility:storage'),
    `QG Storage's utility process was never identified; labels seen: ${[...everyLabel].join(', ')}`).toBe(true);
  // And the credential core is still one of them, or its rule moved off the
  // process it was written for.
  expect([...everyLabel].includes('utility:node.mojom.NodeService'),
    `the credential core was never identified; labels seen: ${[...everyLabel].join(', ')}`).toBe(true);

  stage = 'QG Storage holds no socket at all, loopback included';
  // The control first, on the capture and not only the filter: a real process
  // listening on loopback TCP and on a Unix socket path, sampled exactly as
  // the application's processes are, must be caught by both checks. Without
  // it, a capture that saw nothing would pass this rule.
  {
    const socketPath = join(directory, 'planted.sock');
    const helper = spawn(process.execPath, ['-e', [
      "const net = require('node:net');",
      "net.createServer().listen(0, '127.0.0.1');",
      `net.createServer().listen(${JSON.stringify(socketPath)});`,
      "setInterval(() => {}, 1000);"
    ].join(' ')], { stdio: 'ignore' });
    try {
      let caughtTcp = [];
      let caughtUnix = [];
      for (let attempt = 0; attempt < 50 && (caughtTcp.length === 0 || caughtUnix.length === 0); attempt++) {
        await new Promise(settle => setTimeout(settle, 100));
        const planted = sample('planted', new Map([[helper.pid, 'utility:storage']]));
        caughtTcp = storageEndpoints(planted.endpoints);
        caughtUnix = unixSockets([helper.pid]);
      }
      expect(caughtTcp.some(endpoint => endpoint.kind === 'listening'),
        'the capture must catch a real loopback listener in a process labelled QG Storage').toBe(true);
      expect(caughtUnix.some(entry => entry.path === socketPath),
        'the capture must catch a real Unix socket bound to a path').toBe(true);
    } finally {
      // Only waited for if it has not already gone: an 'exit' already emitted
      // is never emitted again.
      if (helper.exitCode === null && helper.signalCode === null) {
        const exited = once(helper, 'exit');
        helper.kill('SIGKILL');
        await exited.catch(() => {});
      }
    }
  }
  const storageReal = storageEndpoints(everyEndpoint);
  expect(storageReal, `QG Storage held ${storageReal.length} connection(s) or listener(s): ` +
    storageReal.map(e => `${e.protocol} ${e.local}->${e.remote} ${e.state}`).join(', ')).toEqual([]);
  // Sampled while the application is still running: every pid it ever had.
  const storageUnix = unixSockets([...storagePids()]);
  expect(storageUnix, `QG Storage held ${storageUnix.length} Unix socket(s) bound to a path: ` +
    storageUnix.map(entry => entry.path).join(', ')).toEqual([]);

  stage = 'the request history is live, and holds nothing but the control off-scheme';
  const requests = await application.evaluate(() => globalThis.__qgRequests ?? []);
  const offScheme = requests.filter(entry => !entry.url.startsWith('qg://desktop/'));
  // Exactly one off-scheme entry: the control, recorded as refused. If the
  // history were dead this would be empty, and every other assertion over it
  // would pass for the wrong reason.
  expect(offScheme.map(entry => `${entry.kind} ${entry.url}`),
    offScheme.map(entry => `${entry.kind} ${entry.url} ${entry.error}`).join(', '))
    .toEqual([`error http://127.0.0.1:${port}/control/filtered`]);

  // PRIVACY.md, which Help → Privacy opens, makes a claim to the operator
  // about when this application goes online (QGD-FRM-0015). This suite is
  // what evidences it, so the claim and the evidence are asserted together:
  // the wording must be the one the measurement supports, and the measurement
  // above must have found no connection during a workflow that included a
  // credential test.
  stage = 'the privacy claim matches what this suite measured';
  const privacy = await readFile('PRIVACY.md', 'utf8');
  expect(privacy).toContain('**test a login** for a service you\'ve set up;');
  expect(privacy).toContain('**download or update reference data**');
  expect(privacy).toContain('**open a page that shows outside data**');
  expect(privacy).toContain('Nothing about you is sent with any of these.');
  // An absolute claim would be false the moment a user tests a credential.
  expect(privacy).not.toMatch(/never goes online|no connection/i);

  stage = 'no outbound-network API in the product TypeScript but the two named';
  // The scope is walked, not listed (QGD-SEC-0021): this gate scanned seven
  // files while the product grew to thirty-six, and a fetch added to the
  // engine of the time passed it.
  const sources = await productSources();
  const offenders = [];
  for (const file of sources) {
    const found = violations(await readFile(file, 'utf8'), file);
    if (found.length) offenders.push(file);
  }
  expect(offenders.sort(), 'an unexplained use of a networking API')
    .toEqual(Object.keys(NETWORK_EXCEPTIONS).sort());

  // QGD-LOG-0003 to QGD-LOG-0005: this run wrote a synthetic credential, so its
  // own log folder is where a redaction failure would show first. Asserted to
  // have content, because an empty folder would pass for the wrong reason.
  stage = 'this run\'s logs carry lines and no sentinel';
  const logFiles = await readdir(logs).catch(() => []);
  expect(logFiles.length, 'the application wrote no log at all').toBeGreaterThan(0);
  let logLines = 0;
  for (const name of logFiles) {
    const text = await readFile(join(logs, name), 'utf8').catch(() => '');
    logLines += text.split('\n').filter(Boolean).length;
    expect(sentinelsIn(text), `${name} carries a credential sentinel`).toEqual([]);
  }
  expect(logLines, 'the log files are empty').toBeGreaterThan(0);

  // QGD-LOG-0001: the core's own tracing reaches the same stream. The workflow
  // above saved and removed a credential, each of which the core reports.
  stage = 'the core\'s events reached the one stream';
  let coreRecords = 0;
  for (const name of logFiles) {
    const text = await readFile(join(logs, name), 'utf8').catch(() => '');
    for (const line of text.split('\n').filter(Boolean)) {
      let record; try { record = JSON.parse(line); } catch { continue; }
      if (record.source === 'core') coreRecords++;
    }
  }
  expect(coreRecords, 'no record from the Rust core reached the log').toBeGreaterThan(0);

  await mkdir('report', { recursive: true });
  await writeFile('report/connections.json', JSON.stringify({
    date: new Date().toISOString(),
    method: 'Chromium request history (not sampled) + a socket poll every ' + POLL_MS + 'ms over every process in the tree + a static gate over the product TypeScript.',
    limits: 'The request history cannot see Node-side or native requests, nor renderer attempts refused by CSP before reaching the network stack. The application navigates from app.whenReady, so its first load can finish before the listeners exist; a full reload is recorded instead and asserted. The poll cannot see a connection open for less than its interval. The static gate is what rules out TypeScript that could connect between polls; the core\'s only connection path is validation::test for a supported provider, which no suite invokes.',
    navigationRecordedUnderInstrumentation: true,
    pollIntervalMs: POLL_MS,
    positiveControls: {
      nodeFetchFromMain: { request: '/control/linger', outcome: control, arrived: true, observedByPoll: sawControl },
      electronNetRequestFromMain: { request: '/control/filtered', outcome: filtered, arrived: false, recordedByRequestHistory: true }
    },
    rendererOutboundRoutes: routes,
    requestsThatArrived: arrivals,
    chromiumRequests: requests,
    allowedCoreDestinations: ['https://xmldata.qrz.com/xml/current/', 'https://logbook.qrz.com/api'],
    coreTransport: 'HTTPS only, no proxy, no redirects, FIPS provider; TLS 1.3 only for credentials, TLS 1.3 or 1.2 for public reference data',
    liveRequestExercised: false,
    logLinesWritten: logLines,
    coreRecordsInLog: coreRecords,
    distinctEndpointsObserved: [...observed.values()],
    samples: labelled
  }, null, 2) + '\n');

  await application.close(); application = undefined;
  // What was measured, said in the terms the rules are now written in: the
  // credential core may reach a reference source on 443 and nothing else may
  // reach anything.
  const reached = https;
  const coreNote = reached.length
    ? `the credential core reached ${reached.length} address(es) on 443 and listened on none`
    : 'the credential core reached nothing (no network on this run) and listened on none';
  console.log(`Connection capture: ${observed.size} distinct endpoints observed; ` +
    `renderer and QG Storage held none; ${coreNote}: PASS`);
  console.log('Renderer reached nothing by fetch, XHR, WebSocket, EventSource, beacon, image or dynamic import: PASS');
  console.log('Both positive controls observed; the product refused the filtered one; static network gate clean: PASS');
} catch (error) {
  console.error(`Connection capture failed at: ${stage}`);
  console.error(redact(error.message).split('\n').slice(0, 20).join('\n'));
  process.exitCode = 1;
} finally {
  if (poller) clearInterval(poller);
  if (credentialSaved && application) {
    const page = await application.firstWindow().catch(() => undefined);
    if (page && id) await ask(page, { type: 'delete-credentials', id, provider: 'qrz_logbook' }).catch(() => {});
  }
  if (application) await application.close().catch(() => {});
  if (listener) await new Promise(resolve => listener.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
