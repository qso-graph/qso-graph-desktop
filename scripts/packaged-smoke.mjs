// SPDX-License-Identifier: GPL-3.0-only
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { chromium, expect } from '@playwright/test';
import { redact } from './report.mjs';
const binary = resolve('out/mac-arm64/QG Desktop.app/Contents/MacOS/QG Desktop');
const directory = await mkdtemp(join(tmpdir(), 'qg-packaged-smoke-'));
const profile = join(directory, 'profile');
const userData = join(directory, 'chromium');
const logs = join(directory, 'logs');
await mkdir(userData, { recursive: true });
const persona = `qg-test-${randomUUID()}`;
const fakeCredential = `QG_FAKE_CREDENTIAL_${randomUUID()}`;
let child, browser, page;
let credentialSaved = false;
async function stop() {
  await browser?.close().catch(() => {}); browser = undefined;
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit'); child.kill('SIGTERM');
    await Promise.race([exited, setTimeout(5000)]);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
}
async function launch() {
  await rm(join(userData, 'DevToolsActivePort'), { force: true });
  // Chromium inspection is enabled only by this isolated test invocation.
  child = spawn(binary, ['--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1'], {
    stdio: 'ignore', env: { ...process.env, QG_DESKTOP_PROFILE_DIR: profile, QG_DESKTOP_USER_DATA_DIR: userData, QG_DESKTOP_LOG_DIR: logs }
  });
  let failed = false; child.on('error', () => { failed = true; });
  let port;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (failed || child.exitCode !== null) throw new Error('Packaged application could not start.');
    try { port = (await readFile(join(userData, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; } catch {}
    await setTimeout(100);
  }
  if (!port || !/^\d+$/.test(port)) throw new Error('Packaged test inspection did not start.');
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0];
  page = context.pages()[0] || await context.waitForEvent('page');
}
try {
  await launch();
  await expect(page.getByRole('heading', { name: 'Create a persona' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.personas.request({ type: 'list' }).then(reply => reply.ok))).toBe(true);
  await page.getByLabel('Persona name', { exact: true }).fill(persona);
  await page.getByLabel('Callsign', { exact: true }).fill('w1aw');
  await page.getByRole('button', { name: 'Create persona', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'W1AW', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Use this persona', exact: true }).click();
  await expect(page.locator('#active-persona')).toContainText('Active: W1AW');
  await page.getByLabel('Service', { exact: true }).selectOption('qrz_logbook');
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
  const username = page.getByLabel('Username', { exact: true });
  await username.fill(fakeCredential);
  // Re-copied inside the poll rather than once before it. The clipboard is the
  // operating system's, shared with whoever is using the machine: a copy made
  // once can be replaced between then and the paste, which is how this failed
  // a run on a machine in use while every assertion in it was correct. Each
  // attempt re-establishes the source, so the only thing being measured is
  // whether a native paste reaches a masked field.
  for (const label of ['Password', 'API key']) {
    const field = page.getByLabel(label, { exact: true });
    await expect.poll(async () => {
      await username.focus();
      await username.press(`${modifier}+a`); await username.press(`${modifier}+c`);
      await field.focus();
      await field.press(`${modifier}+a`); await field.press(`${modifier}+v`);
      return field.inputValue();
    }, { message: `a native paste must reach the ${label} field`, timeout: 15_000 }).toBe(fakeCredential);
  }
  await username.fill('W1AW');
  await username.press(`${modifier}+a`); await username.press(`${modifier}+c`);
  await page.getByLabel('Password', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Save in Keychain', exact: true }).click();
  await expect(page.locator('#credential-status')).toContainText('Stored in Keychain', { timeout: 30_000 });
  credentialSaved = true;
  await expect(page.locator('#api-key-saved')).toBeVisible();
  await expect(page.locator('#password-saved')).toBeHidden();
  expect(await page.getByLabel('API key', { exact: true }).getAttribute('placeholder')).toBe('••••••••');
  expect(await page.getByLabel('API key', { exact: true }).inputValue()).toBe('');
  expect((await readFile(join(profile, 'personas.json'), 'utf8')).includes(fakeCredential)).toBe(false);
  await page.getByLabel('Password', { exact: true }).fill(fakeCredential);
  await page.getByRole('button', { name: 'Save in Keychain', exact: true }).click();
  await expect(page.locator('#password-saved')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#api-key-saved')).toBeVisible();
  await page.getByLabel('Preferred credential', { exact: true }).selectOption('password');
  await expect(page.locator('#credential-effective')).toContainText('Selected for use: password');
  await expect(page.locator('#message')).toHaveText('Preferred credential saved.');
  await stop(); await launch();
  await expect(page.locator('#active-persona')).toContainText('Active: W1AW');
  await page.getByLabel('Service', { exact: true }).selectOption('qrz_logbook');
  await expect(page.locator('#credential-status')).toContainText('Stored in Keychain', { timeout: 30_000 });
  await expect(page.locator('#api-key-saved')).toBeVisible();
  await expect(page.getByLabel('Preferred credential', { exact: true })).toHaveValue('password');
  await expect(page.locator('#credential-effective')).toContainText('Selected for use: password');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Remove password', exact: true }).click();
  await expect(page.locator('#password-saved')).toBeHidden({ timeout: 30_000 });
  await expect(page.locator('#api-key-saved')).toBeVisible();
  await expect(page.locator('#credential-effective')).toContainText('Selected for use: API key');
  expect(await page.getByLabel('API key', { exact: true }).inputValue()).toBe('');
  await page.getByLabel('Service', { exact: true }).selectOption('eqsl');
  await expect(page.locator('#credential-status')).toContainText('No credential saved');
  await expect(page.locator('#api-key-saved')).toBeHidden();
  expect(await page.getByLabel('API key', { exact: true }).getAttribute('placeholder')).toBe('');
  await page.getByLabel('Password', { exact: true }).fill(fakeCredential);
  await page.getByRole('button', { name: 'Save in Keychain', exact: true }).click();
  await expect(page.locator('#password-saved')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByLabel('Password', { exact: true }).inputValue()).toBe('');
  await page.getByRole('button', { name: 'Test credential', exact: true }).click();
  await expect(page.locator('#credential-test-result')).toContainText('Testing for this service is not implemented yet.');
  expect(await page.getByLabel('Password', { exact: true }).getAttribute('placeholder')).toBe('••••••••');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Remove saved credential', exact: true }).click();
  await expect(page.locator('#password-saved')).toBeHidden({ timeout: 30_000 });
  await page.getByLabel('Service', { exact: true }).selectOption('qrz_logbook');
  await expect(page.locator('#api-key-saved')).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Remove saved credential', exact: true }).click();
  await expect(page.locator('#credential-status')).toContainText('No credential saved', { timeout: 30_000 });
  await expect(page.locator('#api-key-saved')).toBeHidden();
  credentialSaved = false;
  await page.getByLabel('API key', { exact: true }).fill(fakeCredential);
  await page.getByRole('button', { name: 'Save in Keychain', exact: true }).click();
  await expect(page.locator('#api-key-saved')).toBeVisible({ timeout: 30_000 });
  credentialSaved = true;
  await page.getByLabel('Service', { exact: true }).selectOption('eqsl');
  await page.getByLabel('Password', { exact: true }).fill(fakeCredential);
  await page.getByRole('button', { name: 'Save in Keychain', exact: true }).click();
  await expect(page.locator('#password-saved')).toBeVisible({ timeout: 30_000 });
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Remove persona', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'W1AW', exact: true })).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Remove persona', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Create a persona' })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#active-persona')).toHaveText('No active persona');
  credentialSaved = false;
  await stop(); await launch();
  await expect(page.getByRole('heading', { name: 'Create a persona' })).toBeVisible();
  await page.getByLabel('Persona name', { exact: true }).fill(persona);
  await page.getByLabel('Callsign', { exact: true }).fill('W1AW');
  await page.getByRole('button', { name: 'Create persona', exact: true }).click();
  await page.getByLabel('Service', { exact: true }).selectOption('qrz_logbook');
  await expect(page.locator('#credential-status')).toContainText('No credential saved');
  await page.getByLabel('Service', { exact: true }).selectOption('eqsl');
  await expect(page.locator('#credential-status')).toContainText('No credential saved');
  console.log('Packaged Rust personas: create, activate, Keychain save, restart and delete: PASS');
} catch (error) {
  console.error('Packaged persona test failed.');
  console.error(redact(error.message).split('\n').slice(0, 15).join('\n'));
  process.exitCode = 1;
} finally {
  if (credentialSaved && page) {
    for (const provider of ['qrz_logbook', 'eqsl']) {
      await page.evaluate(({ persona, provider }) => window.personas.request({ type: 'delete-credentials', persona, provider }), { persona, provider }).catch(() => {});
    }
  }
  await stop(); await rm(directory, { recursive: true, force: true });
}
