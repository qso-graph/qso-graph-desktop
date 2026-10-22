// SPDX-License-Identifier: GPL-3.0-only
// QGD-PRC-0001: a crash in one process never takes the application down.
// QGD-PRC-0005: IPC is a typed contract; malformed messages are rejected, not coerced.
// QGD-PRT-0102's exit gate: killing a utility process leaves the window running
// and the process recovers.
//
// No credential is read here: the fixture is created over IPC and never
// selected, so nothing triggers a credential-status request. The suite
// therefore does not depend on the credential store and reports its own result
// when the round-trip fails.
import { _electron as electron, expect } from '@playwright/test';
import { cp, mkdir, mkdtemp, rename, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { redact } from './report.mjs';
import { enableTestKeychain } from './keychain-service.mjs';
import { assertNoVisibleWindow } from './no-visible-window.mjs';
import { createRequire } from 'node:module';
import { listProcesses } from './platform-process.mjs';

// Fixtures go to this product's test Keychain service, never beside a real
// credential, and are swept on exit (QGD-CRD-0003).
enableTestKeychain();

const directory = await mkdtemp(join(tmpdir(), 'qg-process-recovery-'));
const profile = join(directory, 'profile');
const userData = join(directory, 'chromium');
const logs = join(directory, 'logs');
await mkdir(userData, { recursive: true });
const persona = `qg-test-${randomUUID()}`;
const control = String.fromCharCode(1);
let application;
let stage = 'launch';
// The outage is held open by moving the service module aside, so the test runs
// against its own copy of the build. Nothing it does can reach the shared
// dist/, which a SIGTERM mid-outage would otherwise leave without a service
// module — verify.mjs sends exactly that on its per-suite timeout.
const application_directory = join(directory, 'app');
const service = join(application_directory, 'dist/personas/persona-service.js');
const disabled = `${service}.disabled`;

// Two utility processes are children of main and `ps` names them the same:
// the persona core and QG Storage. QG Storage is the one whose pid the storage
// broker logged when it started it (QGD-ENG-0017); the persona core is the
// other one.
function storagePids() {
  const pids = [];
  let text = '';
  try { text = readFileSync(join(logs, 'qg-desktop.log'), 'utf8'); } catch { return pids; }
  for (const line of text.split('\n')) {
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry?.msg === 'storage service started' && Number.isInteger(entry.storagePid)) pids.push(entry.storagePid);
  }
  return pids;
}
function utilities(mainPid) {
  return listProcesses()
    .filter(entry => entry.ppid === mainPid && entry.command.includes('--utility-sub-type=node.mojom.NodeService'))
    .map(entry => entry.pid);
}
function personaUtility(mainPid) {
  const storage = new Set(storagePids());
  return utilities(mainPid).find(pid => !storage.has(pid));
}
function storageUtility(mainPid) {
  const running = new Set(utilities(mainPid));
  return storagePids().reverse().find(pid => running.has(pid));
}
const storageState = page => page.evaluate(() => window.storage.request({ type: 'status' }))
  .then(reply => (reply.ok ? reply.status.state : 'refused'));
const ask = (page, command) => page.evaluate(sent => window.personas.request(sent), command);

try {
  await mkdir(application_directory, { recursive: true });
  await cp('dist', join(application_directory, 'dist'), { recursive: true });
  await cp('package.json', join(application_directory, 'package.json'));
  // What QG Storage reads from the application path: its SQL and the
  // reference register (QGD-ENG-0013, QGD-ENG-0015, QGD-REF-0001).
  await cp('drizzle', join(application_directory, 'drizzle'), { recursive: true });
  await cp('data', join(application_directory, 'data'), { recursive: true });
  // The application has runtime dependencies now, so the copy needs them on its
  // resolution path. Linked rather than copied: this suite only reads them.
  // A junction on Windows, which needs no administrator rights.
  await symlink(resolve('node_modules'), join(application_directory, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  application = await electron.launch({
    args: ['.'], cwd: application_directory,
    // The electron package names its own binary on every platform.
    executablePath: createRequire(import.meta.url)('electron'),
    env: { ...process.env, QG_DESKTOP_PROFILE_DIR: profile, QG_DESKTOP_USER_DATA_DIR: userData, QG_DESKTOP_LOG_DIR: logs },
    timeout: 30_000
  });
  const page = await application.firstWindow();
  await assertNoVisibleWindow(application, page, 'process-recovery');
  const mainPid = await application.evaluate(() => process.pid);
  // The application opens on Home now (QGD-FRM-0011). Personas is a click away.
  await page.getByRole('navigation', { name: 'Sections' })
    .getByRole('button', { name: 'Callsigns', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Add a callsign' })).toBeVisible();
  await expect.poll(() => ask(page, { type: 'list' }).then(reply => reply.ok)).toBe(true);

  // The fixture is created over IPC and never selected. Selecting a persona in
  // the UI issues a credential-status request, which reads the credential store
  // and would make this suite depend on it.
  stage = 'create the fixture over IPC';
  expect(await ask(page, { type: 'upsert', name: persona, callsign: 'w1aw' })).toMatchObject({ ok: true });

  stage = 'malformed IPC refusal';
  // QGD-PRC-0005: every one of these is refused with the one static message,
  // and none of them is coerced into a valid command.
  const malformed = [
    { type: 'require-credential', persona: 'home', provider: 'qrz' },      // not in the contract
    { type: 'list', extra: 'field' },                                       // unexpected key
    { type: 'status', persona: 'home', provider: 'not-a-provider' },        // provider off the list
    { type: 'upsert', name: persona, callsign: 'W1AW', start: '7 July' },   // wrong date shape
    { type: 'set-preference', persona: 'home', provider: 'qrz', preferred: 'whatever' },
    { type: 'upsert', name: 'x'.repeat(129), callsign: 'W1AW' },            // over the length bound
    { type: 'upsert', name: `bad${control}name`, callsign: 'W1AW' },        // control character
    { type: 'save-credentials', persona: 'home', provider: 'qrz', credentials: { password: 1 } },
    { type: 'remove-secret', persona: 'home', provider: 'qrz', field: 'username' },
    'list', 42, null, []                                                    // not even an object
  ];
  for (const command of malformed) {
    expect(await ask(page, command)).toEqual({ ok: false, error: 'Invalid callsign request.' });
  }
  // The broker's sender rule, exercised rather than inspected. A subframe cannot
  // construct an IPC request at all (no preload runs there), so the frame
  // identity half of the rule is only reachable as a unit test —
  // allowsSender in tests/persona-contract.test.ts. The URL half is reachable
  // from here: pushState moves the frame off the bundled page's exact URL while
  // keeping the same frame, and the broker must refuse. Delete the rule and this
  // assertion fails, which is the point of it.
  stage = 'the broker refuses a frame that is no longer the bundled page';
  const moved = await page.evaluate(async () => {
    history.pushState({}, '', 'index.html?probe=1');
    const movedUrl = location.href;
    const reply = await window.personas.request({ type: 'list' });
    history.pushState({}, '', 'index.html');
    const restoredUrl = location.href;
    const after = await window.personas.request({ type: 'list' });
    return { movedUrl, reply, restoredUrl, afterOk: after.ok };
  });
  expect(moved.movedUrl).toBe('qg://desktop/index.html?probe=1');
  expect(moved.reply).toEqual({ ok: false, error: 'Invalid callsign request.' });
  // And the refusal was about the URL, not a broken service: it answers again
  // once the frame is back on the bundled page.
  expect(moved.restoredUrl).toBe('qg://desktop/index.html');
  expect(moved.afterOk, 'the service did not recover after the frame URL was restored').toBe(true);

  // QGD-PRC-0006 and the broker's sender check: a non-main frame must have no
  // path to the broker. A subframe can be created — window.frames reports it —
  // so the check is load bearing. What it cannot have is the bridge: the preload
  // does not run in subframes, and the main frame cannot reach into it either.
  stage = 'no non-main frame can reach the broker';
  const subframe = await page.evaluate(async () => {
    const frame = document.createElement('iframe');
    frame.src = 'qg://desktop/index.html';
    document.body.appendChild(frame);
    await new Promise(resolve => setTimeout(resolve, 500));
    const reach = run => { try { return run(); } catch (error) { return `threw ${error.name}`; } };
    return {
      created: window.frames.length,
      documentReachable: reach(() => !!frame.contentWindow.document.body),
      bridgeReachable: reach(() => typeof frame.contentWindow.personas)
    };
  });
  expect(subframe.created, 'no subframe was created, so this assertion proves nothing').toBeGreaterThan(0);
  expect(subframe.documentReachable, 'the main frame can reach into a subframe').toBe('threw SecurityError');
  expect(subframe.bridgeReachable, 'the main frame can reach a subframe bridge').toBe('threw SecurityError');
  // And from inside the frame itself, where Playwright can go and script cannot.
  const inFrame = page.frames().filter(frame => frame !== page.mainFrame());
  expect(inFrame.length, 'Playwright sees no subframe to address').toBeGreaterThan(0);
  for (const frame of inFrame) {
    const bridge = await frame.evaluate(() => typeof window.personas).catch(() => 'unreachable');
    expect(['undefined', 'unreachable'], 'a subframe holds the persona bridge').toContain(bridge);
  }

  // Refusing malformed input must not have disturbed the service or the record.
  const intact = await ask(page, { type: 'list' });
  expect(intact.ok).toBe(true);
  expect(intact.data.personas.some(entry => entry.name === persona)).toBe(true);

  // QGD-PRC-0001, in three phases. The outage is held open by moving the
  // service module aside, so the refusal is asserted while recovery is
  // impossible rather than inside a 250 ms restart timer. Elapsed time decides
  // nothing here: a busy host cannot turn the refusal into a success, and a
  // fast host cannot skip it.
  stage = 'hold the outage open';
  const victim = personaUtility(mainPid);
  expect(victim, 'persona utility process not found').toBeTruthy();
  await rename(service, disabled);
  process.kill(victim, 'SIGKILL');

  // Every restart now fails to load, so the broker stays in its refusing state.
  stage = 'requests are refused for as long as the service cannot start';
  for (let attempt = 0; attempt < 3; attempt++) {
    const refused = await ask(page, { type: 'list' });
    expect(refused.ok).toBe(false);
    expect(['Callsigns are restarting. Try again.', 'Callsigns are still starting. Try again.'])
      .toContain(refused.error);
  }

  // QGD-PRC-0001: the window is untouched by a service that cannot start.
  stage = 'window survives the outage';
  expect(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  await expect(page.locator('#active-persona')).toBeVisible();
  expect(await page.evaluate(() => document.title)).toBe('QSO Graph Desktop');

  // The backoff keeps retrying, so restoring the module is enough to recover.
  stage = 'service recovers once it can start again';
  await rename(disabled, service);
  await expect.poll(() => ask(page, { type: 'list' }).then(reply => reply.ok), { timeout: 60_000 }).toBe(true);
  const recovered = await ask(page, { type: 'list' });
  expect(recovered.data.personas.some(entry => entry.name === persona)).toBe(true);
  const replacement = personaUtility(mainPid);
  expect(replacement).toBeTruthy();
  expect(replacement).not.toBe(victim);

  // A plain crash, the case a user actually hits, recovers without help.
  stage = 'plain crash recovers unaided';
  process.kill(replacement, 'SIGKILL');
  await expect.poll(() => ask(page, { type: 'list' }).then(reply => reply.ok), { timeout: 60_000 }).toBe(true);
  const afterPlainCrash = personaUtility(mainPid);
  expect(afterPlainCrash).toBeTruthy();
  expect(afterPlainCrash).not.toBe(replacement);
  expect((await ask(page, { type: 'list' })).data.personas.some(entry => entry.name === persona)).toBe(true);

  // QGD-ENG-0006 and QGD-PRC-0001: QG Storage, killed, is restarted while
  // the window keeps running, and its stores open again.
  stage = 'QG Storage recovers when killed';
  await expect.poll(() => storageState(page), { timeout: 60_000 }).toBe('ready');
  const storageVictim = storageUtility(mainPid);
  expect(storageVictim, 'QG Storage was not identified, so this proves nothing').toBeTruthy();
  expect(storageVictim, 'the storage process and the persona core must be told apart').not.toBe(personaUtility(mainPid));
  process.kill(storageVictim, 'SIGKILL');
  expect(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  await expect.poll(() => storageState(page), { timeout: 60_000 }).toBe('ready');
  const storageReplacement = storageUtility(mainPid);
  expect(storageReplacement).toBeTruthy();
  expect(storageReplacement).not.toBe(storageVictim);
  // And the persona core was not touched by it.
  expect((await ask(page, { type: 'list' })).ok).toBe(true);

  await application.close(); application = undefined;
  console.log('Utility-process crash and recovery, window survival and malformed IPC refusal: PASS');
  console.log('QG Storage killed and restarted with the window running, its stores opened again: PASS');
} catch (error) {
  console.error(`Process recovery test failed at: ${stage}`);
  console.error(redact(error.message).split('\n').slice(0, 20).join('\n'));
  process.exitCode = 1;
} finally {
  if (application) await application.close().catch(() => {});
  await rm(directory, { recursive: true, force: true });
}
