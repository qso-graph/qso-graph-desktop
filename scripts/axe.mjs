// SPDX-License-Identifier: GPL-3.0-only
// P3-axe (QGD-PRT-0103): no accessibility violation on any page, in both
// themes. Measured by axe-core rather than judged, which is also what makes
// QGD-FRM-0003's contrast claim a measurement — the colour-contrast rule reads
// the rendered pixels of the palette that is actually in force.
//
// axe is evaluated, not injected. page.addScriptTag writes an inline <script>,
// and the renderer's content policy forbids one (QGD-SEC-0008); evaluating the
// source over the debugging protocol is outside the policy's reach, so the
// page under test keeps the hardening it ships with.
import { _electron as electron, expect } from '@playwright/test';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { redact } from './report.mjs';
import { assertNoVisibleWindow } from './no-visible-window.mjs';

const require = createRequire(import.meta.url);
const axeSource = await readFile(require.resolve('axe-core/axe.min.js'), 'utf8');
const axeVersion = require('axe-core/package.json').version;

const directory = await mkdtemp(join(tmpdir(), 'qg-axe-'));
const profile = join(directory, 'profile');
const userData = join(directory, 'chromium');
const logs = join(directory, 'logs');
await mkdir(userData, { recursive: true });
const persona = `qg-test-${randomUUID()}`;

let application;
const failures = [];
let checked = 0;

// What a run looks at. The inactive page is `hidden`, and axe skips what is
// not rendered, so each of these is one page's worth of findings and not two.
const PAGES = ['Home', 'Personas', 'Settings'];
const THEMES = ['light', 'dark'];

// `collect` is false for the control, whose violation is the point of it.
async function run(page, context, collect = true) {
  const result = await page.evaluate(async () => {
    // Everything, at the level the exit gate asks for. Nothing is disabled:
    // a rule turned off here is a violation that never gets reported.
    return await globalThis.axe.run(document, {
      resultTypes: ['violations'],
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] }
    });
  });
  if (!collect) return result;
  checked += 1;
  for (const violation of result.violations) {
    const where = violation.nodes.slice(0, 3).map(node => node.target.join(' ')).join(' | ');
    failures.push(`${context}: ${violation.id} (${violation.impact}) — ${violation.help} [${where}]`);
  }
  return result;
}

try {
  application = await electron.launch({
    args: ['.'], cwd: process.cwd(),
    env: { ...process.env, QG_DESKTOP_PROFILE_DIR: profile, QG_DESKTOP_USER_DATA_DIR: userData, QG_DESKTOP_LOG_DIR: logs },
    timeout: 30_000
  });
  const page = await application.firstWindow();
  await assertNoVisibleWindow(application, page, 'axe');
  // The application opens on Home now (QGD-FRM-0011). Personas is a click away.
  await page.getByRole('navigation', { name: 'Sections' })
    .getByRole('button', { name: 'Personas', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Create a persona' })).toBeVisible();
  await page.evaluate(axeSource);
  expect(await page.evaluate(() => typeof globalThis.axe?.run)).toBe('function');

  // A control, before anything is believed. A button with no accessible name
  // is a violation axe always reports; if this does not fire, the run below
  // reporting nothing means nothing.
  await page.evaluate(() => {
    const control = document.createElement('button');
    control.id = '__axe_control__';
    document.body.append(control);
  });
  const control = await run(page, 'control', false);
  if (!control.violations.some(violation => violation.id === 'button-name')) {
    failures.push('the control did not fire: a button with no accessible name was not reported, so this suite is not checking anything');
  }
  await page.evaluate(() => document.getElementById('__axe_control__')?.remove());

  // A second control, for the rule QGD-FRM-0003 actually rests on. The first
  // proves axe runs; this proves it is reading the rendered colours of this
  // page, which is what makes "measured rather than judged" true. Set through
  // the CSSOM rather than a style attribute — QGD-SEC-0008 forbids the latter
  // and CSP does not reach the former.
  await page.evaluate(() => {
    const control = document.createElement('p');
    control.id = '__axe_contrast__';
    control.textContent = 'deliberately unreadable';
    control.style.color = '#808080';
    control.style.backgroundColor = '#8a8a8a';
    document.body.append(control);
  });
  const contrast = await run(page, 'contrast control', false);
  if (!contrast.violations.some(violation => violation.id === 'color-contrast')) {
    failures.push('the contrast control did not fire: grey on grey was not reported, so contrast is not being measured on this page');
  }
  await page.evaluate(() => document.getElementById('__axe_contrast__')?.remove());

  // A persona, so the credential card and the status bar are on screen too —
  // the empty state is the smallest page there is and the least worth
  // measuring.
  // The persona broker owns a utility process that starts after the window
  // does. Filling the form before it answers means the create request is sent
  // to something that is not there yet — which is why this suite failed to
  // create a persona on roughly one run in five while the application was
  // perfectly healthy. scripts/smoke.mjs has always waited; these did not.
  await expect.poll(() => page.evaluate(() => window.personas.request({ type: 'list' }).then(reply => reply.ok)),
    { message: 'the persona service must be answering before the form is used', timeout: 30_000 }).toBe(true);
  await page.getByLabel('Persona name', { exact: true }).fill(persona);
  await page.getByLabel('Callsign', { exact: true }).fill('W1AW');
  await page.getByLabel('Start date', { exact: true }).fill('2026-01-01');
  await page.getByRole('button', { name: 'Create persona', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'W1AW', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Use this persona', exact: true }).click();
  await expect(page.locator('#active-persona')).toContainText('Active: W1AW');

  const rail = name => page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name, exact: true });

  for (const theme of THEMES) {
    await rail('Settings').click();
    await page.getByLabel('Theme', { exact: true }).selectOption(theme);
    await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe(theme);
    for (const name of PAGES) {
      await rail(name).click();
      await expect(page.getByRole('navigation', { name: 'Sections' })).toBeVisible();
      await run(page, `${name} in ${theme}`);
    }

    // Troubleshooting is a surface with controls on it — a level switch, a
    // save, start and stop — so it is scanned like a page even though it is
    // not one (QGD-LOG-0013, QGD-FRM-0012). Scanned open, because closed it is
    // not in the document at all.
    await page.locator('#open-troubleshooting').click();
    await expect(page.locator('#troubleshooting')).toBeVisible();
    await expect(page.getByLabel('Detail level', { exact: true })).toBeVisible({ timeout: 30_000 });
    await run(page, `Troubleshooting in ${theme}`);
    await page.locator('#close-troubleshooting').click();
    await expect(page.locator('#troubleshooting')).toHaveCount(0);
  }

  if (failures.length) {
    console.error('Accessibility check failed.');
    for (const failure of failures) console.error(`  ${failure}`);
    process.exitCode = 1;
  } else {
    console.log(`Accessibility: axe-core ${axeVersion}, ${checked} page views (${PAGES.join(', ')} and Troubleshooting, in ${THEMES.join(' and ')}), both controls fired, 0 violations: PASS`);
  }
} catch (error) {
  console.error('Accessibility check could not run.');
  console.error(redact(error.message).split('\n').slice(0, 20).join('\n'));
  process.exitCode = 1;
} finally {
  await application?.close().catch(() => {});
  await rm(directory, { recursive: true, force: true });
}
