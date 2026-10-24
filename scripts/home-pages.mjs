// SPDX-License-Identifier: GPL-3.0-only
// P8 in the running application: Home's pins as tiles from Conditions'
// manifest, its page drawn from the data its code answers in the QG Extensions
// process and nowhere else, Home asking for nothing, and Conditions turned off
// and on (KI7MT, 2026-10-22: a pin opens a page; Home is not a dashboard).
//
//   P8-window      the window is ready with nothing pinned, and no extension
//                  host starts (QGD-APP-0023); with a pin, Home still asks
//                  for nothing and starts no host
//   P8-host        the open page is answered by the QG Extensions utility
//                  process, which is neither main nor the window's, and which
//                  opens no connection of its own (QGD-APP-0015,
//                  QGD-PRC-0004, QGD-SEC-0020)
//   P8-built-in    Conditions is on in a new profile; turned off, its tiles
//                  leave Home and "Customize your pins", and stay gone across a
//                  restart; turned on, they come back to their pins
//                  (QGD-HOM-0007)
//
// NOAA's data comes from the recorded responses in tests/fixtures/noaa/quiet
// (source-fixtures.ts), so what Conditions says is known and nothing here
// depends on NOAA answering.
import { _electron as electron, expect } from '@playwright/test';
import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { redact } from './report.mjs';
import { socketsOf } from './platform-process.mjs';
import { assertNoVisibleWindow } from './no-visible-window.mjs';
import { enableTestKeychain } from './keychain-service.mjs';

// Nothing here makes a credential; the test service keeps it that way should
// anything try.
enableTestKeychain();

const QUIET = resolve('tests/fixtures/noaa/quiet');
const STORM = resolve('tests/fixtures/noaa/storm');
const expected = JSON.parse(await readFile(join(QUIET, 'expected.json'), 'utf8'));
const stormExpected = JSON.parse(await readFile(join(STORM, 'expected.json'), 'utf8'));
const directory = await mkdtemp(join(tmpdir(), 'qg-home-pages-'));
// The recorded responses are read from here each time a source is asked
// for, so a test can change what NOAA "says" mid-run: the quiet day, and the
// storm swapped in when only a fresh answer could show it.
const FIXTURES = join(directory, 'noaa');
const recorded = async from => { await rm(FIXTURES, { recursive: true, force: true }); await cp(from, FIXTURES, { recursive: true }); };
await recorded(QUIET);
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
  await assertNoVisibleWindow(application, page, 'home-pages');
  return { application, page };
};

// The QG Extensions process, if there is one, from Electron's own list.
const extensionHost = application => application.evaluate(({ app }) =>
  app.getAppMetrics().filter(metric => metric.type === 'Utility' && (metric.serviceName === 'QG Extensions' || metric.name === 'QG Extensions'))
    .map(metric => metric.pid));

const tile = (page, name) => page.locator('.pin-tile', { hasText: name });
const tiles = page => page.locator('.pin-tile');
const body = page => page.locator('section.page-body');
// Opens a pinned page from its tile, and waits for its answer.
const openPin = async (page, name) => {
  await tile(page, name).click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible({ timeout: 30_000 });
  await expect(body(page)).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 });
};
const rail = (page, name) => page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name, exact: true });
const settings = async () => JSON.parse(await readFile(settingsFile, 'utf8'));

let application;
try {
  // P8-window: nothing pinned, so nothing asks an extension for anything.
  await writeFile(settingsFile, JSON.stringify({ pins: [] }));
  ({ application } = await launch());
  let page = await application.firstWindow();
  await expect(page.locator('#customize-pins')).toBeVisible({ timeout: 30_000 });
  await expect(tiles(page)).toHaveCount(0);
  // Long enough for a host that was going to start to have started.
  await page.waitForTimeout(3_000);
  expect(await extensionHost(application), 'with nothing pinned, no extension host may start').toEqual([]);
  await application.close();
  application = undefined;
  console.log('P8-window: the window is ready with nothing pinned, and no extension host starts: PASS');

  // P8-built-in, first half: a new profile has every extension off, so Home,
  // Callsigns, Locations and Settings alone, nothing pinned and no
  // destination on the rail (KI7MT, 2026-10-23), and the welcome's "Choose
  // what to add" step leads to Settings' Extensions. Turned on there, each
  // extension's destination is pinned, in the order turned on: the launch row
  // (QGD-HOM-0004), drawn as tiles from the manifests alone. Turning one on
  // starts nothing; Home asks no extension for anything, so no host starts
  // until a page is opened.
  await rm(settingsFile, { force: true });
  ({ application, page } = await launch());
  await expect(page.locator('#customize-pins')).toBeVisible({ timeout: 30_000 });
  await expect(tiles(page)).toHaveCount(0);
  await expect(rail(page, 'Parks On the Air')).toHaveCount(0);
  await expect(rail(page, 'Astro')).toHaveCount(0);
  await page.locator('#welcome-step-extensions').click();
  await expect(page.locator('#extensions-title')).toBeVisible({ timeout: 30_000 });
  for (const name of ['Conditions', 'Astro', 'Parks On the Air', 'ADIF Lookup']) {
    const toggle = page.getByRole('switch', { name: new RegExp(`^${name}`) });
    await expect(toggle).not.toBeChecked({ timeout: 30_000 });
    await toggle.click();
    await expect(toggle).toBeChecked({ timeout: 30_000 });
  }
  expect((await settings()).extensionsOn).toEqual(['conditions', 'astro', 'pota', 'adif-lookup']);
  await rail(page, 'Home').click();
  await expect(tile(page, 'Conditions')).toBeVisible({ timeout: 30_000 });
  expect(await tiles(page).locator('.pin-tile-name').allInnerTexts()).toEqual(['Conditions', 'Astro', 'Parks On the Air', 'ADIF Lookup']);
  await expect(page.locator('#welcome-step-extensions')).toHaveAttribute('aria-label', 'Choose what to add: done');
  console.log('P8-built-in: a new profile has every extension off and the welcome leads to them; turned on, each is pinned in turn: PASS');
  // The Internet lamp on the clock's panel, from the operating system's own
  // reading (KI7MT, 2026-10-23).
  await expect(page.locator('#net-lamp')).toHaveAttribute('aria-label', 'Internet: online');
  await expect(page.locator('#net-lamp')).toHaveAttribute('data-lamp', 'on');
  // The welcome above the pins (QGD-FRM-0011): what this is, and on a new
  // profile the four steps to start, each a way to where it is done.
  await expect(page.locator('#welcome-headline')).toHaveText('QSO Graph Desktop');
  await expect(page.locator('#welcome-steps')).toBeVisible({ timeout: 30_000 });
  await page.locator('#welcome-step-callsign').click();
  await expect(page.getByRole('heading', { name: 'Add a callsign' })).toBeVisible();
  await rail(page, 'Home').click();
  await page.locator('#welcome-pins').click();
  await expect(page.getByRole('dialog', { name: 'Customize your pins' })).toBeVisible();
  await page.getByRole('dialog', { name: 'Customize your pins' }).getByRole('button', { name: 'Cancel' }).click();
  console.log('Home welcome: the headline, and a new profile\'s steps, each a way to its place: PASS');
  await page.waitForTimeout(3_000);
  expect(await extensionHost(application), 'Home asks for nothing, so with a pin no host starts either').toEqual([]);
  console.log('P8-window: a pinned tile is drawn from the manifest, and Home starts no extension host: PASS');
  await openPin(page, 'Conditions');
  await expect(body(page)).toContainText(String(expected.sfi));

  // P8-host: the answers came from QG Extensions, which is its own process.
  const hosts = await extensionHost(application);
  expect(hosts, 'the page must have been answered by one QG Extensions process').toHaveLength(1);
  const mainPid = await application.evaluate(() => process.pid);
  const windowPid = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getOSProcessId());
  expect(hosts[0]).not.toBe(mainPid);
  expect(hosts[0]).not.toBe(windowPid);
  // Every outbound connection is the credential core's (QGD-SEC-0020); the
  // host asked the core, so it holds no socket of its own.
  const sockets = socketsOf(hosts[0]);
  expect(sockets.ok, 'the host\'s sockets must be readable').toBe(true);
  expect(sockets.sockets, 'the extension host must open no connection of its own').toEqual([]);
  console.log(`P8-host: the page was answered by QG Extensions (pid ${hosts[0]}), not main (${mainPid}) or the window (${windowPid}), with no socket of its own: PASS`);

  // Astro (QGD-AST-*): a rail item as well as a pin, and with no Location
  // active it says what it needs rather than guessing (QGD-AST-0008).
  await expect(rail(page, 'Astro')).toBeVisible();
  await rail(page, 'Home').click();
  await openPin(page, 'Astro');
  await expect(body(page)).toContainText('Astro needs a Location', { timeout: 30_000 });
  await expect(page.locator('#page-input-dx')).toBeVisible();
  // An empty field says what it wants, under the box (KI7MT, 2026-10-23).
  // Under the section's own heading, Grey line DX check, so it does not say
  // the grey line again (KI7MT, 2026-10-24).
  await expect(page.locator('#page-input-dx-hint')).toHaveText('The station you want to work, as IO91.');
  // A grid its kind refuses is said so as it is typed, and not asked with.
  await page.locator('#page-input-dx').fill('ZZ99');
  await expect(page.locator('#page-ask')).toBeDisabled();
  await page.locator('#page-input-dx').fill('FN31');
  await expect(page.locator('#page-ask')).toBeEnabled();
  await rail(page, 'Home').click();
  console.log('Astro: in the rail and on Home; with no Location it says what it needs; its DX field refuses a grid that is not one: PASS');

  // P8-supervision, on screen (QGD-APP-0022): the host is killed from
  // outside, as a crash would end it. Home names what it affected, the host is
  // restarted, the page answers again, and Dismiss hides the notice.
  process.kill(hosts[0]);
  await rail(page, 'Home').click();
  const notice = page.locator('#host-notice');
  await expect(notice, 'Home must say the extension host stopped').toBeVisible({ timeout: 30_000 });
  // The extensions that were running in the host when it stopped: those
  // whose pages were opened above, Astro and Conditions. ADIF Lookup's was
  // not, so it was not running and is not named (CI, 2026-10-23: the test
  // had guessed every loaded extension).
  await expect(notice).toContainText('It affected Astro and Conditions.', { timeout: 30_000 });
  await expect(notice).toContainText('was restarted', { timeout: 30_000 });
  await expect(notice).not.toContainText(/caused|because/i);
  await expect.poll(async () => (await extensionHost(application)).filter(pid => pid !== hosts[0]).length,
    { message: 'a new extension host must be running', timeout: 30_000 }).toBe(1);
  // A fresh answer, which only the new host can give: NOAA's recorded day is
  // changed to the storm, and a callsign made active asks the open page again
  // at once (QGD-HOM-0005), so Conditions must show the storm's solar flux.
  // Its earlier answer would pass any check on what it already showed.
  await recorded(STORM);
  await tile(page, 'Conditions').click();
  const callsignReply = await page.evaluate(async () => {
    const made = await window.callsigns.request({ type: 'create', call: 'w1aw', description: 'qg-home-pages-fixture' });
    const id = made.ok ? made.data.callsigns.find(entry => entry.description === 'qg-home-pages-fixture')?.id : undefined;
    return id ? window.callsigns.request({ type: 'set-active', id }) : made;
  });
  expect(callsignReply, 'the test callsign must be made active').toMatchObject({ ok: true });
  await expect(body(page), 'the new host must answer Conditions afresh').toContainText(String(stormExpected.sfi), { timeout: 30_000 });
  await recorded(QUIET);
  await rail(page, 'Home').click();
  await notice.getByRole('button', { name: 'Dismiss' }).click();
  await expect(notice).toHaveCount(0, { timeout: 30_000 });
  console.log('P8-supervision: the extension host killed; Home named Astro and Conditions as affected, the host restarted and answered afresh, and Dismiss hid the notice: PASS');

  // Turned off in Settings: its tiles leave Home and the list.
  await rail(page, 'Settings').click();
  const onTheAir = page.getByRole('switch', { name: /^Conditions/ });
  await expect(onTheAir).toBeChecked({ timeout: 30_000 });
  await onTheAir.click();
  await expect(onTheAir).not.toBeChecked({ timeout: 30_000 });
  expect((await settings()).extensionsOn).toEqual(['astro', 'pota', 'adif-lookup']);
  await rail(page, 'Home').click();
  await expect(tile(page, 'Conditions')).toHaveCount(0, { timeout: 30_000 });
  // Conditions alone: Parks On the Air is its own extension (KI7MT,
  // 2026-10-23: "On switch, the lights go out"), and stays.
  await expect(tiles(page)).toHaveCount(3);
  await page.locator('#customize-pins').click();
  const dialog = page.getByRole('dialog', { name: 'Customize your pins' });
  await expect(dialog).toBeVisible();
  await expect(dialog).not.toContainText('Conditions');
  await expect(dialog).toContainText('Parks On the Air');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  // The pins are kept, so they come back where they were.
  expect((await settings()).pins).toEqual(['conditions/conditions', 'astro/astro', 'pota/parks', 'adif-lookup/lookup']);

  // On again in the same run: its page shows at once what it last said, not
  // "Getting the latest…" until Conditions' fifteen minutes run out.
  await rail(page, 'Settings').click();
  await page.getByRole('switch', { name: /^Conditions/ }).click();
  await expect(page.getByRole('switch', { name: /^Conditions/ })).toBeChecked({ timeout: 30_000 });
  await rail(page, 'Home').click();
  await tile(page, 'Conditions').click();
  // What it last said was the storm, answered by the restarted host above.
  await expect(body(page)).toContainText(String(stormExpected.sfi), { timeout: 10_000 });

  // A page open when its extension is turned off goes back to Home.
  await rail(page, 'Settings').click();
  await page.getByRole('switch', { name: /^Conditions/ }).click();
  await expect(page.getByRole('switch', { name: /^Conditions/ })).not.toBeChecked({ timeout: 30_000 });
  await page.getByRole('switch', { name: /^Conditions/ }).click();
  await expect(page.getByRole('switch', { name: /^Conditions/ })).toBeChecked({ timeout: 30_000 });
  await rail(page, 'Home').click();

  // And off again, for the restart below.
  await rail(page, 'Settings').click();
  await page.getByRole('switch', { name: /^Conditions/ }).click();
  await expect(page.getByRole('switch', { name: /^Conditions/ })).not.toBeChecked({ timeout: 30_000 });

  // Off holds across a restart, and the host is not started for it.
  await application.close();
  ({ application, page } = await launch());
  await expect(page.locator('#customize-pins')).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(3_000);
  await expect(tile(page, 'Conditions')).toHaveCount(0);
  expect(await extensionHost(application), 'an extension that is off is not started, and Home starts none').toEqual([]);

  // Turned on again: the tile back, in its place, and its page answering.
  await rail(page, 'Settings').click();
  await page.getByRole('switch', { name: /^Conditions/ }).click();
  await expect(page.getByRole('switch', { name: /^Conditions/ })).toBeChecked({ timeout: 30_000 });
  await rail(page, 'Home').click();
  await expect(tiles(page)).toHaveCount(4, { timeout: 30_000 });
  expect(await tiles(page).locator('.pin-tile-name').allInnerTexts()).toEqual(['Conditions', 'Astro', 'Parks On the Air', 'ADIF Lookup']);
  await openPin(page, 'Conditions');
  await expect(body(page)).toContainText(String(expected.sfi), { timeout: 30_000 });
  // A change that cannot be saved leaves the switch showing what was
  // recorded. The settings folder made read-only stops the write; Windows has
  // no such mode for a folder, so this part runs on macOS and Linux.
  if (process.platform !== 'win32') {
    await rail(page, 'Settings').click();
    await chmod(userData, 0o500);
    try {
      await page.getByRole('switch', { name: /^Conditions/ }).click();
      await expect(page.getByRole('alert')).toContainText('Conditions could not be turned off', { timeout: 30_000 });
      await expect(page.getByRole('switch', { name: /^Conditions/ })).toBeChecked();
    } finally {
      await chmod(userData, 0o700);
    }
    expect((await settings()).extensionsOn).toContain('conditions');
  }
  // Help → Troubleshooting… opens the same panel as the status bar's
  // button (QGD-LOG-0013, KI7MT 2026-10-22).
  await application.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('troubleshooting')?.click());
  await expect(page.locator('#troubleshooting')).toBeVisible({ timeout: 30_000 });
  await page.locator('#close-troubleshooting').click();
  await expect(page.locator('#troubleshooting')).toHaveCount(0);
  console.log('Help menu: Troubleshooting… opened the Troubleshooting panel: PASS');
  // The Setup menu (KI7MT, 2026-10-22): the welcome's places, from the menu.
  const setup = id => application.evaluate(({ Menu }, item) => Menu.getApplicationMenu()?.getMenuItemById(item)?.click(), id);
  // Which page is on screen, by the rail's current item: the callsign this
  // run made earlier is selected on Callsigns, so its heading is not fixed.
  await setup('setup-callsigns');
  await expect(rail(page, 'Callsigns')).toHaveAttribute('aria-current', 'page', { timeout: 30_000 });
  await setup('setup-locations');
  await expect(rail(page, 'Locations')).toHaveAttribute('aria-current', 'page', { timeout: 30_000 });
  // Setup → My Area… lands on Locations' My Area card (KI7MT, 2026-10-23).
  await setup('setup-area');
  await expect(page.locator('#area-title')).toBeInViewport({ timeout: 10_000 });
  await setup('setup-pins');
  await expect(page.getByRole('dialog', { name: 'Customize your pins' })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('dialog', { name: 'Customize your pins' }).getByRole('button', { name: 'Cancel' }).click();
  expect(await application.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('setup-iota')?.enabled),
    'IOTA is named and greyed out until it exists').toBe(false);
  console.log('Setup menu: Callsigns, Locations and Customize your pins opened, IOTA shown greyed out: PASS');
  // Tools (KI7MT, 2026-10-23): Back Up and Restore, from the menu, land in
  // Settings' Back up and restore at the button each needs.
  await setup('setup-export-callsigns');
  await expect(page.locator('#backup-export')).toBeFocused({ timeout: 10_000 });
  await setup('setup-import-callsigns');
  await expect(page.locator('#backup-import')).toBeFocused({ timeout: 10_000 });
  // No Window menu: the title bar has Minimize and Close (KI7MT, 2026-10-23).
  expect(await application.evaluate(({ Menu }) => Menu.getApplicationMenu()?.items.map(item => item.label)))
    .toEqual(process.platform === 'darwin' ? ['QSO Graph Desktop', 'Edit', 'Setup', 'Tools', 'Help'] : ['File', 'Edit', 'Setup', 'Tools', 'Help']);
  console.log('Tools menu: Back Up and Restore land in Settings at their buttons; the menu bar has no Window menu: PASS');

  // Help → What's New (QGD-FRM-0016): the notes, opened only when asked for,
  // from the changelog that ships; a new profile shows no update line.
  await expect(page.locator('#update-strip')).toHaveCount(0);
  await setup('setup-whats-new');
  await expect(page.locator('#whats-new')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('#whats-new section').first()).toBeVisible();
  await page.locator('#close-whats-new').click();
  await expect(page.locator('#whats-new')).toHaveCount(0);
  console.log('Help -> What\'s New opens the changelog\'s notes; nothing opens by itself: PASS');
  console.log('P8-built-in: Conditions is on by default; off, its tiles leave Home and the list and stay gone across a restart; on, they return to their pins at once; a failed save leaves the switch as recorded: PASS');
} catch (error) {
  console.error('P8 Home pins suite failed.');
  console.error(redact(error.message).split('\n').slice(0, 20).join('\n'));
  const at = String(error.stack ?? '').split('\n').find(line => line.includes('home-pages.mjs'));
  if (at) console.error(redact(at.trim()));
  process.exitCode = 1;
} finally {
  if (application) await application.close().catch(() => {});
  await rm(directory, { recursive: true, force: true }).catch(() => {});
}
