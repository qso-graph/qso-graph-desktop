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
import { cp, mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { redact } from './report.mjs';

const directory = await mkdtemp(join(tmpdir(), 'qg-process-recovery-'));
const profile = join(directory, 'profile');
const userData = join(directory, 'chromium');
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
const service = join(application_directory, 'dist/persona-service.js');
const disabled = `${service}.disabled`;

// The persona core runs as an Electron utility process, a child of main.
function personaUtility(mainPid) {
  const ps = spawnSync('/bin/ps', ['-ax', '-o', 'pid=,ppid=,command='], { encoding: 'utf8' });
  for (const line of (ps.stdout || '').split('\n')) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
    if (!match) continue;
    const [, pid, parent, command] = match;
    if (Number(parent) === mainPid && command.includes('--utility-sub-type=node.mojom.NodeService')) return Number(pid);
  }
  return undefined;
}
const ask = (page, command) => page.evaluate(sent => window.personas.request(sent), command);

try {
  await mkdir(application_directory, { recursive: true });
  await cp('dist', join(application_directory, 'dist'), { recursive: true });
  await cp('package.json', join(application_directory, 'package.json'));
  application = await electron.launch({
    args: ['.'], cwd: application_directory,
    executablePath: resolve('node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),
    env: { ...process.env, QG_DESKTOP_PROFILE_DIR: profile, QG_DESKTOP_USER_DATA_DIR: userData },
    timeout: 30_000
  });
  const page = await application.firstWindow();
  const mainPid = await application.evaluate(() => process.pid);
  await expect(page.getByRole('heading', { name: 'Create a persona' })).toBeVisible();
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
    expect(await ask(page, command)).toEqual({ ok: false, error: 'Invalid persona request.' });
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
    expect(['The persona service is restarting. Try again.', 'The persona service is starting. Try again.'])
      .toContain(refused.error);
  }

  // QGD-PRC-0001: the window is untouched by a service that cannot start.
  stage = 'window survives the outage';
  expect(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  await expect(page.locator('#active-persona')).toBeVisible();
  expect(await page.evaluate(() => document.title)).toBe('QG Desktop');

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

  await application.close(); application = undefined;
  console.log('Utility-process crash and recovery, window survival and malformed IPC refusal: PASS');
} catch (error) {
  console.error(`Process recovery test failed at: ${stage}`);
  console.error(redact(error.message).split('\n').slice(0, 20).join('\n'));
  process.exitCode = 1;
} finally {
  if (application) await application.close().catch(() => {});
  await rm(directory, { recursive: true, force: true });
}
