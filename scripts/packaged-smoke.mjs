// SPDX-License-Identifier: GPL-3.0-only
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { copyFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
// The packaged application: the signed Mac bundle, or on Windows the copy the
// installer put on the runner (QG_PACKAGED_APP, set by CI after a silent
// install, #91), so the installer's own steps run before it is launched.
const binary = process.env.QG_PACKAGED_APP
  ? resolve(process.env.QG_PACKAGED_APP)
  : resolve('out/mac-arm64/QSO Graph Desktop.app/Contents/MacOS/QSO Graph Desktop');
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
// The update check off, by its own switch (QGD-FRM-0019): a packaged build of
// a release version would otherwise ask for the feed a minute in, and a test
// run is not a station asking for updates.
await mkdir(userData, { recursive: true });
await writeFile(join(userData, 'settings.json'), JSON.stringify({ updateCheck: false }));
// The fixture callsign's description.
const description = `qg-test-${randomUUID()}`;
const fakeCredential = `QG_FAKE_CREDENTIAL_${randomUUID()}`;
let child, browser, page;
let credentialSaved = false;
async function stop() {
  await browser?.close().catch(() => {}); browser = undefined;
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit');
    // On Windows a kill ends the main process only, and the application's
    // storage process kept state.sqlite open after it, so the run's folder
    // could not be deleted (#91's installed-build run). Its whole process
    // tree, there; the fixed system path, with an argument list.
    if (process.platform === 'win32') {
      spawnSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      child.kill('SIGTERM');
    }
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
  // QGD-FRM-0016: a new install opens on Home with nothing over it and no
  // line about an update: it records its version, which the relaunch below
  // then finds changed.
  await expect(page.locator('#home-pinned-title')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#whats-new')).toHaveCount(0);
  await expect(page.locator('#update-strip')).toHaveCount(0);
  // QGD-SEC-0014 at run time (#158): what Electron applied to the packaged
  // window, seen from inside it, where the static audit reads the code. No
  // Node in the page, and contextIsolation keeps the preload's own world out
  // of it: only the named bridges are there. A new window is refused. A
  // navigation away is refused too (will-navigate), which electron-audit holds
  // in the packaged code; it is not tried here, because Playwright then waits
  // for a navigation the application cancelled, and the next step times out
  // on a page that is fine (probed 2026-11-02: unchanged, complete, visible).
  const inside = await page.evaluate(() => ({
    require: typeof globalThis.require, process: typeof globalThis.process, module: typeof globalThis.module,
    ipcRenderer: typeof globalThis.ipcRenderer, electron: typeof globalThis.electron,
    bridge: typeof window.callsigns?.request,
    opened: window.open('https://example.com/') === null
  }));
  expect(inside).toEqual({ require: 'undefined', process: 'undefined', module: 'undefined', ipcRenderer: 'undefined',
    electron: 'undefined', bridge: 'function', opened: true });
  expect(browser.contexts().flatMap(context => context.pages()).length, 'window.open made no window').toBe(1);
  // The application opens on Home now (QGD-FRM-0011).
  await page.getByRole('navigation', { name: 'Sections' })
    .getByRole('button', { name: 'Callsigns', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Add a callsign' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.callsigns.request({ type: 'list' }).then(reply => reply.ok))).toBe(true);
  await page.getByLabel('Description', { exact: true }).fill(description);
  await page.getByLabel('Callsign', { exact: true }).fill('w1aw');
  await page.getByRole('button', { name: 'Add callsign', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'W1AW', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Make W1AW active', exact: true }).click();
  await expect(page.locator('#active-callsign')).toContainText('Callsign: W1AW');
  // QRZ lookup shows a username and a password; QRZ Logbook its API key alone
  // (KI7MT, 2026-11-01: a service shows only the fields it takes).
  await page.getByLabel('Service', { exact: true }).selectOption('qrz');
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
  for (const [provider, label] of [['qrz', 'Password'], ['qrz_logbook', 'API key']]) {
    await page.getByLabel('Service', { exact: true }).selectOption(provider);
    const field = page.getByLabel(label, { exact: true });
    await expect.poll(async () => {
      await field.focus();
      await field.press(`${modifier}+a`);
      await field.press(`${modifier}+v`);
      return field.inputValue();
    }, { message: `a native paste must reach the ${label} field`, timeout: 15_000 }).toBe(fakeCredential);
  }
  // QRZ Logbook, now selected: no username, no password, nothing to prefer.
  await expect(page.locator('#username-field')).toBeHidden();
  await expect(page.locator('#password-field')).toBeHidden();
  await expect(page.locator('#preference-field')).toBeHidden();
  await page.getByRole('button', { name: said('Save in Keychain'), exact: true }).click();
  await expect(page.locator('#credential-status')).toContainText(said('Stored in Keychain'), { timeout: 30_000 });
  credentialSaved = true;
  await expect(page.locator('#api-key-saved')).toBeVisible();
  // toHaveAttribute, not a read of getAttribute: the placeholder appears when
  // the Keychain round-trip returns, and a single read races it — which is how
  // this suite failed a run while the application was behaving correctly. The
  // emptiness checks below stay single reads on purpose: retrying one of those
  // would wait out a window in which a secret was on screen, which is the one
  // thing they exist to catch.
  await expect(page.getByLabel('API key', { exact: true })).toHaveAttribute('placeholder', '••••••••');
  expect(await page.getByLabel('API key', { exact: true }).inputValue()).toBe('');
  expect((await readFile(join(profile, 'callsigns.json'), 'utf8')).includes(fakeCredential)).toBe(false);
  // The preference between a saved password and API key, and its surviving a
  // restart, is the core's and is held by the credential-editing suite: no
  // registered service takes both, so the screen never offers the choice.
  await stop();
  // As if it had been updated from an earlier version (QGD-FRM-0016): Home
  // says so in one line, the notes open from it, and once read the line is
  // gone and stays gone across a restart.
  const settingsFile = join(userData, 'settings.json');
  const recorded = JSON.parse(await readFile(settingsFile, 'utf8'));
  expect(recorded.seenVersion, 'a new install records the version it is').toMatch(/^\d+\.\d+\.\d+/);
  await writeFile(settingsFile, JSON.stringify({ ...recorded, seenVersion: '0.0.1' }));
  await launch();
  await expect(page.locator('#update-strip')).toContainText('Updated to', { timeout: 30_000 });
  await page.locator('#update-strip-notes').click();
  await expect(page.locator('#whats-new')).toBeVisible();
  await page.locator('#close-whats-new').click();
  await expect(page.locator('#whats-new')).toHaveCount(0);
  await expect(page.locator('#update-strip')).toHaveCount(0);
  await stop(); await launch();
  await expect(page.locator('#home-pinned-title')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#update-strip')).toHaveCount(0);
  await page.getByRole('navigation', { name: 'Sections' })
    .getByRole('button', { name: 'Callsigns', exact: true }).click();
  await expect(page.locator('#active-callsign')).toContainText('Callsign: W1AW');
  await page.getByLabel('Service', { exact: true }).selectOption('qrz_logbook');
  await expect(page.locator('#credential-status')).toContainText(said('Stored in Keychain'), { timeout: 30_000 });
  await expect(page.locator('#api-key-saved')).toBeVisible();
  await expect(page.locator('#preference-field')).toBeHidden();
  expect(await page.getByLabel('API key', { exact: true }).inputValue()).toBe('');
  await page.getByLabel('Service', { exact: true }).selectOption('eqsl');
  await expect(page.locator('#credential-status')).toContainText('No credential saved');
  // eQSL takes a callsign and a password: no API key field, nothing to prefer.
  await expect(page.locator('#api-key-field')).toBeHidden();
  await expect(page.locator('#password-field')).toBeVisible();
  await expect(page.locator('#preference-field')).toBeHidden();
  // QGD-CRD-0011: a control that cannot be used says why without being
  // pressed. eQSL can be tested since #9, so what stops it here is that
  // nothing is saved to test.
  await expect(page.getByRole('button', { name: 'Test credential', exact: true })).toBeDisabled();
  await expect(page.locator('#credential-test-result')).toContainText('Save a username and password or API key first');
  await page.getByLabel('Password', { exact: true }).fill(fakeCredential);
  await page.getByRole('button', { name: said('Save in Keychain'), exact: true }).click();
  await expect(page.locator('#password-saved')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByLabel('Password', { exact: true }).inputValue()).toBe('');
  // Saved, it can be pressed. It is not pressed: that would send a fake
  // credential to eQSL, and no suite signs in anywhere for real.
  await expect(page.getByRole('button', { name: 'Test credential', exact: true })).toBeEnabled();
  await expect(page.locator('#credential-test-result')).toContainText('Not tested yet.');
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
  // What the window showed and what the application logged, kept in report/
  // for CI to upload: the run's folder is deleted below, and a failure on one
  // platform alone (the installed Windows build, #91) cannot be guessed at.
  // The logs are the application's own, redacted as they were written, and
  // the credential in this run is the suite's fake.
  await mkdir('report', { recursive: true }).catch(() => {});
  await page?.screenshot({ path: join('report', 'packaged-launch.png'), fullPage: true }).catch(() => {});
  await cp(logs, join('report', 'packaged-launch-logs'), { recursive: true }).catch(() => {});
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
  // Retried: a file a process held open a moment ago may still be closing.
  await stop(); await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
}
