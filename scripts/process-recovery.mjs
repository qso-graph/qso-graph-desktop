// SPDX-License-Identifier: GPL-3.0-only
// QGD-PRC-0001: a crash in one process never takes the application down.
// QGD-PRC-0005: IPC is a typed contract; malformed messages are rejected, not coerced.
// QGD-PRT-0102's exit gate: killing a utility process leaves the window running
// and the process recovers.
//
// No credential is read here, so this suite does not depend on the credential
// store and reports its own result when the round-trip fails.
import { _electron as electron, expect } from '@playwright/test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
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
  application = await electron.launch({
    args: ['.'], cwd: process.cwd(),
    env: { ...process.env, QG_DESKTOP_PROFILE_DIR: profile, QG_DESKTOP_USER_DATA_DIR: userData },
    timeout: 30_000
  });
  const page = await application.firstWindow();
  const mainPid = await application.evaluate(() => process.pid);
  await expect(page.getByRole('heading', { name: 'Create a persona' })).toBeVisible();
  await expect.poll(() => ask(page, { type: 'list' }).then(reply => reply.ok)).toBe(true);

  await page.getByLabel('Persona name', { exact: true }).fill(persona);
  await page.getByLabel('Callsign', { exact: true }).fill('w1aw');
  await page.getByRole('button', { name: 'Create persona', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'W1AW', exact: true })).toBeVisible();

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

  // QGD-PRC-0001: kill the utility process twice and the window survives both.
  for (const attempt of [1, 2]) {
    stage = `crash ${attempt}: locate the utility process`;
    const victim = personaUtility(mainPid);
    expect(victim, `persona utility process not found on attempt ${attempt}`).toBeTruthy();
    process.kill(victim, 'SIGKILL');

    // The window is still there and still answering while the service is gone.
    stage = `crash ${attempt}: window survives`;
    expect(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
    await expect(page.getByRole('heading', { name: 'W1AW', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.title)).toBe('QG Desktop');

    // A request in the gap is refused with a static, credential-free message.
    stage = `crash ${attempt}: request during the outage`;
    const duringOutage = await ask(page, { type: 'list' });
    if (duringOutage.ok === false) {
      expect(['The persona service is restarting. Try again.', 'The persona service is starting. Try again.'])
        .toContain(duringOutage.error);
    }

    // The service comes back on its own and the record is unchanged.
    stage = `crash ${attempt}: service recovers`;
    await expect.poll(() => ask(page, { type: 'list' }).then(reply => reply.ok), { timeout: 30_000 }).toBe(true);
    const recovered = await ask(page, { type: 'list' });
    expect(recovered.data.personas.some(entry => entry.name === persona)).toBe(true);

    const replacement = personaUtility(mainPid);
    expect(replacement).toBeTruthy();
    expect(replacement).not.toBe(victim);
  }

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
