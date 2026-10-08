// SPDX-License-Identifier: GPL-3.0-only
import { _electron as electron, expect } from '@playwright/test';
import { mkdir, mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { redact } from './report.mjs';

let application;
const directory = await mkdtemp(join(tmpdir(), 'qg-persona-ui-'));
const profile = join(directory, 'profile');
const userData = join(directory, 'chromium');
const logs = join(directory, 'logs');
await mkdir(userData, { recursive: true });
const persona = `qg-test-${randomUUID()}`;
const fakeCredential = `QG_FAKE_CREDENTIAL_${randomUUID()}`;
const launch = () => electron.launch({ args: ['.'], cwd: process.cwd(), env: { ...process.env, QG_DESKTOP_PROFILE_DIR: profile, QG_DESKTOP_USER_DATA_DIR: userData, QG_DESKTOP_LOG_DIR: logs }, timeout: 30_000 });
try {
  application = await launch();
  let page = await application.firstWindow();
  await expect(page.getByRole('heading', { name: 'Create a persona' })).toBeVisible();
  expect(application.windows()).toHaveLength(1);
  const preferences = await application.evaluate(({ BrowserWindow, session }) => {
    const prefs = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return { sandbox: prefs.sandbox, contextIsolation: prefs.contextIsolation, nodeIntegration: prefs.nodeIntegration, spellcheck: session.defaultSession.isSpellCheckerEnabled() };
  });
  expect(preferences).toEqual({ sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false });
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
  await page.getByLabel('Username', { exact: true }).fill(fakeCredential);
  await page.getByLabel('Username', { exact: true }).press(`${modifier}+a`);
  await page.getByLabel('Username', { exact: true }).press(`${modifier}+c`);
  for (const label of ['Password', 'API key']) {
    const field = page.getByLabel(label, { exact: true });
    await field.focus(); await field.press(`${modifier}+v`);
    expect(await field.inputValue() === fakeCredential).toBe(true);
  }
  await application.evaluate(({ clipboard }) => clipboard.clear());
  await page.getByLabel('Username', { exact: true }).fill('W1AW');
  await page.getByLabel('Password', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Save in Keychain', exact: true }).click();
  await expect(page.locator('#credential-status')).toContainText('Stored in Keychain', { timeout: 30_000 });
  expect(await page.getByLabel('API key', { exact: true }).inputValue()).toBe('');
  expect((await page.locator('body').innerText()).includes(fakeCredential)).toBe(false);
  const index = await readFile(join(profile, 'personas.json'), 'utf8');
  expect(index.includes(fakeCredential)).toBe(false);
  await application.close(); application = undefined;
  application = await launch(); page = await application.firstWindow();
  await expect(page.getByRole('heading', { name: 'W1AW', exact: true })).toBeVisible();
  await expect(page.locator('#active-persona')).toContainText('Active: W1AW');
  await page.getByLabel('Service', { exact: true }).selectOption('qrz_logbook');
  await expect(page.locator('#credential-status')).toContainText('Stored in Keychain', { timeout: 30_000 });
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
  expect(await page.evaluate(() => document.activeElement?.textContent)).toBe('Personas');
  const outline = await page.evaluate(() => getComputedStyle(document.activeElement, null).outlineWidth);
  expect(parseFloat(outline), 'the focused rail item must show a focus indicator').toBeGreaterThan(0);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Persona details', exact: true })).toBeVisible();
  await rail('Settings').click();

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
  await application.close();
  application = undefined;
  console.log('Rust personas UI: create, select, save, restart, remove and secret containment: PASS');
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
