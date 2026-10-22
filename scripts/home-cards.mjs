// SPDX-License-Identifier: GPL-3.0-only
// P8 in the running application: Home's cards drawn from On the Air, its code
// in the QG Extensions process and nowhere else, the host not started while
// nothing is pinned, and On the Air turned off and on.
//
//   P8-window      the window is ready with nothing pinned, and no extension
//                  host starts (QGD-APP-0023)
//   P8-host        the cards are answered by the QG Extensions utility process,
//                  which is neither main nor the window's, and which opens no
//                  connection of its own (QGD-APP-0015, QGD-PRC-0004,
//                  QGD-SEC-0020)
//   P8-built-in    On the Air is on in a new profile; turned off, its cards
//                  leave Home and "Customize your pins", and stay gone across a
//                  restart; turned on, they come back to their pins
//                  (QGD-HOM-0007)
//
// NOAA's data comes from the recorded responses in tests/fixtures/noaa/quiet
// (source-fixtures.ts), so what Conditions says is known and nothing here
// depends on NOAA answering.
import { _electron as electron, expect } from '@playwright/test';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { redact } from './report.mjs';
import { socketsOf } from './platform-process.mjs';
import { assertNoVisibleWindow } from './no-visible-window.mjs';
import { enableTestKeychain } from './keychain-service.mjs';

// Nothing here makes a credential; the test service keeps it that way should
// anything try.
enableTestKeychain();

const FIXTURES = resolve('tests/fixtures/noaa/quiet');
const expected = JSON.parse(await readFile(join(FIXTURES, 'expected.json'), 'utf8'));
const directory = await mkdtemp(join(tmpdir(), 'qg-home-cards-'));
const profile = join(directory, 'profile');
const userData = join(directory, 'chromium');
const logs = join(directory, 'logs');
await mkdir(userData, { recursive: true });
const settingsFile = join(userData, 'settings.json');

const launch = async () => {
  const application = await electron.launch({
    args: ['.'], cwd: process.cwd(), timeout: 30_000,
    env: { ...process.env, QG_DESKTOP_PROFILE_DIR: profile, QG_DESKTOP_USER_DATA_DIR: userData, QG_DESKTOP_LOG_DIR: logs, QG_DESKTOP_SOURCE_FIXTURES: FIXTURES }
  });
  const page = await application.firstWindow();
  await assertNoVisibleWindow(application, page, 'home-cards');
  return { application, page };
};

// The QG Extensions process, if there is one, from Electron's own list.
const extensionHost = application => application.evaluate(({ app }) =>
  app.getAppMetrics().filter(metric => metric.type === 'Utility' && (metric.serviceName === 'QG Extensions' || metric.name === 'QG Extensions'))
    .map(metric => metric.pid));

const card = (page, name) => page.locator(`section.home-card[aria-label="${name}"]`);
const rail = (page, name) => page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name, exact: true });
const settings = async () => JSON.parse(await readFile(settingsFile, 'utf8'));

let application;
try {
  // P8-window: nothing pinned, so nothing asks an extension for anything.
  await writeFile(settingsFile, JSON.stringify({ pins: [] }));
  ({ application } = await launch());
  let page = await application.firstWindow();
  await expect(page.locator('#customize-pins')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('section.home-card')).toHaveCount(0);
  // Long enough for a host that was going to start to have started.
  await page.waitForTimeout(3_000);
  expect(await extensionHost(application), 'with nothing pinned, no extension host may start').toEqual([]);
  await application.close();
  application = undefined;
  console.log('P8-window: the window is ready with nothing pinned, and no extension host starts: PASS');

  // P8-built-in, first half: a new profile has On the Air on and its two
  // cards pinned (QGD-HOM-0004).
  await rm(settingsFile, { force: true });
  ({ application, page } = await launch());
  await expect(card(page, 'Conditions')).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 });
  await expect(card(page, 'Your station')).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 });
  await expect(card(page, 'Conditions')).toContainText(String(expected.sfi));
  await expect(card(page, 'Your station')).toContainText('UTC');

  // P8-host: the answers came from QG Extensions, which is its own process.
  const hosts = await extensionHost(application);
  expect(hosts, 'the cards must have been answered by one QG Extensions process').toHaveLength(1);
  const mainPid = await application.evaluate(() => process.pid);
  const windowPid = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getOSProcessId());
  expect(hosts[0]).not.toBe(mainPid);
  expect(hosts[0]).not.toBe(windowPid);
  // Every outbound connection is the credential core's (QGD-SEC-0020); the
  // host asked the core, so it holds no socket of its own.
  const sockets = socketsOf(hosts[0]);
  expect(sockets.ok, 'the host\'s sockets must be readable').toBe(true);
  expect(sockets.sockets, 'the extension host must open no connection of its own').toEqual([]);
  console.log(`P8-host: the cards were answered by QG Extensions (pid ${hosts[0]}), not main (${mainPid}) or the window (${windowPid}), with no socket of its own: PASS`);

  // P8-supervision, on screen (QGD-APP-0022): the host is killed from
  // outside, as a crash would end it. Home names what it affected, the host is
  // restarted, the cards answer again, and Dismiss hides the notice.
  process.kill(hosts[0]);
  const notice = page.locator('#host-notice');
  await expect(notice, 'Home must say the extension host stopped').toBeVisible({ timeout: 30_000 });
  await expect(notice).toContainText('It affected On the Air', { timeout: 30_000 });
  await expect(notice).toContainText('was restarted', { timeout: 30_000 });
  await expect(notice).not.toContainText(/caused|because/i);
  await expect.poll(async () => (await extensionHost(application)).filter(pid => pid !== hosts[0]).length,
    { message: 'a new extension host must be running', timeout: 30_000 }).toBe(1);
  // A fresh answer, which only the new host can give: Your station said no
  // persona was active before the kill; a persona made active now asks every
  // card again at once (QGD-HOM-0005), and its callsign must come back. The
  // cards' earlier answers would pass any check on what they already showed.
  await expect(card(page, 'Your station')).toContainText('No callsign is active yet.');
  const personaReply = await page.evaluate(async () => {
    const made = await window.personas.request({ type: 'upsert', name: 'qg-home-cards-fixture', callsign: 'w1aw' });
    return made.ok ? window.personas.request({ type: 'set-active', name: 'qg-home-cards-fixture' }) : made;
  });
  expect(personaReply, 'the test persona must be made active').toMatchObject({ ok: true });
  await expect(card(page, 'Your station'), 'the new host must answer Your station').toContainText(/W1AW/i, { timeout: 30_000 });
  await notice.getByRole('button', { name: 'Dismiss' }).click();
  await expect(notice).toHaveCount(0, { timeout: 30_000 });
  console.log('P8-supervision: the extension host killed; Home named On the Air as affected, the host restarted and answered afresh, and Dismiss hid the notice: PASS');

  // Turned off in Settings: its cards leave Home and the list.
  await rail(page, 'Settings').click();
  const onTheAir = page.getByRole('switch', { name: /On the Air/ });
  await expect(onTheAir).toBeChecked({ timeout: 30_000 });
  await onTheAir.click();
  await expect(onTheAir).not.toBeChecked({ timeout: 30_000 });
  expect((await settings()).extensionsOff).toEqual(['on-the-air']);
  await rail(page, 'Home').click();
  await expect(page.locator('section.home-card')).toHaveCount(0, { timeout: 30_000 });
  await page.locator('#customize-pins').click();
  const dialog = page.getByRole('dialog', { name: 'Customize your pins' });
  await expect(dialog).toBeVisible();
  await expect(dialog).not.toContainText('Conditions');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  // The pins are kept, so they come back where they were.
  expect((await settings()).pins).toEqual(['on-the-air/conditions', 'on-the-air/your-station']);

  // On again in the same run: the cards come back at once with what they last
  // said, not "Getting the latest…" until Conditions' fifteen minutes run out.
  await rail(page, 'Settings').click();
  await page.getByRole('switch', { name: /On the Air/ }).click();
  await expect(page.getByRole('switch', { name: /On the Air/ })).toBeChecked({ timeout: 30_000 });
  await rail(page, 'Home').click();
  await expect(card(page, 'Conditions')).toContainText(String(expected.sfi), { timeout: 10_000 });
  await expect(card(page, 'Your station')).toContainText('UTC', { timeout: 10_000 });

  // And off again, for the restart below.
  await rail(page, 'Settings').click();
  await page.getByRole('switch', { name: /On the Air/ }).click();
  await expect(page.getByRole('switch', { name: /On the Air/ })).not.toBeChecked({ timeout: 30_000 });

  // Off holds across a restart, and the host is not started for it.
  await application.close();
  ({ application, page } = await launch());
  await expect(page.locator('#customize-pins')).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(3_000);
  await expect(page.locator('section.home-card')).toHaveCount(0);
  expect(await extensionHost(application), 'an extension that is off is not started').toEqual([]);

  // Turned on again: both cards back, in their places.
  await rail(page, 'Settings').click();
  await page.getByRole('switch', { name: /On the Air/ }).click();
  await expect(page.getByRole('switch', { name: /On the Air/ })).toBeChecked({ timeout: 30_000 });
  await rail(page, 'Home').click();
  await expect(page.locator('section.home-card')).toHaveCount(2, { timeout: 30_000 });
  expect(await page.locator('section.home-card').evaluateAll(cards => cards.map(each => each.getAttribute('aria-label'))))
    .toEqual(['Conditions', 'Your station']);
  await expect(card(page, 'Conditions')).toContainText(String(expected.sfi), { timeout: 30_000 });
  // A change that cannot be saved leaves the switch showing what was
  // recorded. The settings folder made read-only stops the write; Windows has
  // no such mode for a folder, so this part runs on macOS and Linux.
  if (process.platform !== 'win32') {
    await rail(page, 'Settings').click();
    await chmod(userData, 0o500);
    try {
      await page.getByRole('switch', { name: /On the Air/ }).click();
      await expect(page.getByRole('alert')).toContainText('On the Air could not be turned off', { timeout: 30_000 });
      await expect(page.getByRole('switch', { name: /On the Air/ })).toBeChecked();
    } finally {
      await chmod(userData, 0o700);
    }
    expect((await settings()).extensionsOff).toEqual([]);
  }
  console.log('P8-built-in: On the Air is on by default; off, its cards leave Home and the list and stay gone across a restart; on, they return to their pins at once; a failed save leaves the switch as recorded: PASS');
} catch (error) {
  console.error('P8 Home cards suite failed.');
  console.error(redact(error.message).split('\n').slice(0, 20).join('\n'));
  const at = String(error.stack ?? '').split('\n').find(line => line.includes('home-cards.mjs'));
  if (at) console.error(redact(at.trim()));
  process.exitCode = 1;
} finally {
  if (application) await application.close().catch(() => {});
  await rm(directory, { recursive: true, force: true }).catch(() => {});
}
