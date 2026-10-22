// SPDX-License-Identifier: GPL-3.0-only
// P6-setup-callsign-only (QGD-PSN-0004), walked in the real application.
//
// The exit gate is KI7MT walking setup on a clean machine, so this walks it on
// one: a fresh profile with no personas, the offer, the callsign, every
// service skipped, and a persona at the end with nothing saved against it.
//
// The two things it is really asserting are the ones an operator would notice:
// that a callsign is genuinely all that is required, and that the setup can be
// left part way and come back to what it was. The second is true because
// nothing in setup is held in limbo — the persona exists the moment it is
// named — so it is shown by leaving in the middle and returning.
import { _electron as electron, expect } from '@playwright/test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { redact } from './report.mjs';
import { enableTestKeychain } from './keychain-service.mjs';
import { assertNoVisibleWindow } from './no-visible-window.mjs';

// Fixtures go to this product's test Keychain service, never beside a real
// credential, and are swept on exit (QGD-CRD-0003). Called before the core is
// loaded, because the service name is read when an entry is made.
enableTestKeychain();

const require = createRequire(import.meta.url);
const { PersonaCore } = require('../dist/native/persona.node');

const directory = await mkdtemp(join(tmpdir(), 'qg-setup-walk-'));
const profile = join(directory, 'profile');
const userData = join(directory, 'chromium');
const logs = join(directory, 'logs');
await mkdir(userData, { recursive: true });
const callsign = `W1AW/${Math.floor(Math.random() * 9) + 1}`;
const notes = [];
let application;

try {
  application = await electron.launch({
    args: ['.'], cwd: process.cwd(),
    env: { ...process.env, QG_DESKTOP_PROFILE_DIR: profile, QG_DESKTOP_USER_DATA_DIR: userData, QG_DESKTOP_LOG_DIR: logs },
    timeout: 30_000
  });
  const page = await application.firstWindow();
  await assertNoVisibleWindow(application, page, 'setup-walk');
  await page.getByRole('navigation', { name: 'Sections' })
    .getByRole('button', { name: 'Callsigns', exact: true }).click();

  // The offer, which is an offer: the page P1 built is underneath it and the
  // form on it still works. Both are on screen at once.
  await expect(page.getByRole('heading', { name: 'New to QSO Graph Desktop?' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Add a callsign' })).toBeVisible();
  notes.push('a machine with no personas is offered setup, with the ordinary page still under it');

  await page.getByRole('button', { name: 'Set up step by step' }).click();
  await expect(page.getByRole('heading', { name: 'Set up QSO Graph Desktop' })).toBeVisible();

  // Scoped to the setup card. The Personas page stays mounted and hidden
  // while setup shows — this file's own rule, so the markup app.ts drives by
  // hand is never rebuilt under it — which means its Callsign field is in the
  // DOM too. Hidden from a user and from a screen reader; not from a locator.
  const card = page.locator('section.card',
    { has: page.getByRole('heading', { name: 'Set up QSO Graph Desktop' }) });

  // A callsign and nothing else. The name is left empty on purpose.
  await card.getByLabel('Callsign', { exact: true }).fill(callsign);
  await page.getByRole('button', { name: 'Add this callsign' }).click();
  // Waited for, not polled: creating the persona is a round trip to the
  // credential core, and asking what is on screen the instant after the click
  // asks before the answer.
  await expect(page.getByRole('button', { name: 'Skip for now' })).toBeVisible({ timeout: 15_000 });

  // Checked here as well as at the end, to divide the search when this fails.
  //
  // Twice this walk has ended with the persona's callsign carrying one extra
  // trailing uppercase letter — W1AW/4S, W1AW/9T — and it has not happened in
  // the thirty-odd runs since, instrumented or not. The field holds exactly
  // the typed value at the moment Create is pressed, so the defect is after
  // that. This says whether the core already had the wrong callsign the
  // instant it was made, which separates "the core was given it" from "the
  // page grew it later" without needing the failure to be caught live.
  await expect(page.locator('#active-persona'),
    'the callsign the core stored, the moment it stored it').toContainText(callsign.toUpperCase());

  // Now the services, one at a time, every one skipped.
  let steps = 0;
  for (;;) {
    const skip = page.getByRole('button', { name: 'Skip for now' });
    if (await skip.count() === 0) break;
    steps += 1;
    if (steps > 20) throw new Error('setup did not reach its end');

    // Each step says what the service is and how to get a credential, which
    // is the whole reason the register carries those sentences.
    // The setup card, by its heading: every page is in the DOM at once and
    // only one is shown, so the first card on the page is Home's.
    const text = await card.innerText();
    expect(text.length, 'a service step says what the service is').toBeGreaterThan(80);

    // Leaving in the middle and coming back: the persona is already made, so
    // returning starts at a service rather than asking for the callsign
    // again. Done once, at the first step.
    if (steps === 1) {
      await page.getByRole('navigation', { name: 'Sections' })
        .getByRole('button', { name: 'Home', exact: true }).click();
      await page.getByRole('navigation', { name: 'Sections' })
        .getByRole('button', { name: 'Callsigns', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Set up QSO Graph Desktop' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Skip for now' })).toBeVisible();
      notes.push('leaving setup part way and returning comes back to it, not to the callsign');
    }
    await skip.click();
  }
  expect(steps, 'every service in the register is a step').toBeGreaterThan(1);
  notes.push(`${steps} service steps, every one skipped`);

  // The end: the persona is on the page, not just in the status bar.
  //
  // This asserted that "Create a persona" was still the heading after
  // finishing — which was the broken state written down as the expected one.
  // Setup made the persona, the status bar said so, and the page behind it
  // showed an empty form as though nothing had happened: the core lowercases
  // a persona's name, and this remembered the spelling it sent rather than
  // the one that came back, so the page could not find what it had just made.
  await expect(page.locator('#setup-done')).toContainText(callsign);
  await page.getByRole('button', { name: 'Finish' }).click();
  await expect(page.locator('#page-title')).toHaveText(callsign.toUpperCase());
  await expect(page.locator('#persona-list')).toContainText(callsign.toUpperCase());
  await expect(page.locator('#callsign')).toHaveValue(callsign.toUpperCase());
  await expect(page.locator('#credential-card')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'New to QSO Graph Desktop?' })).toHaveCount(0);
  await expect(page.locator('#active-persona')).toContainText(callsign);
  notes.push('the persona setup made is on the page afterwards, selected, not only in the status bar');

  // And the page is usable at the window the product opens at. The offer was
  // a sibling of the persona page in a row layout, which left the form 75
  // pixels wide — KI7MT found that on a clean account, and no baseline could
  // have, because the screenshot fixture makes a persona and that withdraws
  // the offer.
  await page.setViewportSize({ width: 1100, height: 740 });
  const widths = await page.evaluate(() => {
    const shown = [...document.querySelectorAll('.page')].find(entry => !entry.hidden);
    return {
      form: Math.round(shown.querySelector('.page-main').getBoundingClientRect().width),
      sidebar: Math.round(shown.querySelector('aside').getBoundingClientRect().width)
    };
  });
  expect(widths.form, `the persona form was ${widths.form}px wide at the default window size`)
    .toBeGreaterThan(600);
  expect(widths.sidebar).toBeGreaterThan(150);
  notes.push(`at the window the product opens at, the form is ${widths.form}px and the list ${widths.sidebar}px`);

  // And what is actually in the profile: one persona, with the callsign as
  // its name because none was given, and nothing stored for any service.
  await application.close();
  application = undefined;
  const core = new PersonaCore(profile);
  const personas = core.list();
  expect(personas, 'setup made exactly one persona').toHaveLength(1);
  expect(personas[0].callsign).toBe(callsign.toUpperCase());
  expect(Object.keys(personas[0].providers), 'and saved nothing against it').toEqual([]);
  notes.push('a callsign and nothing else leaves one persona with no credential saved');

  console.log(`Guided setup: ${notes.length} checks: PASS`);
  for (const note of notes) console.log(`  ${note}`);
} catch (error) {
  console.error('Guided setup walk failed.');
  console.error(redact(String(error.message)).split('\n').slice(0, 16).join('\n'));
  process.exitCode = 1;
} finally {
  await application?.close().catch(() => {});
  await rm(directory, { recursive: true, force: true });
}
