// SPDX-License-Identifier: GPL-3.0-only
import { _electron as electron, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire as createElectronRequire } from 'node:module';
import { mkdir, mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { redact } from './report.mjs';
import { entries } from './unzip.mjs';

let application;
let notesEngine = 'not reached';
let notesSecrets = 'not reached';
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

const launch = () => electron.launch({ args: ['.'], cwd: process.cwd(), env: { ...process.env, QG_DESKTOP_PROFILE_DIR: profile, QG_DESKTOP_USER_DATA_DIR: userData, QG_DESKTOP_LOG_DIR: logs }, timeout: 30_000 });
try {
  application = await launch();
  let page = await application.firstWindow();
  // The application opens on Home now (QGD-FRM-0011). Personas is a click away.
  await page.getByRole('navigation', { name: 'Sections' })
    .getByRole('button', { name: 'Personas', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Create a persona' })).toBeVisible();
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
    await expect.poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized()))
      .toBe(true);

    const electronBinary = createElectronRequire(import.meta.url)('electron');
    const second = spawn(electronBinary, ['.'], {
      cwd: process.cwd(), stdio: 'ignore',
      env: { ...process.env, QG_DESKTOP_PROFILE_DIR: profile, QG_DESKTOP_USER_DATA_DIR: userData, QG_DESKTOP_LOG_DIR: logs }
    });
    const exited = await Promise.race([
      once(second, 'exit').then(([code]) => code),
      new Promise(resolve => setTimeout(() => resolve('still running'), 20_000))
    ]);
    if (exited === 'still running') { second.kill('SIGKILL'); }
    expect(exited, 'a second launch must exit rather than open a second application').not.toBe('still running');
    // And the window already open is raised rather than left where it was.
    await expect.poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized()),
      { message: 'a second launch must restore the window already open' }).toBe(false);
    // Still one application, still answering.
    expect(application.windows()).toHaveLength(1);
    await expect.poll(() => page.evaluate(() => window.personas.request({ type: 'list' }).then(reply => reply.ok))).toBe(true);
  }

  expect(await page.evaluate(() => 'require' in window || 'process' in window)).toBe(false);
  expect(await page.evaluate(async () => {
    try { await fetch('https://example.invalid/'); return 'allowed'; }
    catch { return 'denied'; }
  })).toBe('denied');
  expect(await page.evaluate(() => window.open('https://example.invalid/'))).toBeNull();
  const permission = await page.evaluate(() => navigator.permissions.query({ name: 'geolocation' }).then(result => result.state));
  expect(permission).toBe('denied');
  await expect.poll(() => page.evaluate(() => window.personas.request({ type: 'list' }).then(reply => reply.ok))).toBe(true);
  expect(await page.evaluate(() => window.personas.request({ type: 'require-credential', persona: 'home', provider: 'qrz' }))).toEqual({ ok: false, error: 'Invalid persona request.' });
  await page.getByLabel('Persona name', { exact: true }).fill(persona);
  await page.getByLabel('Callsign', { exact: true }).fill('w1aw');
  await page.getByLabel('Start date', { exact: true }).fill('2026-01-01');
  await page.getByRole('button', { name: 'Create persona', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'W1AW', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Use this persona', exact: true }).click();
  await expect(page.locator('#active-persona')).toContainText('Active: W1AW');
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
  await page.getByRole('button', { name: 'Save in Keychain', exact: true }).click();
  await expect(page.locator('#credential-status')).toContainText('Stored in Keychain', { timeout: 30_000 });
  expect(await page.getByLabel('API key', { exact: true }).inputValue()).toBe('');
  expect((await page.locator('body').innerText()).includes(fakeCredential)).toBe(false);
  const index = await readFile(join(profile, 'personas.json'), 'utf8');
  expect(index.includes(fakeCredential)).toBe(false);
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
    .getByRole('button', { name: 'Personas', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'W1AW', exact: true })).toBeVisible();
  await expect(page.locator('#active-persona')).toContainText('Active: W1AW');
  await page.getByLabel('Service', { exact: true }).selectOption('qrz_logbook');
  // The status is drawn, and drawn correctly, from metadata alone.
  await expect(page.locator('#credential-status')).toContainText('Stored in Keychain', { timeout: 30_000 });
  await expect(page.locator('#api-key-saved')).toBeVisible();

  {
    // Every page, and the persona selected again, with nothing decrypted.
    const railItem = name => page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name, exact: true });
    for (const name of ['Settings', 'Personas', 'Settings', 'Personas']) {
      await railItem(name).click();
      await expect(page.getByRole('navigation', { name: 'Sections' })).toBeVisible();
    }
    await page.locator('.persona-item').first().click();
    await expect(page.locator('#credential-status')).toContainText('Stored in Keychain', { timeout: 30_000 });
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
  // ---- P3: the shell ----------------------------------------------------
  await mkdir('report', { recursive: true });
  // P3-navigation: the rail moves between pages and the document never does.
  const before = page.url();
  await expect(page.getByRole('navigation', { name: 'Sections' })).toBeVisible();
  const rail = name => page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name, exact: true });
  await rail('Settings').click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Persona details', exact: true })).toBeHidden();
  expect(await rail('Settings').getAttribute('aria-current')).toBe('page');
  expect(await rail('Personas').getAttribute('aria-current')).toBeNull();
  // P3-status-bar: the active persona is on every page, not just its own.
  await expect(page.locator('#active-persona')).toContainText('Active: W1AW');
  // QGD-PRC-0006: one bundled page. Navigating a section is not navigation.
  expect(page.url()).toBe(before);
  expect(await page.evaluate(() => history.length)).toBe(1);

  // P3-keyboard: every rail item is reachable and operable from the keyboard.
  await rail('Personas').focus();
  // Trimmed: the button is an icon above a label, so its text carries the
  // whitespace between them.
  expect((await page.evaluate(() => document.activeElement?.textContent ?? '')).trim()).toBe('Personas');
  const outline = await page.evaluate(() => getComputedStyle(document.activeElement, null).outlineWidth);
  expect(parseFloat(outline), 'the focused rail item must show a focus indicator').toBeGreaterThan(0);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Persona details', exact: true })).toBeVisible();
  await rail('Settings').click();

  // The rail's icons carry a label and a tooltip, and the label is what is
  // read aloud: getByRole resolves these by accessible name, so every rail()
  // call above already proves the names. The tooltips and the ordering are
  // what is left.
  for (const name of ['Personas', 'Settings']) {
    const tooltip = await rail(name).getAttribute('title');
    expect(tooltip && tooltip.length > name.length, `${name} must carry a tooltip`).toBe(true);
    // An icon is drawn and hidden from assistive technology, which reads the
    // label instead.
    expect(await rail(name).locator('svg[aria-hidden="true"]').count(), `${name} icon`).toBe(1);
  }
  // Settings sits at the bottom of the rail, below everything else and near
  // the foot of it.
  const railBox = await page.getByRole('navigation', { name: 'Sections' }).boundingBox();
  const personasBox = await rail('Personas').boundingBox();
  const settingsBox = await rail('Settings').boundingBox();
  expect(settingsBox.y).toBeGreaterThan(personasBox.y);
  const gapBelow = railBox.y + railBox.height - (settingsBox.y + settingsBox.height);
  expect(gapBelow, 'Settings must sit at the foot of the rail').toBeLessThan(40);

  // P3-theme-override: System, Light and Dark, with System the default.
  const theme = page.getByLabel('Theme', { exact: true });
  await expect(theme).toHaveValue('system');
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
  await expect.poll(async () => (await drawn()).theme, { message: 'choosing Light must apply light' }).toBe('light');
  const light = await drawn();
  expect(light.luminance, 'light must be light').toBeGreaterThan(0.85);
  await theme.selectOption('dark');
  await expect.poll(async () => (await drawn()).theme, { message: 'choosing Dark must apply dark' }).toBe('dark');
  const dark = await drawn();
  // QGD-FRM-0003: properly dark, for night nets and contests, not grey.
  expect(dark.luminance, 'dark must be properly dark, not grey').toBeLessThan(0.08);
  await page.screenshot({ path: resolve('report/shell-settings-dark.png') });

  // The choice survives a restart, and the control comes back showing it.
  await application.close();
  application = await launch(); page = await application.firstWindow();
  await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme')),
    { message: 'the chosen theme must survive a restart' }).toBe('dark');
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
  // ---- P4-shell-starts-without-it (QGD-ENG-0003) -------------------------
  // This suite runs from the repository, where the pinned build exists — but
  // nothing here waits for the engine, and the point of the requirement is
  // that the shell is drawn and usable regardless. Everything above has
  // already happened; Settings must report a state rather than hanging or
  // showing nothing.
  await expect(page.getByRole('heading', { name: 'Database', exact: true })).toBeVisible();
  // Running, not merely "some state": this suite launches the real
  // application from the repository, where the pinned build is, so the whole
  // path — utility process, initdb, postmaster, migrations — has to work. The
  // shell was drawn and fully usable throughout, which is the requirement; the
  // engine arriving is what says the wiring is real.
  await expect.poll(() => page.getByLabel('State', { exact: true }).inputValue(),
    { message: 'the engine must come up on its own, in the background', timeout: 180_000 })
    .toBe('Running');
  notesEngine = await page.getByLabel('State', { exact: true }).inputValue();
  // And it is the bundled one, not something that was already on the machine.
  await expect(page.locator('#engine-state-hint')).toContainText('PostgreSQL');

  // ---- P3-logs-page (QGD-LOG-0013) --------------------------------------
  // The switch writes the level the running process then uses. Read back from
  // the main process rather than from the page, so this measures the file the
  // loggers follow and not what the select is displaying.
  // Read here rather than through the application: this is the file the
  // running loggers poll, and reading it from outside is the whole point.
  const levelInFile = async () => JSON.parse(await readFile(join(logs, 'level.json'), 'utf8'));
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
  await railAgain('Personas').click();
  await writeFile(join(logs, 'level.json'),
    JSON.stringify({ level: 'debug', raisedAtMs: Date.now() - 4 * 60 * 60 * 1000 }) + '\n');
  await railAgain('Settings').click();
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

  await railAgain('Personas').click();
  await expect(page.getByRole('heading', { name: 'W1AW', exact: true })).toBeVisible();
  // P3-personas-intact: the P1 screen still works after all of that.
  await page.getByLabel('Service', { exact: true }).selectOption('qrz_logbook');
  await expect(page.locator('#credential-status')).toContainText('Stored in Keychain', { timeout: 30_000 });

  await mkdir('report', { recursive: true });
  await page.screenshot({ path: resolve('report/personas-preview.png') });
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Remove saved credential', exact: true }).click();
  await expect(page.locator('#credential-status')).toContainText('No credential saved', { timeout: 30_000 });
  // QGD-ENG-0008 and the shutdown path: closing the application must leave no
  // postmaster behind. One that outlives it holds the data directory and
  // refuses the next launch — and the stop request used to cancel itself, so
  // the worker was killed before it had stopped anything.
  const engineData = join(userData, 'engine', 'data');
  await application.close();
  application = undefined;
  {
    // It ran here, so there is something to have stopped.
    expect(await readFile(join(engineData, 'PG_VERSION'), 'utf8').catch(() => ''),
      'the engine must have run in the application for this to mean anything').not.toBe('');

    // No postmaster survives.
    const pid = Number.parseInt(
      (await readFile(join(engineData, 'postmaster.pid'), 'utf8').catch(() => '')).split('\n')[0] ?? '', 10);
    if (Number.isInteger(pid) && pid > 0) {
      let alive = true;
      for (let attempt = 0; attempt < 50 && alive; attempt++) {
        try { process.kill(pid, 0); await new Promise(resolve => setTimeout(resolve, 200)); }
        catch { alive = false; }
      }
      expect(alive, `a postmaster (${pid}) outlived the application and would refuse the next launch`).toBe(false);
    }

    // And it was asked to stop rather than being killed on the way out. This
    // is the part that distinguishes the two: a killed postmaster also leaves
    // nothing running, but it leaves a database that needs crash recovery at
    // the next start — and the request never reached the supervisor at all,
    // so it never recorded stopping.
    const application_log = await readFile(join(logs, 'qg-desktop.log'), 'utf8').catch(() => '');
    const stopped = application_log.split('\n').filter(Boolean)
      .map(line => { try { return JSON.parse(line); } catch { return undefined; } })
      .filter(Boolean)
      .some(entry => entry.msg === 'engine state changed' && entry.state === 'stopped');
    expect(stopped, 'the engine must have been asked to stop, and recorded doing it').toBe(true);
    notesEngine += ', and was asked to stop when the application closed';
  }
  console.log('Rust personas UI: create, select, save, restart, remove and secret containment: PASS');
  console.log(`No secret read without asking: ${notesSecrets}: PASS`);
  console.log('Single instance: a second launch exited and raised the window already open: PASS');
  console.log(`Database card: the shell is drawn and usable while the engine starts on its own; Settings reports "${notesEngine}": PASS`);
  console.log('Logs page: the level switch writes the file the loggers follow, and Export diagnostics writes a redacted archive: PASS');
  console.log(`Shell: rail navigation, keyboard, status bar on every page, and both themes measured (light ${light.luminance.toFixed(2)}, dark ${dark.luminance.toFixed(2)}): PASS`);
} catch (error) {
  // Do not serialize Playwright's exception payloads into shared artifacts.
  console.error('P0 local Electron smoke failed. Check launch, page and security assertions.');
  console.error(redact(error.message).split('\n').slice(0, 20).join('\n'));
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
