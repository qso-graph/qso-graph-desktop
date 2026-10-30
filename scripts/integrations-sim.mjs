// SPDX-License-Identifier: GPL-3.0-only
// P13 in the running application (QGD-INT-0024): qso-graph-sim plays its
// sample of 20 m FT8 as WSJT-X's own messages into QSO Graph Desktop, and the
// Monitor shows them.
//
//   P13-off       a new profile listens on nothing: no Integrations process,
//                 and Integrations' page says nothing is listening
//                 (QGD-INT-0004, QGD-INT-0010)
//   P13-on        the WSJT-X adapter turned on opens its port, on this
//                 computer only, held by the QG Integrations process and no
//                 other (QGD-INT-0001, QGD-INT-0002, QGD-INT-0005)
//   P13-sim       qso-graph-sim's decodes reach the Monitor: its tabs are All
//                 and the copy of WSJT-X heard, its status line has the dial
//                 frequency and mode, and its grid has decodes by cycle
//                 (QGD-INT-0011, QGD-INT-0022, QGD-INT-0023, QGD-HOM-0015,
//                 QGD-HOM-0016)
//   P13-settings  the Monitor's own Settings tab, drawn from its manifest,
//                 limits the cycles its grid shows (QGD-HOM-0017)
//   P13-visible   Integrations' page says what it is hearing (QGD-INT-0010)
//   P13-closed    the adapter turned off closes its port: it can be bound
//                 again, and the page says nothing is listening
//                 (QGD-INT-0004)
//
// The simulator is qso-graph-sim from PyPI, pinned, run with uv's uvx: the
// same program an operator would use, not a copy of it in this repository.
import { _electron as electron, expect } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { createSocket } from 'node:dgram';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { stopProcessTree } from './stop-process-tree.mjs';
import { redact } from './report.mjs';
import { socketsOf } from './platform-process.mjs';
import { assertNoVisibleWindow } from './no-visible-window.mjs';
import { enableTestKeychain } from './keychain-service.mjs';

enableTestKeychain();

export const SIMULATOR = 'qso-graph-sim==0.2.0';

// uvx, or nothing: a suite that cannot run its simulator fails and says why,
// rather than passing having checked nothing.
const uvx = process.platform === 'win32' ? 'uvx.exe' : 'uvx';
if (spawnSync(uvx, ['--version'], { encoding: 'utf8' }).status !== 0) {
  console.error(`integrations-sim needs uv's uvx on the PATH to run ${SIMULATOR} (https://docs.astral.sh/uv/).`);
  process.exit(1);
}

// A port nothing holds, found by asking the operating system for one.
const freePort = () => new Promise((settle, fail) => {
  const probe = createSocket('udp4');
  probe.once('error', fail);
  probe.bind(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => settle(port)); });
});
// Whether this process can bind the port: the application holds it or not.
const bindable = port => new Promise(settle => {
  const probe = createSocket('udp4');
  probe.once('error', () => settle(false));
  probe.bind(port, '127.0.0.1', () => probe.close(() => settle(true)));
});

const directory = await mkdtemp(join(tmpdir(), 'qg-integrations-'));
const profile = join(directory, 'profile');
const userData = join(directory, 'chromium');
const logs = join(directory, 'logs');
await mkdir(userData, { recursive: true });

const integrationsProcess = application => application.evaluate(({ app }) =>
  app.getAppMetrics().filter(metric => metric.type === 'Utility' && (metric.serviceName === 'QG Integrations' || metric.name === 'QG Integrations'))
    .map(metric => metric.pid));
const rail = (page, name) => page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name, exact: true });

let application;
let simulator;
try {
  application = await electron.launch({
    args: ['.'], cwd: process.cwd(), timeout: 30_000,
    env: { ...process.env, QG_DESKTOP_PROFILE_DIR: profile, QG_DESKTOP_USER_DATA_DIR: userData, QG_DESKTOP_LOG_DIR: logs }
  });
  const page = await application.firstWindow();
  await assertNoVisibleWindow(application, page, 'integrations-sim');

  // P13-off.
  await rail(page, 'Integrations').click();
  await expect(page.locator('#integrations-nothing')).toBeVisible({ timeout: 30_000 });
  expect(await integrationsProcess(application), 'nothing listens, so no Integrations process starts').toEqual([]);

  // P13-on: the Monitor on, and the adapter on a port of the suite's own.
  const port = await freePort();
  const turnedOn = await page.evaluate(() => window.extensions.inventory({ type: 'set-enabled', id: 'monitor', enabled: true }));
  expect(turnedOn.ok, 'the Monitor turns on').toBe(true);
  await page.locator('#integration-wsjtx-port').fill(String(port));
  await page.locator('#integration-wsjtx-save').click();
  await expect(page.locator('#integration-wsjtx-said')).toHaveText('Saved.');
  await page.locator('#integration-wsjtx-on').check();
  await expect(page.locator('#integration-wsjtx-listening')).toContainText(`127.0.0.1:${port}`, { timeout: 30_000 });
  expect(await bindable(port), 'the port is held while the adapter is on').toBe(false);
  const [listener] = await integrationsProcess(application);
  expect(listener, 'the QG Integrations process is running').toBeGreaterThan(0);
  const held = socketsOf(listener);
  expect(held.ok, 'the Integrations process\'s sockets can be read').toBe(true);
  expect(held.sockets.some(socket => socket.endsWith(`:${port}`)), held.sockets.join(', ')).toBe(true);
  // The one way in: the window and main hold no socket on that port.
  for (const metric of await application.evaluate(({ app }) => app.getAppMetrics())) {
    if (metric.pid === listener) continue;
    const other = socketsOf(metric.pid);
    if (other.ok) expect(other.sockets.filter(socket => socket.endsWith(`:${port}`)), `${metric.type} ${metric.pid}`).toEqual([]);
  }

  // P13-sim: the simulator plays its sample, looping, at four times real
  // speed, so a cycle arrives every few seconds.
  simulator = spawn(uvx, [SIMULATOR, '--wsjtx', '--to', `127.0.0.1:${port}`, '--call', 'KI7MT', '--grid', 'DN13', '--speed', '4', '--loop'],
    { stdio: ['ignore', 'ignore', 'inherit'] });
  // Home reads what is on afresh each time it shows; the Monitor's rail item
  // is there after it.
  await rail(page, 'Home').click();
  await rail(page, 'Monitor').click();
  await expect(page.getByRole('heading', { level: 1, name: 'Monitor' })).toBeVisible({ timeout: 30_000 });
  // uvx fetches the simulator on its first run; then a cycle every few seconds.
  await expect(page.locator('#page-view-source-0')).toHaveText('WSJT-X', { timeout: 120_000 });
  await expect(page.locator('#page-view-all')).toHaveText('All');
  await expect(page.locator('section.page-body')).toContainText('14.074', { timeout: 30_000 });
  await expect(page.locator('section.page-body')).toContainText('FT8');
  await expect.poll(() => page.locator('section.page-body tbody tr').count(), { message: 'the Monitor shows decodes', timeout: 60_000 }).toBeGreaterThan(5);
  // A view of its own: the copy of WSJT-X alone.
  await page.locator('#page-view-source-0').click();
  await expect(page.locator('#page-view-source-0')).toHaveAttribute('aria-current', 'page', { timeout: 30_000 });
  await expect.poll(() => page.locator('section.page-body tbody tr').count(), { timeout: 30_000 }).toBeGreaterThan(5);

  // P13-settings: the Monitor's own Settings tab, drawn by the core from its
  // manifest; ten cycles shown is at most ten groups (QGD-HOM-0017).
  await page.locator('#page-tab-settings').click();
  await page.locator('#page-setting-cycles').selectOption('10');
  await page.locator('#page-view-all').click();
  await expect.poll(() => page.locator('section.page-body tr.page-table-group').count(), { message: 'ten cycles shown', timeout: 30_000 }).toBeLessThanOrEqual(10);

  // P13-visible.
  await rail(page, 'Integrations').click();
  await expect(page.locator('#integration-wsjtx-hearing')).toContainText('WSJT-X, last at', { timeout: 30_000 });

  // P13-closed.
  await page.locator('#integration-wsjtx-on').uncheck();
  await expect(page.locator('#integrations-nothing')).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => bindable(port), { message: 'turning the adapter off closes its port', timeout: 30_000 }).toBe(true);
  console.log(`integrations-sim: ${SIMULATOR} reached the Monitor through port ${port}, and the port closed with the adapter.`);
} catch (error) {
  // What the window showed and what the application logged, kept in report/
  // for CI to upload, as smoke keeps its own: the logs are the product's,
  // already redacted, and redacted again here.
  const kept = resolve('report', 'integrations-failure');
  await mkdir(kept, { recursive: true }).catch(() => {});
  await application?.windows()[0]?.screenshot({ path: join(kept, 'window.png') }).catch(() => {});
  for (const name of await readdir(logs).catch(() => [])) {
    const text = await readFile(join(logs, name), 'utf8').catch(() => '');
    await writeFile(join(kept, `${name}.txt`), redact(text)).catch(() => {});
  }
  throw error;
} finally {
  stopProcessTree(simulator);
  await application?.close().catch(() => undefined);
  await rm(directory, { recursive: true, force: true });
}
