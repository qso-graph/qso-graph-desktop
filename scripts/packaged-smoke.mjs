// SPDX-License-Identifier: GPL-3.0-only
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { chromium, expect } from '@playwright/test';
import { redact } from './report.mjs';
// What the screens say on this platform: Keychain, Credential Manager or the keyring.
import { forStore } from '../dist/callsigns/credential-store.js';
const said = text => forStore(text, process.platform);
import { enableTestKeychain } from './keychain-service.mjs';

// Fixtures go to this product's test Keychain service, never beside a real
// credential, and are swept on exit (QGD-CRD-0003). Called before the core is
// loaded, because the service name is read when an entry is made.
enableTestKeychain();
const binary = resolve('out/mac-arm64/QSO Graph Desktop.app/Contents/MacOS/QSO Graph Desktop');
const directory = await mkdtemp(join(tmpdir(), 'qg-packaged-smoke-'));
const profile = join(directory, 'profile');
const userData = join(directory, 'chromium');
const logs = join(directory, 'logs');
await mkdir(userData, { recursive: true });
// The verified ADIF archive, seeded where the packaged application keeps its
// reference sources, so it builds reference.sqlite from it whatever the network
// does. That build runs on a worker inside the packaged QG Storage process,
// which is half of what this suite exists to prove (P4-node-sqlite).
const register = JSON.parse(await readFile('data/reference-sources.json', 'utf8'));
const referenceCache = join(directory, 'reference');
await mkdir(referenceCache, { recursive: true });
await copyFile(resolve('vendor', '.cache', `adif-${register.adif.version}.zip`), join(referenceCache, `adif-${register.adif.version}.zip`));
// The fixture callsign's description.
const description = `qg-test-${randomUUID()}`;
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
    stdio: 'ignore', env: { ...process.env, QG_DESKTOP_PROFILE_DIR: profile, QG_DESKTOP_USER_DATA_DIR: userData, QG_DESKTOP_LOG_DIR: logs, QG_DESKTOP_REFERENCE_CACHE: referenceCache }
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
  // QGD-FRM-0016: a new install shows the welcome, as WSJT-X does. Ticked
  // and closed, it stays hidden for this release, which the relaunches below
  // check. The packaged application ignores the suites' switch for it, so
  // this is the operator's path.
  await expect(page.locator('#welcome')).toBeVisible({ timeout: 30_000 });
  await page.locator('#welcome-hide').check();
  await page.locator('#close-welcome').click();
  await expect(page.locator('#welcome')).toHaveCount(0);
  // The application opens on Home now (QGD-FRM-0011).
  await page.getByRole('navigation', { name: 'Sections' })
    .getByRole('button', { name: 'Callsigns', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Add a callsign' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.callsigns.request({ type: 'list' }).then(reply => reply.ok))).toBe(true);
  await page.getByLabel('Description', { exact: true }).fill(description);
  await page.getByLabel('Callsign', { exact: true }).fill('w1aw');
  await page.getByRole('button', { name: 'Add callsign', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'W1AW', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Use this callsign', exact: true }).click();
  await expect(page.locator('#active-callsign')).toContainText('Callsign: W1AW');
  await page.getByLabel('Service', { exact: true }).selectOption('qrz_logbook');
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
  const username = page.getByLabel('Username', { exact: true });
  await username.fill(fakeCredential);
  // The packaged application is driven over CDP, so Electron's clipboard API is
  // out of reach and the copy has to be made with the keys. Copied once, then
  // the paste alone is retried: re-copying on every attempt races the
  // keystrokes across two fields, which is worse than the flake it was meant
  // to cover.
  await username.press(`${modifier}+a`);
  await username.press(`${modifier}+c`);
  for (const label of ['Password', 'API key']) {
    const field = page.getByLabel(label, { exact: true });
    await expect.poll(async () => {
      await field.focus();
      await field.press(`${modifier}+a`);
      await field.press(`${modifier}+v`);
      return field.inputValue();
    }, { message: `a native paste must reach the ${label} field`, timeout: 15_000 }).toBe(fakeCredential);
  }
  await username.fill('W1AW');
  await username.press(`${modifier}+a`); await username.press(`${modifier}+c`);
  await page.getByLabel('Password', { exact: true }).fill('');
  await page.getByRole('button', { name: said('Save in Keychain'), exact: true }).click();
  await expect(page.locator('#credential-status')).toContainText(said('Stored in Keychain'), { timeout: 30_000 });
  credentialSaved = true;
  await expect(page.locator('#api-key-saved')).toBeVisible();
  await expect(page.locator('#password-saved')).toBeHidden();
  // toHaveAttribute, not a read of getAttribute: the placeholder appears when
  // the Keychain round-trip returns, and a single read races it — which is how
  // this suite failed a run while the application was behaving correctly. The
  // emptiness checks below stay single reads on purpose: retrying one of those
  // would wait out a window in which a secret was on screen, which is the one
  // thing they exist to catch.
  await expect(page.getByLabel('API key', { exact: true })).toHaveAttribute('placeholder', '••••••••');
  expect(await page.getByLabel('API key', { exact: true }).inputValue()).toBe('');
  expect((await readFile(join(profile, 'callsigns.json'), 'utf8')).includes(fakeCredential)).toBe(false);
  await page.getByLabel('Password', { exact: true }).fill(fakeCredential);
  await page.getByRole('button', { name: said('Save in Keychain'), exact: true }).click();
  await expect(page.locator('#password-saved')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#api-key-saved')).toBeVisible();
  await page.getByLabel('Preferred credential', { exact: true }).selectOption('password');
  await expect(page.locator('#credential-effective')).toContainText('Selected for use: password');
  await expect(page.locator('#message')).toHaveText('Preferred credential saved.');
  await stop(); await launch();
  // Hidden for this release: not shown again (QGD-FRM-0016).
  await page.waitForTimeout(1500);
  await expect(page.locator('#welcome')).toHaveCount(0);
  await page.getByRole('navigation', { name: 'Sections' })
    .getByRole('button', { name: 'Callsigns', exact: true }).click();
  await expect(page.locator('#active-callsign')).toContainText('Callsign: W1AW');
  await page.getByLabel('Service', { exact: true }).selectOption('qrz_logbook');
  await expect(page.locator('#credential-status')).toContainText(said('Stored in Keychain'), { timeout: 30_000 });
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
  await expect(page.getByLabel('API key', { exact: true })).toHaveAttribute('placeholder', '');
  await page.getByLabel('Password', { exact: true }).fill(fakeCredential);
  await page.getByRole('button', { name: said('Save in Keychain'), exact: true }).click();
  await expect(page.locator('#password-saved')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByLabel('Password', { exact: true }).inputValue()).toBe('');
  // QGD-CRD-0011: eQSL cannot be tested yet, and that is said without being
  // pressed. It used to be learned by pressing, which left a service with
  // nothing saved showing a dead, silent button.
  await expect(page.getByRole('button', { name: 'Test credential', exact: true })).toBeDisabled();
  await expect(page.locator('#credential-test-result')).toContainText('Testing for this service is not implemented yet.');
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('placeholder', '••••••••');
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
  await page.getByRole('button', { name: said('Save in Keychain'), exact: true }).click();
  await expect(page.locator('#api-key-saved')).toBeVisible({ timeout: 30_000 });
  credentialSaved = true;
  await page.getByLabel('Service', { exact: true }).selectOption('eqsl');
  await page.getByLabel('Password', { exact: true }).fill(fakeCredential);
  await page.getByRole('button', { name: said('Save in Keychain'), exact: true }).click();
  await expect(page.locator('#password-saved')).toBeVisible({ timeout: 30_000 });
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Remove callsign', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'W1AW', exact: true })).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Remove callsign', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Add a callsign' })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#active-callsign')).toHaveText('No active callsign');
  credentialSaved = false;
  await stop(); await launch();
  await page.getByRole('navigation', { name: 'Sections' })
    .getByRole('button', { name: 'Callsigns', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Add a callsign' })).toBeVisible();
  await page.getByLabel('Description', { exact: true }).fill(description);
  await page.getByLabel('Callsign', { exact: true }).fill('W1AW');
  await page.getByRole('button', { name: 'Add callsign', exact: true }).click();
  await page.getByLabel('Service', { exact: true }).selectOption('qrz_logbook');
  await expect(page.locator('#credential-status')).toContainText('No credential saved');
  await page.getByLabel('Service', { exact: true }).selectOption('eqsl');
  await expect(page.locator('#credential-status')).toContainText('No credential saved');
  // P4-node-sqlite, in the package a user would have: node:sqlite opens
  // state.sqlite in the packaged QG Storage process, loaded from the ASAR, and
  // the reference build runs on its worker there. Nothing here points at the
  // repository. Its detail is behind Troubleshooting (QGD-LOG-0013).
  await expect(page.locator('#engine-indicator'), 'no database indicator ships').toHaveCount(0);
  // Nothing is fetched at start (KI7MT, 2026-10-11): ADIF's definitions are
  // loaded from Settings, as an operator does, from the archive put in the
  // cache before launch.
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Download ADIF definitions' }).click();
  await page.locator('#open-troubleshooting').click();
  await expect(page.locator('#troubleshooting')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Storage', exact: true })).toBeVisible();
  await expect.poll(() => page.getByLabel('State', { exact: true }).inputValue(),
    { message: 'the packaged application must open its own stores', timeout: 60_000 })
    .toBe('Ready');
  await expect.poll(() => page.locator('#reference-datasets').innerText(),
    { message: 'the packaged application must build reference.sqlite on its worker', timeout: 120_000 })
    .toContain(`ADIF definitions, ${register.adif.version}`);
  console.log('Packaged storage: node:sqlite opened the stores from the ASAR, and the reference build ran on its worker: PASS');

  console.log('Packaged Rust callsigns: create, activate, Keychain save, restart and delete: PASS');
} catch (error) {
  console.error('Packaged callsign test failed.');
  console.error(redact(error.message).split('\n').slice(0, 15).join('\n'));
  process.exitCode = 1;
} finally {
  if (credentialSaved && page) {
    for (const provider of ['qrz_logbook', 'eqsl']) {
      await page.evaluate(async ({ description, provider }) => {
        const list = await window.callsigns.request({ type: 'list' });
        const id = list.ok ? list.data.callsigns.find(entry => entry.description === description)?.id : undefined;
        if (id) await window.callsigns.request({ type: 'delete-credentials', id, provider });
      }, { description, provider }).catch(() => {});
    }
  }
  await stop(); await rm(directory, { recursive: true, force: true });
}
