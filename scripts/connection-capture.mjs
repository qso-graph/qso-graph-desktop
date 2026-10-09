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
// https_only with no proxy, no redirects and TLS 1.3 only (native/persona-core/
// src/validation.rs), and its ClientHello is asserted by the rust-unit suite
// without connecting. A real external request happens only when a user presses
// Test credential with a real credential, which no automated suite does.
import { _electron as electron, expect } from '@playwright/test';
import { mkdir, mkdtemp, readdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { classify } from './endpoint.mjs';
import { violations, PRODUCT_SOURCES } from './network-static.mjs';
import { sentinelsIn } from './artifact-scan.mjs';
import { redact } from './report.mjs';

const POLL_MS = 40;
const directory = await mkdtemp(join(tmpdir(), 'qg-connection-capture-'));
const profile = join(directory, 'profile');
const userData = join(directory, 'chromium');
const logs = join(directory, 'logs');
await mkdir(userData, { recursive: true });
const persona = `qg-test-${randomUUID()}`;
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

  // Two utility processes now, and `ps` calls them the same thing: the
  // credential core and the engine supervisor are both
  // utility:node.mojom.NodeService. They are not held to the same rule — the
  // credential core must hold no socket of any kind, and conflating them would
  // let the engine's presence quietly relax that.
  //
  // The engine's is the one PostgreSQL is a child of, which is derivable from
  // the tree we already have and needs nothing added to the application.
  for (const [pid, row] of rows.map(entry => [Number(entry[1]), entry])) {
    if (!/\/postgres\b/.test(row[3])) continue;
    const parent = Number(row[2]);
    if (found.has(parent)) found.set(parent, 'utility:engine');
    if (found.has(pid)) found.set(pid, 'engine:postgres');
  }
  return found;
}

function sample(label, processes) {
  const run = spawnSync('/usr/sbin/lsof', ['-nP', '-w', '-i', '-a', '-p', [...processes.keys()].join(',')], { encoding: 'utf8' });
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

const ask = (page, command) => page.evaluate(sent => window.personas.request(sent), command);
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
    env: { ...process.env, QG_DESKTOP_PROFILE_DIR: profile, QG_DESKTOP_USER_DATA_DIR: userData, QG_DESKTOP_LOG_DIR: logs },
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
  const mainPid = await application.evaluate(() => process.pid);

  poller = setInterval(() => {
    try {
      for (const endpoint of sample('poll', tree(mainPid)).endpoints) {
        observed.set(`${endpoint.pid}|${endpoint.local}|${endpoint.remote}|${endpoint.state}`, endpoint);
      }
    } catch { /* a process exiting mid-sample is not a finding */ }
  }, POLL_MS);

  await expect(page.getByRole('heading', { name: 'Create a persona' })).toBeVisible();

  // One whole navigation inside instrumentation. The application's very first
  // load can complete before the listeners and the poll exist, so the same
  // resource path is exercised again with both in place, and the request
  // history is asserted to have recorded it.
  stage = 'a full navigation recorded from its first request';
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Create a persona' })).toBeVisible();
  const navigation = await application.evaluate(() => globalThis.__qgRequests ?? []);
  expect(navigation.length, 'the request history recorded no navigation at all').toBeGreaterThan(0);
  expect(navigation.every(entry => entry.url.startsWith('qg://desktop/')),
    navigation.map(entry => `${entry.kind} ${entry.url}`).join(', ')).toBe(true);

  await expect.poll(() => ask(page, { type: 'list' }).then(reply => reply.ok)).toBe(true);
  labelled.push(sample('idle', tree(mainPid)));

  stage = 'credential workflow';
  const steps = [
    ['persona created', { type: 'upsert', name: persona, callsign: 'w1aw' }],
    ['persona activated', { type: 'set-active', name: persona }],
    ['credential saved', { type: 'save-credentials', persona, provider: 'qrz_logbook', credentials: { username: 'W1AW', password } }],
    ['status read', { type: 'status', persona, provider: 'qrz_logbook' }],
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
    labelled.push(sample(label, tree(mainPid)));
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
  expect(labelled.length).toBe(steps.length + 2);
  expect(observed.size, 'the poll observed nothing at all').toBeGreaterThan(0);
  for (const taken of labelled) {
    const kinds = Object.values(taken.processes);
    expect(kinds, `${taken.label}: no renderer in the tree`).toContain('renderer');
    expect(kinds, `${taken.label}: no credential core in the tree`).toContain('utility:node.mojom.NodeService');
    expect(kinds.length, `${taken.label}: tree too small to be the application`).toBeGreaterThanOrEqual(4);
  }

  stage = 'no external connection anywhere, in any sample or poll';
  const everyEndpoint = [...observed.values(), ...labelled.flatMap(taken => taken.endpoints)];
  const external = everyEndpoint.filter(endpoint => endpoint.external);
  expect(external, external.map(e => `${e.process} ${e.protocol} ${e.local}->${e.remote}`).join(', ')).toEqual([]);

  stage = 'the renderer and the credential core hold no socket at all';
  for (const kind of ['renderer', 'utility:node.mojom.NodeService']) {
    const held = everyEndpoint.filter(endpoint => endpoint.process === kind);
    expect(held, `${kind} held ${held.length} endpoint(s): ` +
      held.map(e => `${e.protocol} ${e.local}->${e.remote} ${e.state}`).join(', ')).toEqual([]);
  }

  stage = 'the engine and PostgreSQL were actually identified';
  // Without this the two rules below check nothing: if the labelling stopped
  // matching, every endpoint would simply fail to be one of theirs and both
  // assertions would pass on an empty array. The labels have to have been
  // applied to a real process at some point in the run.
  const everyLabel = new Set(labelled.flatMap(taken => Object.values(taken.processes)));
  expect([...everyLabel].includes('utility:engine'),
    `the engine's utility process was never identified; labels seen: ${[...everyLabel].join(', ')}`).toBe(true);
  expect([...everyLabel].includes('engine:postgres'),
    `PostgreSQL was never identified; labels seen: ${[...everyLabel].join(', ')}`).toBe(true);
  // And the credential core is still one of them, or the rule above moved off
  // the process it was written for.
  expect([...everyLabel].includes('utility:node.mojom.NodeService'),
    `the credential core was never identified; labels seen: ${[...everyLabel].join(', ')}`).toBe(true);

  stage = 'the engine holds no TCP port and reaches nothing';
  // A different rule, deliberately. The engine talks to PostgreSQL over a Unix
  // socket, which is not an internet socket and does not appear here at all —
  // so it should hold nothing either. But it is a database supervisor rather
  // than the credential core, and the thing that must never be true of it is a
  // TCP port or anything external. Any other endpoint it holds is named in the
  // output of every run rather than passed over, because something that opens
  // a socket here is something to understand.
  const engineHeld = everyEndpoint.filter(endpoint => endpoint.process === 'utility:engine');
  const engineTcp = engineHeld.filter(endpoint => endpoint.protocol === 'TCP' || endpoint.external);
  expect(engineTcp, `the engine held ${engineTcp.length} TCP or external endpoint(s): ` +
    engineTcp.map(e => `${e.protocol} ${e.local}->${e.remote}`).join(', ')).toEqual([]);

  stage = 'PostgreSQL itself holds no TCP port';
  // QGD-ENG-0009, from outside: the server is on a Unix socket and listens on
  // no port. scripts/engine-lifecycle.mjs asserts this of a server it started;
  // this asserts it of the one the application is actually running.
  const postgresHeld = everyEndpoint.filter(endpoint => endpoint.process === 'engine:postgres');
  expect(postgresHeld, `PostgreSQL held ${postgresHeld.length} endpoint(s): ` +
    postgresHeld.map(e => `${e.protocol} ${e.local}`).join(', ')).toEqual([]);

  stage = 'the request history is live, and holds nothing but the control off-scheme';
  const requests = await application.evaluate(() => globalThis.__qgRequests ?? []);
  const offScheme = requests.filter(entry => !entry.url.startsWith('qg://desktop/'));
  // Exactly one off-scheme entry: the control, recorded as refused. If the
  // history were dead this would be empty, and every other assertion over it
  // would pass for the wrong reason.
  expect(offScheme.map(entry => `${entry.kind} ${entry.url}`),
    offScheme.map(entry => `${entry.kind} ${entry.url} ${entry.error}`).join(', '))
    .toEqual([`error http://127.0.0.1:${port}/control/filtered`]);

  // The footer makes a claim to the operator about when this application talks
  // to the outside world. This suite is what evidences it, so the claim and the
  // evidence are asserted together: the wording must be the one the measurement
  // supports, and the measurement above must have found no connection during a
  // workflow that included a credential test.
  stage = 'the footer claim matches what this suite measured';
  const footer = await page.locator('#connection-note').innerText();
  expect(footer).toBe('Stored locally · Connects only when you test a credential');
  // An absolute claim would be false the moment a user tests a credential.
  expect(footer).not.toContain('No service connection made');

  stage = 'no outbound-network API in the product TypeScript';
  for (const file of PRODUCT_SOURCES) {
    expect(violations(await readFile(file, 'utf8'), file), file).toEqual([]);
  }

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
    coreTransport: 'HTTPS only, no proxy, no redirects, TLS 1.3 only, FIPS provider',
    liveRequestExercised: false,
    logLinesWritten: logLines,
    coreRecordsInLog: coreRecords,
    distinctEndpointsObserved: [...observed.values()],
    samples: labelled
  }, null, 2) + '\n');

  await application.close(); application = undefined;
  const engineNote = engineHeld.length
  ? `; the engine held ${engineHeld.length} non-TCP endpoint(s): ${engineHeld.map(e => `${e.protocol} ${e.local}`).join(', ')}`
  : '; the engine and PostgreSQL held none';
console.log(`Connection capture: ${observed.size} distinct endpoints observed, none external; renderer and credential core held none${engineNote}: PASS`);
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
    if (page) await ask(page, { type: 'delete-credentials', persona, provider: 'qrz_logbook' }).catch(() => {});
  }
  if (application) await application.close().catch(() => {});
  if (listener) await new Promise(resolve => listener.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
