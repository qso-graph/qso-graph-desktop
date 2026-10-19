// SPDX-License-Identifier: GPL-3.0-only
// P9 in the running application (docs/P9.md): stations made, checked, made
// active and deleted from the Stations page, as an operator does.
//
//   P9-adif      a value ADIF refuses is shown beside its field with ADIF's
//                reason, and nothing is saved until it is right (QGD-STN-0002)
//   P9-active    a persona's default station becomes active with it; another
//                can be made active without changing the persona; the status
//                bar names both; deleting the active station leaves none
//                (QGD-STN-0005)
//   P9-record    stations, the default and the active one survive a restart
//                (QGD-STN-0001)
//   P9-stays-local  a station's street, city and postal code appear in no log
//                line (QGD-STN-0003)
//
// ADIF's definitions come from the archive `make setup` fetched, put in the
// reference cache, so nothing here depends on adif.org answering. POTA's parks
// are not downloaded, and the page is checked to say so.
import { _electron as electron, expect } from '@playwright/test';
import { cp, mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { redact } from './report.mjs';
import { assertNoVisibleWindow } from './no-visible-window.mjs';
import { enableTestKeychain } from './keychain-service.mjs';

// Nothing here makes a credential; the test service keeps it that way should
// anything try.
enableTestKeychain();

const directory = await mkdtemp(join(tmpdir(), 'qg-stations-'));
const profile = join(directory, 'profile');
const userData = join(directory, 'chromium');
const logs = join(directory, 'logs');
const referenceCache = join(directory, 'reference');
await mkdir(userData, { recursive: true });
await mkdir(referenceCache, { recursive: true });
const register = JSON.parse(await readFile('data/reference-sources.json', 'utf8'));
const archive = join('vendor', '.cache', `adif-${register.adif.version}.zip`);
await cp(archive, join(referenceCache, `adif-${register.adif.version}.zip`))
  .catch(() => { throw new Error(`${archive} is not there. Fetch it with: make setup`); });

// Values only an operator would type, so a log line carrying one is found.
const STREET = 'QG Stations Street 4f1c9a';
const CITY = 'QG Stations City 4f1c9a';
const POSTAL = 'QG-POSTAL-4F1C9A';

const launch = async () => {
  const application = await electron.launch({
    args: ['.'], cwd: process.cwd(), timeout: 30_000,
    env: {
      ...process.env, QG_DESKTOP_PROFILE_DIR: profile, QG_DESKTOP_USER_DATA_DIR: userData, QG_DESKTOP_LOG_DIR: logs,
      QG_DESKTOP_REFERENCE_CACHE: referenceCache
    }
  });
  const page = await application.firstWindow();
  await assertNoVisibleWindow(application, page, 'stations');
  return { application, page };
};

const rail = (page, name) => page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name, exact: true });
const row = (page, name) => page.locator(`li.station-row[data-station="${name}"]`);
const status = page => page.evaluate(() => window.storage.request({ type: 'status' }));
const field = (page, adif) => page.locator(`#station-${adif.toLowerCase().replaceAll('_', '-')}`);

let application;
try {
  let page;
  ({ application, page } = await launch());
  await expect.poll(async () => (await status(page)).status?.state, { timeout: 60_000 }).toBe('ready');

  // The page before anything is downloaded: no stations, and it says why
  // values cannot be checked yet and why a park cannot be used.
  await rail(page, 'Stations').click();
  await expect(page.locator('#no-stations')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#stations-unchecked')).toBeVisible();
  await expect(page.locator('#parks-not-downloaded')).toBeVisible();
  await expect(page.locator('#active-station')).toHaveText('No active station');

  // ADIF's definitions, as the operator downloads them.
  const accepted = await page.evaluate(() => window.storage.request({ type: 'update-reference', resource: 'adif' }));
  expect(accepted, 'the ADIF download must be accepted').toMatchObject({ ok: true });
  await expect.poll(async () => {
    const reply = await status(page);
    return reply.ok && reply.status.reference?.adif.state === 'loaded' && !reply.status.reference.refreshing
      && reply.status.stations?.checked === true;
  }, { message: 'ADIF\'s definitions must load', timeout: 180_000 }).toBe(true);
  await expect(page.locator('#stations-unchecked')).toHaveCount(0);

  // A persona to be the default for.
  const made = await page.evaluate(async () => {
    const upsert = await window.personas.request({ type: 'upsert', name: 'qg-stations-fixture', callsign: 'w1aw' });
    return upsert.ok ? window.personas.request({ type: 'set-active', name: 'qg-stations-fixture' }) : upsert;
  });
  expect(made, 'the fixture persona must be made active').toMatchObject({ ok: true });
  // Made through the persona service directly, so the window is reloaded to
  // read the personas as it does at start.
  await page.reload();
  await expect(page.locator('#active-persona')).toContainText('W1AW', { timeout: 30_000 });
  await rail(page, 'Stations').click();

  // ---- P9-adif ---------------------------------------------------------
  await page.locator('#add-station').click();
  await page.locator('#station-name').fill('Home');
  await field(page, 'MY_GRIDSQUARE').fill('DN13');
  await field(page, 'MY_DXCC').fill('291');
  await field(page, 'MY_STATE').fill('ID');
  await field(page, 'MY_CQ_ZONE').fill('41');
  await field(page, 'MY_STREET').fill(STREET);
  await field(page, 'MY_CITY').fill(CITY);
  await field(page, 'MY_POSTAL_CODE').fill(POSTAL);
  await page.locator('#station-default').check();
  await page.locator('#save-station').click();
  await expect(page.locator('#station-my-cq-zone-error')).toContainText('maximum of 40', { timeout: 30_000 });
  await expect(field(page, 'MY_CQ_ZONE')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#station-form-error')).toContainText('CQ zone: above ADIF\'s maximum of 40');
  expect((await status(page)).status.stations.list, 'nothing is saved while a value is refused').toEqual([]);
  await field(page, 'MY_CQ_ZONE').fill('3');
  await page.locator('#save-station').click();
  await expect(row(page, 'Home')).toBeVisible({ timeout: 30_000 });
  await expect(row(page, 'Home')).toContainText('Default for');
  console.log('P9-adif: a CQ zone of 41 was refused beside its field with ADIF\'s reason and nothing saved; corrected, the station saved: PASS');

  // ---- P9-active -------------------------------------------------------
  await page.locator('#add-station').click();
  await page.locator('#station-name').fill('Car');
  await page.locator('#station-kind').selectOption('Mobile');
  await field(page, 'MY_GRIDSQUARE').fill('DN14');
  await page.locator('#save-station').click();
  await expect(row(page, 'Car')).toBeVisible({ timeout: 30_000 });
  await row(page, 'Home').getByRole('button', { name: 'Make Home active' }).click();
  await expect(page.locator('#active-station')).toHaveText('At: Home', { timeout: 30_000 });
  await row(page, 'Car').getByRole('button', { name: 'Make Car active' }).click();
  await expect(page.locator('#active-station')).toHaveText('At: Car', { timeout: 30_000 });
  await expect(page.locator('#active-persona')).toContainText('W1AW');
  // Making the persona active again makes its default active with it.
  await page.evaluate(() => window.personas.request({ type: 'set-active', name: 'qg-stations-fixture' }));
  await expect(page.locator('#active-station')).toHaveText('At: Home', { timeout: 30_000 });
  console.log('P9-active: a station made active without changing the persona, and the persona\'s default made active with it; the status bar named both: PASS');

  // ---- P9-record -------------------------------------------------------
  await application.close();
  ({ application, page } = await launch());
  await expect(page.locator('#active-station')).toHaveText('At: Home', { timeout: 60_000 });
  await rail(page, 'Stations').click();
  await expect(row(page, 'Home')).toBeVisible({ timeout: 30_000 });
  await expect(row(page, 'Car')).toContainText('Mobile');
  await expect(row(page, 'Home')).toContainText('Default for');
  console.log('P9-record: the stations, the default and the active station were all there after a restart: PASS');

  // Deleting the active station leaves none active, and says so.
  await row(page, 'Home').getByRole('button', { name: 'Delete Home' }).click();
  await page.getByRole('button', { name: 'Delete station' }).click();
  await expect(row(page, 'Home')).toHaveCount(0, { timeout: 30_000 });
  await expect(page.locator('#no-active-station')).toBeVisible();
  await expect(page.locator('#active-station')).toHaveText('No active station');
  console.log('P9-active: deleting the active station left none active, said on the page and the status bar: PASS');

  // ---- P9-stays-local --------------------------------------------------
  await application.close();
  application = undefined;
  const files = await readdir(logs, { recursive: true });
  let logged = '';
  for (const file of files) logged += await readFile(join(logs, file), 'utf8').catch(() => '');
  expect(logged.length, 'the run must have written log lines to search').toBeGreaterThan(0);
  for (const value of [STREET, CITY, POSTAL]) expect(logged.includes(value), 'an address value reached the log').toBe(false);
  console.log('P9-stays-local: the station\'s street, city and postal code are in no log line: PASS');
} catch (error) {
  console.error('P9 Stations suite failed.');
  console.error(redact(error.message).split('\n').slice(0, 20).join('\n'));
  const at = String(error.stack ?? '').split('\n').find(line => line.includes('stations.mjs'));
  if (at) console.error(redact(at.trim()));
  process.exitCode = 1;
} finally {
  if (application) await application.close().catch(() => {});
  await rm(directory, { recursive: true, force: true }).catch(() => {});
}
