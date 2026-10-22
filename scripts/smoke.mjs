// SPDX-License-Identifier: GPL-3.0-only
import { _electron as electron, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire as createElectronRequire } from 'node:module';
import { mkdir, mkdtemp, readdir, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { redact } from './report.mjs';
import { freeze } from './platform-process.mjs';
// What the screens say on this platform: Keychain, Credential Manager or the keyring.
import { forStore } from '../dist/personas/credential-store.js';
const said = text => forStore(text, process.platform);
import { entries } from './unzip.mjs';
import { enableTestKeychain } from './keychain-service.mjs';
import { assertNoVisibleWindow } from './no-visible-window.mjs';

// Fixtures go to this product's test Keychain service, never beside a real
// credential, and are swept on exit (QGD-CRD-0003). Called before the core is
// loaded, because the service name is read when an entry is made.
enableTestKeychain();

let application;
let notesStorage = 'not reached';
let notesSecrets = 'not reached';
let notesServices = 'not reached';
const directory = await mkdtemp(join(tmpdir(), 'qg-persona-ui-'));
const profile = join(directory, 'profile');
const userData = join(directory, 'chromium');
const logs = join(directory, 'logs');
await mkdir(userData, { recursive: true });
const persona = `qg-test-${randomUUID()}`;
const fakeCredential = `QG_FAKE_CREDENTIAL_${randomUUID()}`;

// QGD-CRD-0009: the core logs every decryption of a stored credential, and
// that log is the only honest way to assert that nothing decrypted one. A
// count rather than a flag, so "no new reads" can be told from "no reads
// ever".
const secretReads = async () => {
  const text = await readFile(join(logs, 'qg-desktop.log'), 'utf8').catch(() => '');
  return text.split('\n').filter(Boolean)
    .map(line => { try { return JSON.parse(line); } catch { return undefined; } })
    .filter(entry => entry?.msg === 'credential secret read').length;
};

const launch = () => electron.launch({ args: ['.'], cwd: process.cwd(), env: { ...process.env, QG_DESKTOP_NO_WELCOME: '1', QG_DESKTOP_PROFILE_DIR: profile, QG_DESKTOP_USER_DATA_DIR: userData, QG_DESKTOP_LOG_DIR: logs }, timeout: 30_000 });
try {
  application = await launch();
  let page = await application.firstWindow();
  await assertNoVisibleWindow(application, page, 'smoke');
  // The application opens on Home now (QGD-FRM-0011). Personas is a click away.
  await page.getByRole('navigation', { name: 'Sections' })
    .getByRole('button', { name: 'Callsigns', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Add a callsign' })).toBeVisible();
  expect(application.windows()).toHaveLength(1);
  const preferences = await application.evaluate(({ BrowserWindow, session }) => {
    const prefs = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return { sandbox: prefs.sandbox, contextIsolation: prefs.contextIsolation, nodeIntegration: prefs.nodeIntegration, spellcheck: session.defaultSession.isSpellCheckerEnabled() };
  });
  expect(preferences).toEqual({ sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false });
  // QGD-PRC-0007: a second launch exits and raises the window already open.
  // Two instances would both own the profile, the settings file and the
  // Keychain entries QGD-CRD-0003 keys by name rather than by profile.
  {
    // Minimised first, because the lock is only half the requirement: the
    // second launch must also raise the window already open. Without this the
    // second-instance handler could be deleted and these assertions would
    // still pass — the lock alone makes the second process exit.
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
    await expect.poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized()),
      { message: 'the window must minimise', timeout: 30_000 }).toBe(true);

    const electronBinary = createElectronRequire(import.meta.url)('electron');
    const second = spawn(electronBinary, ['.'], {
      cwd: process.cwd(), stdio: 'ignore',
      env: { ...process.env, QG_DESKTOP_NO_WELCOME: '1', QG_DESKTOP_PROFILE_DIR: profile, QG_DESKTOP_USER_DATA_DIR: userData, QG_DESKTOP_LOG_DIR: logs }
    });
    const exited = await Promise.race([
      once(second, 'exit').then(([code]) => code),
      new Promise(resolve => setTimeout(() => resolve('still running'), 20_000))
    ]);
    if (exited === 'still running') { second.kill('SIGKILL'); }
    expect(exited, 'a second launch must exit rather than open a second application').not.toBe('still running');
    // And the window already open is raised rather than left where it was.
    await expect.poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized()),
      { message: 'a second launch must restore the window already open', timeout: 30_000 }).toBe(false);
    // Still one application, still answering.
    expect(application.windows()).toHaveLength(1);
    await expect.poll(() => page.evaluate(() => window.personas.request({ type: 'list' }).then(reply => reply.ok)),
      { message: 'the persona service must still answer after a second launch', timeout: 30_000 }).toBe(true);
  }

  expect(await page.evaluate(() => 'require' in window || 'process' in window)).toBe(false);
  expect(await page.evaluate(async () => {
    try { await fetch('https://example.invalid/'); return 'allowed'; }
    catch { return 'denied'; }
  })).toBe('denied');
  expect(await page.evaluate(() => window.open('https://example.invalid/'))).toBeNull();
  const permission = await page.evaluate(() => navigator.permissions.query({ name: 'geolocation' }).then(result => result.state));
  expect(permission).toBe('denied');
  await expect.poll(() => page.evaluate(() => window.personas.request({ type: 'list' }).then(reply => reply.ok)),
    { message: 'the persona service must answer', timeout: 30_000 }).toBe(true);
  expect(await page.evaluate(() => window.personas.request({ type: 'require-credential', persona: 'home', provider: 'qrz' }))).toEqual({ ok: false, error: 'Invalid callsign request.' });
  await page.getByLabel('Description', { exact: true }).fill(persona);
  await page.getByLabel('Callsign', { exact: true }).fill('w1aw');
  // Typed lowercase, shown uppercase as it is typed (QGD-CNV-0001, QGD-CNV-0016).
  await expect(page.getByLabel('Callsign', { exact: true })).toHaveValue('W1AW');
  await page.getByLabel('Start date', { exact: true }).fill('2026-01-01');
  await page.getByRole('button', { name: 'Add callsign', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'W1AW', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Use this callsign', exact: true }).click();
  await expect(page.locator('#active-persona')).toContainText('Callsign: W1AW');
  await page.getByLabel('Service', { exact: true }).selectOption('qrz_logbook');
  const editRoles = await application.evaluate(({ Menu }) => Menu.getApplicationMenu().items.find(item => item.label === 'Edit').submenu.items.map(item => item.role));
  for (const role of ['cut', 'copy', 'paste', 'selectall']) expect(editRoles).toContain(role);
  // Exercise native keyboard editing with a synthetic value, including both
  // masked credential fields. No saved user credential is read or revealed.
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
  const usernameField = page.getByLabel('Username', { exact: true });
  await usernameField.fill(fakeCredential);
  // Copy, measured where it lands. Pressing the keys and then reading another
  // field conflates two things; this asserts the copy reached the system
  // clipboard, which is the half the Edit menu roles are for.
  await usernameField.press(`${modifier}+a`);
  await usernameField.press(`${modifier}+c`);
  await expect.poll(() => application.evaluate(({ clipboard }) => clipboard.readText()),
    { message: 'a native copy must reach the system clipboard' }).toBe(fakeCredential);

  // Paste, with the clipboard set rather than copied. The clipboard belongs to
  // the operating system and is shared with whoever is using the machine, so
  // copying into it from one field and pasting out of it into another measures
  // the machine's state as much as the application's — it failed a run that
  // way on a machine in use. Setting it is deterministic and still measures
  // what this is for: a native paste reaching a masked field.
  for (const label of ['Password', 'API key']) {
    const field = page.getByLabel(label, { exact: true });
    await expect.poll(async () => {
      await application.evaluate(({ clipboard }, value) => clipboard.writeText(value), fakeCredential);
      await field.focus();
      await field.press(`${modifier}+a`);
      await field.press(`${modifier}+v`);
      return field.inputValue();
    }, { message: `a native paste must reach the ${label} field`, timeout: 15_000 }).toBe(fakeCredential);
  }
  await application.evaluate(({ clipboard }) => clipboard.clear());
  await usernameField.fill('W1AW');
  await page.getByLabel('Password', { exact: true }).fill('');
  await page.getByRole('button', { name: said('Save in Keychain'), exact: true }).click();
  await expect(page.locator('#credential-status')).toContainText(said('Stored in Keychain'), { timeout: 30_000 });
  expect(await page.getByLabel('API key', { exact: true }).inputValue()).toBe('');
  expect((await page.locator('body').innerText()).includes(fakeCredential)).toBe(false);
  const index = await readFile(join(profile, 'personas.json'), 'utf8');
  expect(index.includes(fakeCredential)).toBe(false);

  // A secret the operator did not enter is not saved, however it got into the
  // field.
  //
  // KI7MT, 2026-10-09, after packaged-launch stored a password into an entry
  // whose Password field the suite had just emptied: a security bug, not a
  // record entry. It has not been reproduced — twelve runs since, eight of
  // them under load — so this does not test a known mechanism. It tests that
  // the mechanism no longer matters: the save sends what the operator typed in
  // that action, not what the field happens to hold when the button is
  // pressed, so a stale value, an autofill, or a paste landing late while
  // focus moves cannot reach the Keychain.
  //
  // The value is assigned through .value with no input event, which is
  // precisely what a person cannot do and everything else can.
  //
  // The completion signal is #message, not the indicator. The first version of
  // this check asserted #password-saved hidden straight after the click and
  // passed against the unfixed application, because it read the indicator
  // before the save round-trip had come back — a control that cannot fail is
  // not a control. Switching the service away and back clears #message
  // (app.ts does it on every provider change), so its reappearance is the
  // save's own answer and nothing else.
  {
    const planted = `QG_FAKE_CREDENTIAL_PLANTED_${randomUUID()}`;
    const service = page.getByLabel('Service', { exact: true });
    await service.selectOption('eqsl');
    await service.selectOption('qrz_logbook');
    await expect(page.locator('#credential-status')).toContainText(said('Stored in Keychain'), { timeout: 30_000 });
    await expect(page.locator('#message')).toHaveText('');

    // The API key is typed, so the save is a real one that completes — this is
    // the shape of the run that failed: one field the operator filled, one
    // holding a value they did not. With both fields untouched the application
    // refuses the save outright ("Enter a password or API key"), which is
    // correct and would not exercise this.
    const freshApiKey = `QG_FAKE_CREDENTIAL_${randomUUID()}`;
    await page.getByLabel('API key', { exact: true }).fill(freshApiKey);
    await page.evaluate(value => {
      // No dispatchEvent: the point is a field holding something the operator
      // never put there.
      document.getElementById('password').value = value;
    }, planted);
    expect(await page.getByLabel('Password', { exact: true }).inputValue()).toBe(planted);
    await page.getByRole('button', { name: said('Save in Keychain'), exact: true }).click();
    await expect(page.locator('#message')).toHaveText(said('Credential saved in macOS Keychain.'), { timeout: 30_000 });
    await expect(page.locator('#api-key-saved')).toBeVisible();
    await expect(page.locator('#password-saved')).toBeHidden();
    expect((await readFile(join(profile, 'personas.json'), 'utf8')).includes(planted)).toBe(false);

    // The control for the control: the same value, typed, is saved. Without
    // this the check above would pass on an application that had simply
    // stopped saving passwords.
    await service.selectOption('eqsl');
    await service.selectOption('qrz_logbook');
    await expect(page.locator('#message')).toHaveText('');
    await page.getByLabel('Password', { exact: true }).fill(planted);
    await page.getByRole('button', { name: said('Save in Keychain'), exact: true }).click();
    await expect(page.locator('#message')).toHaveText(said('Credential saved in macOS Keychain.'), { timeout: 30_000 });
    await expect(page.locator('#password-saved')).toBeVisible({ timeout: 30_000 });

    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Remove password', exact: true }).click();
    await expect(page.locator('#password-saved')).toBeHidden({ timeout: 30_000 });
    await expect(page.locator('#api-key-saved')).toBeVisible();
  }

  // QGD-CRD-0009 and QGD-CRD-0010. This restart is the exact thing KI7MT hit:
  // a persona with a saved credential, remembered as active, and the
  // application opening on it. It used to read the secret to draw the status,
  // and macOS asked him for his login keychain password before he had done
  // anything.
  const readsBefore = await secretReads();
  await application.close(); application = undefined;
  application = await launch(); page = await application.firstWindow();
  // A restart opens on Home (QGD-FRM-0011), which is the point: the status
  // below is read after navigating there deliberately, not on the way past.
  await page.getByRole('navigation', { name: 'Sections' })
    .getByRole('button', { name: 'Callsigns', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'W1AW', exact: true })).toBeVisible();
  await expect(page.locator('#active-persona')).toContainText('Callsign: W1AW');
  await page.getByLabel('Service', { exact: true }).selectOption('qrz_logbook');
  // The status is drawn, and drawn correctly, from metadata alone.
  await expect(page.locator('#credential-status')).toContainText(said('Stored in Keychain'), { timeout: 30_000 });
  await expect(page.locator('#api-key-saved')).toBeVisible();

  {
    // Every page, and the persona selected again, with nothing decrypted.
    const railItem = name => page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name, exact: true });
    for (const name of ['Settings', 'Callsigns', 'Settings', 'Callsigns']) {
      await railItem(name).click();
      await expect(page.getByRole('navigation', { name: 'Sections' })).toBeVisible();
    }
    await page.locator('.persona-item').first().click();
    await expect(page.locator('#credential-status')).toContainText(said('Stored in Keychain'), { timeout: 30_000 });
    for (const provider of ['eqsl', 'qrz_logbook']) {
      await page.getByLabel('Service', { exact: true }).selectOption(provider);
      await expect(page.locator('#credential-status')).not.toHaveText('Checking saved credentials…', { timeout: 30_000 });
    }

    const afterNavigating = await secretReads();
    expect(afterNavigating - readsBefore,
      'starting, navigating and selecting a persona must decrypt nothing').toBe(0);

    // And the control, so zero means something: an explicit action that needs
    // the secret does read it.
    await page.getByRole('button', { name: 'Test credential', exact: true }).click();
    await expect(page.locator('#credential-test-result')).not.toHaveText('Not tested yet.', { timeout: 30_000 });
    await expect.poll(secretReads, { message: 'testing a credential must read the secret', timeout: 30_000 })
      .toBeGreaterThan(afterNavigating);
    notesSecrets = `${afterNavigating - readsBefore} on startup and navigation, ${await secretReads() - afterNavigating} on an explicit test`;
  }
  // ---- QGD-LOG-0013: Troubleshooting works without Settings -------------
  // Before anything navigates, because that is the whole point.
  //
  // The logs were read while `page === 'settings'`, which is where they used
  // to be shown. After they moved to Troubleshooting, opening the panel from
  // Home left it reading "Reading the log settings…" with no level switch and
  // no way to save a bundle — and this suite did not catch it, because it
  // visits Settings further down for the navigation checks and that happened
  // to fetch them first. So the check goes here, where nothing has navigated
  // yet. Found in review.
  await expect(page.getByRole('navigation', { name: 'Sections' })).toBeVisible();
  // The guard that makes this check mean anything: Settings must not have been
  // opened yet, since opening it is what used to fetch the logs.
  expect(await page.getByRole('navigation', { name: 'Sections' })
    .getByRole('button', { name: 'Settings', exact: true }).getAttribute('aria-current'),
    'this check is only meaningful before Settings has been opened').toBeNull();
  await page.locator('#open-troubleshooting').click();
  await expect(page.locator('#troubleshooting')).toBeVisible();
  await expect(page.getByLabel('Detail level', { exact: true }),
    'the level switch must be there without Settings having been opened').toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Export diagnostics', exact: true })).toBeVisible();
  await page.locator('#close-troubleshooting').click();
  await expect(page.locator('#troubleshooting')).toHaveCount(0);

  // ---- P3: the shell ----------------------------------------------------
  await mkdir('report', { recursive: true });
  // P3-navigation: the rail moves between pages and the document never does.
  const before = page.url();
  await expect(page.getByRole('navigation', { name: 'Sections' })).toBeVisible();
  const rail = name => page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name, exact: true });
  await rail('Settings').click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Callsign details', exact: true })).toBeHidden();
  expect(await rail('Settings').getAttribute('aria-current')).toBe('page');
  expect(await rail('Callsigns').getAttribute('aria-current')).toBeNull();
  // P3-status-bar: the active persona is on every page, not just its own.
  await expect(page.locator('#active-persona')).toContainText('Callsign: W1AW');
  // QGD-PRC-0006: one bundled page. Navigating a section is not navigation.
  expect(page.url()).toBe(before);
  expect(await page.evaluate(() => history.length)).toBe(1);

  // P3-keyboard: every rail item is reachable and operable from the keyboard.
  await rail('Callsigns').focus();
  // Trimmed: the button is an icon above a label, so its text carries the
  // whitespace between them.
  expect((await page.evaluate(() => document.activeElement?.textContent ?? '')).trim()).toBe('Callsigns');
  const outline = await page.evaluate(() => getComputedStyle(document.activeElement, null).outlineWidth);
  expect(parseFloat(outline), 'the focused rail item must show a focus indicator').toBeGreaterThan(0);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Callsign details', exact: true })).toBeVisible();
  await rail('Settings').click();

  // The rail's icons carry a label and a tooltip, and the label is what is
  // read aloud: getByRole resolves these by accessible name, so every rail()
  // call above already proves the names. The tooltips and the ordering are
  // what is left.
  for (const name of ['Callsigns', 'Settings']) {
    const tooltip = await rail(name).getAttribute('title');
    expect(tooltip && tooltip.length > name.length, `${name} must carry a tooltip`).toBe(true);
    // An icon is drawn and hidden from assistive technology, which reads the
    // label instead.
    expect(await rail(name).locator('svg[aria-hidden="true"]').count(), `${name} icon`).toBe(1);
  }
  // Settings sits at the bottom of the rail, below everything else and near
  // the foot of it.
  const railBox = await page.getByRole('navigation', { name: 'Sections' }).boundingBox();
  const personasBox = await rail('Callsigns').boundingBox();
  const settingsBox = await rail('Settings').boundingBox();
  expect(settingsBox.y).toBeGreaterThan(personasBox.y);
  const gapBelow = railBox.y + railBox.height - (settingsBox.y + settingsBox.height);
  expect(gapBelow, 'Settings must sit at the foot of the rail').toBeLessThan(40);

  // P3-theme-override: System, Light and Dark, with Dark the default
  // (KI7MT, 2026-10-22; it was System until then).
  const theme = page.getByLabel('Theme', { exact: true });
  await expect(theme).toHaveValue('dark');
  expect(await theme.locator('option').allTextContents()).toEqual(['System', 'Light', 'Dark']);

  // P3-theme-contrast's measurement, and the reason the palette exists at all:
  // a resolved theme that does not change what is drawn is not a theme. The
  // relative luminance of the page is read, not judged.
  const drawn = () => page.evaluate(() => {
    const parts = getComputedStyle(document.body).backgroundColor.match(/[\d.]+/g).map(Number);
    const [r, g, b] = parts;
    return {
      theme: document.documentElement.getAttribute('data-theme'),
      luminance: (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
    };
  });
  await theme.selectOption('light');
  await expect.poll(async () => (await drawn()).theme, { message: 'choosing Light must apply light', timeout: 30_000 }).toBe('light');
  const light = await drawn();
  expect(light.luminance, 'light must be light').toBeGreaterThan(0.85);
  await theme.selectOption('dark');
  await expect.poll(async () => (await drawn()).theme, { message: 'choosing Dark must apply dark', timeout: 30_000 }).toBe('dark');
  const dark = await drawn();
  // QGD-FRM-0003: properly dark, for night nets and contests, not grey.
  expect(dark.luminance, 'dark must be properly dark, not grey').toBeLessThan(0.08);
  await page.screenshot({ path: resolve('report/shell-settings-dark.png') });

  // The choice survives a restart, and the control comes back showing it.
  await application.close();
  application = await launch(); page = await application.firstWindow();
  await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme')),
    { message: 'the chosen theme must survive a restart', timeout: 30_000 }).toBe('dark');
  const railAgain = name => page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name, exact: true });
  await railAgain('Settings').click();
  await expect(page.getByLabel('Theme', { exact: true })).toHaveValue('dark');

  // A refused save must not leave Settings showing a theme nothing is using.
  // The failure is made to happen rather than assumed: settings.json is
  // replaced by a non-empty directory, so the atomic rename in save() cannot
  // land on it. Permissions would not do it — the write goes to a temporary
  // file beside it and is renamed over the top.
  const settingsFile = join(userData, 'settings.json');
  await rm(settingsFile, { recursive: true, force: true });
  await mkdir(join(settingsFile, 'blocked'), { recursive: true });
  await page.getByLabel('Theme', { exact: true }).selectOption('light');
  await expect(page.locator('#theme-choice-error')).toBeVisible();
  // Still dark: the choice did not take, and neither the control nor the page
  // pretends it did.
  await expect(page.getByLabel('Theme', { exact: true })).toHaveValue('dark');
  expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('dark');
  await rm(settingsFile, { recursive: true, force: true });
  // And it recovers: the next choice is stored normally.
  await page.getByLabel('Theme', { exact: true }).selectOption('light');
  await expect(page.locator('#theme-choice-error')).toBeHidden();
  await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme')),
    { message: 'the control must work again once the file can be written' }).toBe('light');

  // P3-theme-system: back on System the shell matches the operating system,
  // and changes with it while running. nativeTheme.themeSource is what the
  // renderer's prefers-color-scheme reports, so this is the real signal and
  // not a simulated one — no restart anywhere in it (QGD-FRM-0001).
  await page.getByLabel('Theme', { exact: true }).selectOption('system');
  for (const source of ['dark', 'light', 'dark']) {
    await application.evaluate(({ nativeTheme }, value) => { nativeTheme.themeSource = value; }, source);
    await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme')),
      { message: `on System, the shell must follow the operating system turning ${source}` }).toBe(source);
  }
  await application.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'system'; });
  // ---- QGD-CRD-0011: no Test button is dead, and none looks busy ---------
  // KI7MT found Club Log's Test button disabled, unexplained, and drawing a
  // spinning busy cursor — the shared disabled style said `cursor: wait`, so a
  // control doing nothing looked like one that was working. Every service is
  // checked, not the one that was reported.
  {
    await page.getByRole('navigation', { name: 'Sections' })
      .getByRole('button', { name: 'Callsigns', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'W1AW', exact: true })).toBeVisible();

    const services = await page.getByLabel('Service', { exact: true })
      .locator('option').evaluateAll(options => options.map(option => option.value));
    expect(services.length, 'every service in the list is checked').toBeGreaterThan(4);

    const testButton = page.getByRole('button', { name: 'Test credential', exact: true });
    const reported = [];
    for (const service of services) {
      await page.getByLabel('Service', { exact: true }).selectOption(service);
      await expect(page.locator('#credential-status')).not.toHaveText('Checking saved credentials…', { timeout: 30_000 });

      const disabled = await testButton.isDisabled();
      const explanation = (await page.locator('#credential-test-result').textContent() ?? '').trim();
      // Dead and silent is the state that must not exist. Whether it is
      // disabled is allowed to vary; being disabled with nothing to read is not.
      expect(explanation, `${service}: a Test button must never be unexplained`).not.toBe('');
      if (disabled) {
        expect(explanation, `${service}: a disabled Test button must say why`)
          .toMatch(/not implemented yet|Save a username/);
      }
      // And never the busy cursor: that belongs to a control that is working.
      const cursor = await testButton.evaluate(node => getComputedStyle(node).cursor);
      expect(cursor, `${service}: a Test button that is not working must not look busy`).not.toBe('wait');
      expect(cursor, `${service}: a Test button that is not working must not look busy`).not.toBe('progress');
      if (disabled) expect(cursor, `${service}: a disabled control should say not-allowed`).toBe('not-allowed');
      reported.push(`${service}${disabled ? ' (disabled)' : ''}`);
    }
    notesServices = reported.join(', ');
    await page.getByLabel('Service', { exact: true }).selectOption('qrz_logbook');
  }

  // ---- P4-screens and P4-shell-starts-without-it -------------------------
  // QGD-FRM-0012: storage has no indicator of its own. The status bar holds
  // the data-context slot instead, empty until an application holds data.
  await expect(page.locator('#engine-indicator'), 'the database indicator is gone').toHaveCount(0);
  await expect(page.locator('#data-context')).toHaveAttribute('data-empty', 'true');
  await expect(page.locator('#data-context')).toHaveText('');
  // QGD-ENG-0003: nothing above waited for storage, and the shell was usable
  // throughout. Its detail is behind Troubleshooting (QGD-LOG-0013).
  await page.locator('#open-troubleshooting').click();
  await expect(page.locator('#troubleshooting')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Storage', exact: true })).toBeVisible();
  // Ready, not merely "some state": the real application, so the whole path
  // (utility process, state.sqlite, its migrations) has to work.
  await expect.poll(() => page.getByLabel('State', { exact: true }).inputValue(),
    { message: 'storage must open on its own, in the background', timeout: 60_000 })
    .toBe('Ready');
  notesStorage = await page.getByLabel('State', { exact: true }).inputValue();
  // Nothing to start or stop: storage is files the application opens.
  await expect(page.locator('#troubleshooting').getByRole('button', { name: /^(Start|Stop)$/ })).toHaveCount(0);
  await expect(page.locator('#reference-datasets')).toBeVisible();
  await page.locator('#close-troubleshooting').click();
  // QGD-REF-0017: Settings says, per resource, whether reference data is
  // downloaded. Nothing is fetched at start (KI7MT, 2026-10-11), so a new
  // profile says "Not downloaded" for each, with Download beside it. Home
  // holds the pinned cards only (QGD-FRM-0011, 2026-10-22); the version and
  // what the application sends are in Settings' About.
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: 'Settings', exact: true }).click();
  await expect.poll(() => page.locator('.reference-state').allInnerTexts(), { timeout: 10_000 })
    .toEqual(['Not downloaded', 'Not downloaded']);
  await expect(page.getByRole('button', { name: 'Download ADIF definitions' })).toBeVisible();
  await expect(page.locator('#about-version')).not.toBeEmpty();
  await expect(page.locator('#about-privacy')).toContainText('Everything you enter stays on this computer');
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: 'Callsigns', exact: true }).click();

  // ---- P3-logs-page (QGD-LOG-0013) --------------------------------------
  // The switch writes the level the running process then uses. Read back from
  // the main process rather than from the page, so this measures the file the
  // loggers follow and not what the select is displaying.
  // Read here rather than through the application: this is the file the
  // running loggers poll, and reading it from outside is the whole point.
  const levelInFile = async () => JSON.parse(await readFile(join(logs, 'level.json'), 'utf8'));
  // The storage checks above close Troubleshooting; the logs live inside it.
  await page.locator('#open-troubleshooting').click();
  await expect(page.locator('#troubleshooting')).toBeVisible();
  await expect(page.getByLabel('Detail level', { exact: true })).toHaveValue('info');
  await page.getByLabel('Detail level', { exact: true }).selectOption('debug');
  await expect(page.getByLabel('Detail level', { exact: true })).toHaveValue('debug');
  const written = await levelInFile();
  expect(written.level).toBe('debug');
  // QGD-LOG-0010: a raise is stamped, which is what lets it expire on its own.
  expect(typeof written.raisedAtMs).toBe('number');
  await expect(page.locator('#log-level-error')).toBeHidden();
  await page.getByLabel('Detail level', { exact: true }).selectOption('info');
  expect(await levelInFile()).toEqual({ level: 'info' });

  // QGD-LOG-0010: a raise expires on its own, and the page must stop offering
  // it. Expiry is simulated by writing a raise that predates this process,
  // which is the restart half of the rule — the hour would take an hour.
  await page.getByLabel('Detail level', { exact: true }).selectOption('debug');
  await expect(page.getByLabel('Detail level', { exact: true })).toHaveValue('debug');
  // Closed and reopened, not navigated away and back: the logs are read when
  // Troubleshooting opens now, so that is what refreshes them (QGD-LOG-0013).
  // Navigating used to be the refresh because the logs lived in Settings.
  await page.locator('#close-troubleshooting').click();
  await expect(page.locator('#troubleshooting')).toHaveCount(0);
  await writeFile(join(logs, 'level.json'),
    JSON.stringify({ level: 'debug', raisedAtMs: Date.now() - 4 * 60 * 60 * 1000 }) + '\n');
  await page.locator('#open-troubleshooting').click();
  await expect(page.locator('#troubleshooting')).toBeVisible();
  // Without the refresh this still read debug, while every logger had already
  // reverted to info.
  await expect(page.getByLabel('Detail level', { exact: true })).toHaveValue('info');

  // Export diagnostics produces the archive QGD-LOG-0012 already builds. The
  // save dialog is replaced through Electron's own API rather than through a
  // hook in the application, so the path that runs is the one that ships.
  const archive = join(directory, 'diagnostics.zip');
  await application.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath });
  }, archive);
  await page.getByRole('button', { name: 'Export diagnostics', exact: true }).click();
  await expect(page.locator('#export-result')).toContainText('Passwords and keys were removed.', { timeout: 30_000 });
  const writtenArchive = await readFile(archive);
  expect(writtenArchive.subarray(0, 2).toString('latin1')).toBe('PK');
  // Read, not searched. zip() deflates a log whenever that helps, so the
  // plaintext is not in the bytes to find and a byte search passes on an
  // archive that does contain the credential.
  const exported = entries(writtenArchive);
  expect(exported.length, 'the export must contain the log files').toBeGreaterThan(0);
  // The reader is doing its job: something this run certainly logged is here.
  // Without this, a reader that returned empty buffers would make the check
  // below pass on anything.
  expect(exported.some(file => file.content.includes('application ready')),
    'the reader must be returning real log content').toBe(true);
  for (const file of exported) {
    expect(file.content.includes(fakeCredential), `${file.name} must not carry the credential`).toBe(false);
  }

  // And cancelling says so rather than claiming a file was written.
  await application.evaluate(({ dialog }) => {
    dialog.showSaveDialog = () => Promise.resolve({ canceled: true, filePath: undefined });
  });
  await page.getByRole('button', { name: 'Export diagnostics', exact: true }).click();
  await expect(page.locator('#export-result')).toHaveText('Export cancelled.', { timeout: 30_000 });

  await railAgain('Callsigns').click();
  await expect(page.getByRole('heading', { name: 'W1AW', exact: true })).toBeVisible();
  // P3-personas-intact: the P1 screen still works after all of that.
  await page.getByLabel('Service', { exact: true }).selectOption('qrz_logbook');
  await expect(page.locator('#credential-status')).toContainText(said('Stored in Keychain'), { timeout: 30_000 });

  await mkdir('report', { recursive: true });
  await page.screenshot({ path: resolve('report/personas-preview.png') });
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Remove saved credential', exact: true }).click();
  await expect(page.locator('#credential-status')).toContainText('No credential saved', { timeout: 30_000 });
  // QGD-ENG-0006 and QGD-ENG-0016 on the way out: closing the application
  // closes the stores cleanly, and nothing secret was ever written into one.
  // The broker logs "storage closed" only when QG Storage acknowledges the
  // close, and "did not close in time; killed" when it does not. Counted, not
  // looked for: the restart earlier in this suite (QGD-CRD-0009/0010) closed
  // storage too and wrote to the same log, so only one more entry than before
  // the quit is something the quit did.
  const logLines = async () => (await readFile(join(logs, 'qg-desktop.log'), 'utf8').catch(() => '')).split('\n').filter(Boolean)
    .map(line => { try { return JSON.parse(line); } catch { return undefined; } }).filter(Boolean);
  const count = (lines, msg) => lines.filter(entry => entry.msg === msg).length;
  const beforeQuit = await logLines();
  const closedBeforeQuit = count(beforeQuit, 'storage closed');
  const killedBeforeQuit = count(beforeQuit, 'storage did not close in time; killed');
  await application.close();
  application = undefined;
  {
    const state = join(userData, 'state.sqlite');
    expect(await readFile(state).then(bytes => bytes.length, () => 0),
      'storage must have run in the application for this to mean anything').toBeGreaterThan(0);
    // A clean close checkpoints and removes the write-ahead log. A WAL left
    // with data in it means the stores were killed, not closed.
    const wal = await readFile(`${state}-wal`).then(bytes => bytes.length, () => 0);
    expect(wal, 'the stores must be closed, not killed, when the application quits').toBe(0);
    // And the file reopens whole.
    const { DatabaseSync } = await import('node:sqlite');
    const reopened = new DatabaseSync(state, { readOnly: true });
    try {
      expect(reopened.prepare('PRAGMA integrity_check').get().integrity_check).toBe('ok');
    } finally { reopened.close(); }
    // No store holds the credential this run saved and removed.
    for (const name of await readdir(userData, { recursive: true })) {
      if (!/\.sqlite(-wal|-shm|-journal)?$/.test(name)) continue;
      const bytes = await readFile(join(userData, name)).catch(() => Buffer.alloc(0));
      expect(bytes.includes(Buffer.from(fakeCredential)), `${name} must not hold the credential`).toBe(false);
    }
    const lines = await logLines();
    expect(lines.some(entry => entry.msg === 'storage ready'), 'storage must have said it was ready').toBe(true);
    expect(count(lines, 'storage closed'), 'QG Storage must have acknowledged the close').toBe(closedBeforeQuit + 1);
    expect(count(lines, 'storage did not close in time; killed'), 'storage must close within its time').toBe(killedBeforeQuit);
    notesStorage += ', closed cleanly when the application quit, and holding no credential';
  }
  // The control for the close check, planted from this harness and not from
  // the product: QG Storage is frozen (SIGSTOP) so it cannot acknowledge, and
  // the application is quit. The broker must then wait out its time, kill it
  // and say so, and must not say "storage closed". Without this, the check
  // above could pass on a broker that logged success whatever happened.
  {
    const before = await logLines();
    const closedBefore = before.filter(entry => entry.msg === 'storage closed').length;
    const timedOutBefore = before.filter(entry => entry.msg === 'storage did not close in time; killed').length;
    application = await launch();
    const controlPage = await application.firstWindow();
    await expect.poll(() => controlPage.evaluate(() => window.storage.request({ type: 'status' }))
      .then(reply => (reply.ok ? reply.status.state : 'refused')), { timeout: 60_000 }).toBe('ready');
    const started = (await logLines()).filter(entry => entry.msg === 'storage service started' && Number.isInteger(entry.storagePid));
    const frozen = started.at(-1)?.storagePid;
    expect(frozen, 'QG Storage must be identified to freeze it').toBeTruthy();
    freeze(frozen);
    try {
      await application.close();
      application = undefined;
    } finally {
      try { process.kill(frozen, 'SIGKILL'); } catch { /* the broker already killed it */ }
    }
    const after = await logLines();
    expect(after.filter(entry => entry.msg === 'storage closed').length,
      'a frozen QG Storage cannot have acknowledged the close').toBe(closedBefore);
    expect(after.filter(entry => entry.msg === 'storage did not close in time; killed').length,
      'the broker must say it waited out its time and killed it').toBe(timedOutBefore + 1);
    notesStorage += '; a frozen QG Storage was reported killed, not closed (the control)';
  }
  console.log('Rust personas UI: create, select, save, restart, remove and secret containment: PASS');
  console.log(`No secret read without asking: ${notesSecrets}: PASS`);
  console.log(`Every Test button explains itself and none looks busy: ${notesServices}: PASS`);
  console.log('Single instance: a second launch exited and raised the window already open: PASS');
  console.log(`Storage: no indicator, an empty data-context slot, the shell usable while storage opens; Troubleshooting reports "${notesStorage}": PASS`);
  console.log('Logs page: the level switch writes the file the loggers follow, and Export diagnostics writes a redacted archive: PASS');
  console.log(`Shell: rail navigation, keyboard, status bar on every page, and both themes measured (light ${light.luminance.toFixed(2)}, dark ${dark.luminance.toFixed(2)}): PASS`);
} catch (error) {
  // Do not serialize Playwright's exception payloads into shared artifacts.
  console.error('P0 local Electron smoke failed. Check launch, page and security assertions.');
  console.error(redact(error.message).split('\n').slice(0, 20).join('\n'));
  // Which step: the line in this file, which the message alone does not say.
  const at = String(error.stack ?? '').split('\n').find(line => line.includes('smoke.mjs'));
  if (at) console.error(redact(at.trim()));
  process.exitCode = 1;
} finally {
  if (application) await application.close().catch(() => {});
  try {
    const require = createRequire(import.meta.url);
    const { PersonaCore } = require('../dist/native/persona.node');
    const core = new PersonaCore(profile);
    core.deleteCredentials(persona, 'qrz_logbook');
  } catch {}
  await rm(directory, { recursive: true, force: true });
}
