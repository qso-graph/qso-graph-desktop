// SPDX-License-Identifier: GPL-3.0-only
// P3-screenshots (QGD-PRT-0103): a baseline per page per theme, captured for
// KI7MT's approval. Approval is his; this produces them and fails when one
// changes unexpectedly.
//
//   node scripts/screenshots.mjs            compare against baselines/
//   node scripts/screenshots.mjs --approve  make what was captured the baseline
//
// Approving is a deliberate command, so a changed screen cannot become the
// expected screen by being run past.
//
// The content is fixed: one persona with a fixed name, callsign and date, and
// a log directory inside the repository rather than a temporary one — a path
// that changed every run would redraw the Logs page every run and the
// comparison would mean nothing. Baselines are machine-local until there is a
// CI matrix; QGD-SCP-0003 and QGD-SCP-0004 defer that to Release 1.
import { _electron as electron, expect } from '@playwright/test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { redact } from './report.mjs';
import { compare, decode } from './png.mjs';

const approve = process.argv.includes('--approve');
const baselines = resolve('baselines');
const captures = resolve('report/screenshots');

// Captures until two consecutive shots are identical, so what is compared is a
// settled page rather than one caught mid-paint. The first run after a build
// renders from a cold cache and was producing a handful of differing
// antialiased pixels; the answer to that is to wait for the page to stop
// moving, not to widen the comparison until it stops noticing.
async function stableShot(page, path) {
  let previous;
  let last;
  for (let attempt = 0; attempt < 24; attempt++) {
    const shot = await page.screenshot({ path });
    if (previous) {
      last = compare(decode(previous), decode(shot));
      if (last.same) return shot;
    }
    previous = shot;
    await page.waitForTimeout(250);
  }
  throw new Error(`${path}: the page never stopped changing (${last?.reason ?? 'no comparison'})`);
}

// The name is deliberately one nobody would choose. QGD-CRD-0003 has the
// credential core own its Keychain entry names, and it keys them by the
// service and `persona:provider` — the profile directory is not part of the
// key, so a temporary profile does NOT isolate a persona from the operator's
// real Keychain entries. "Home station" is the placeholder text in the persona
// name field and so is about the likeliest real persona name there is: this
// fixture would have read the operator's saved credentials, drawn a different
// credential status into the baseline, and possibly raised a Keychain prompt
// in the middle of a verification run.
const PERSONA = { name: 'qg-baseline-fixture', callsign: 'W1AW', start: '2026-01-01' };
const VIEW = { width: 1100, height: 740 };
const THEMES = ['light', 'dark'];
const PAGES = ['Home', 'Personas', 'Settings'];

const directory = await mkdtemp(join(tmpdir(), 'qg-shots-'));
const logs = resolve('report/screenshot-logs');
await mkdir(join(directory, 'chromium'), { recursive: true });
await rm(logs, { recursive: true, force: true });
await mkdir(logs, { recursive: true });
await mkdir(captures, { recursive: true });

let application;
const failures = [];
const changed = [];
const written = [];

try {
  application = await electron.launch({
    // Rendered the same way every time, rather than the way this display
    // happens to render today. Without these, half the pixels differ between
    // two runs that look identical: the differences are 1 or 2 out of 255,
    // antialiasing and colour profile, and they are invisible to the eye and
    // fatal to an exact comparison. Removing the variable is better than
    // widening the comparison until it stops noticing.
    args: [
      '.',
      // Software rendering: no GPU, so no difference between one and another.
      '--disable-gpu',
      // One colour profile, not the profile of whichever display the window
      // opened on.
      '--force-color-profile=srgb',
      // Greyscale antialiasing. Subpixel antialiasing depends on the panel.
      '--disable-lcd-text'
    ],
    cwd: process.cwd(),
    env: {
      ...process.env,
      QG_DESKTOP_PROFILE_DIR: join(directory, 'profile'),
      QG_DESKTOP_USER_DATA_DIR: join(directory, 'chromium'),
      QG_DESKTOP_LOG_DIR: logs
    },
    timeout: 30_000
  });
  const page = await application.firstWindow();
  // The application opens on Home now (QGD-FRM-0011). Personas is a click away.
  await page.getByRole('navigation', { name: 'Sections' })
    .getByRole('button', { name: 'Personas', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Create a persona' })).toBeVisible();
  await page.setViewportSize(VIEW);

  // The one thing on these pages that moves. A blinking caret is two pixels
  // that differ every other frame, which no amount of waiting settles — and it
  // is not part of the design being baselined. Inserted through the CSSOM
  // because QGD-SEC-0008 forbids an inline style and CSP does not reach the
  // CSSOM. Nothing else about the page is altered.
  await page.evaluate(() => {
    const sheet = document.styleSheets[0];
    sheet.insertRule('*, *::before, *::after { caret-color: transparent !important; }', sheet.cssRules.length);
  });

  // The persona broker owns a utility process that starts after the window
  // does. Filling the form before it answers means the create request is sent
  // to something that is not there yet — which is why this suite failed to
  // create a persona on roughly one run in five while the application was
  // perfectly healthy. scripts/smoke.mjs has always waited; these did not.
  await expect.poll(() => page.evaluate(() => window.personas.request({ type: 'list' }).then(reply => reply.ok)),
    { message: 'the persona service must be answering before the form is used', timeout: 30_000 }).toBe(true);
  await page.getByLabel('Persona name', { exact: true }).fill(PERSONA.name);
  await page.getByLabel('Callsign', { exact: true }).fill(PERSONA.callsign);
  await page.getByLabel('Start date', { exact: true }).fill(PERSONA.start);
  await page.getByRole('button', { name: 'Create persona', exact: true }).click();
  // The persona round-trips through the Rust core. Five seconds is Playwright's
  // default and it is not enough on a machine that is busy — this assertion
  // failed twice that way while the application was behaving correctly.
  await expect(page.getByRole('heading', { name: PERSONA.callsign, exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Use this persona', exact: true }).click();
  await expect(page.locator('#active-persona')).toContainText(`Active: ${PERSONA.callsign}`);
  // The status line is a line of text in the baseline, and it was the last
  // thing moving between runs. app.ts retries its first persona list for up to
  // two and a half seconds, and when that finally lands it selects the active
  // persona, which clears the line — so whether the message was still there at
  // capture time depended on which finished first.
  //
  // Converged on deliberately rather than raced: selecting the persona clears
  // the line, and so does the late startup list, so both orderings end in the
  // same state and the baseline shows a page at rest.
  await page.locator('.persona-item').first().click();
  await expect(page.locator('#message')).toHaveText('');

  const rail = name => page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name, exact: true });

  // Settings now shows what the database is doing, and "starting" becomes
  // "running" a few seconds in. Waited for rather than captured mid-flight,
  // or the baseline would differ from one run to the next.
  await rail('Settings').click();
  await expect.poll(() => page.getByLabel('State', { exact: true }).inputValue(),
    { message: 'the engine must settle before anything is captured', timeout: 180_000 })
    .toBe('Running');

  for (const theme of THEMES) {
    await rail('Settings').click();
    await page.getByLabel('Theme', { exact: true }).selectOption(theme);
    await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe(theme);
    for (const name of PAGES) {
      await rail(name).click();
      await expect(page.getByRole('navigation', { name: 'Sections' })).toBeVisible();
      // The caret blinks. Nothing else on these pages moves, and a blinking
      // caret in a baseline is a comparison that fails every other run.
      await page.evaluate(() => { const focused = document.activeElement; if (focused && 'blur' in focused) focused.blur(); });
      const file = `${name.toLowerCase()}-${theme}.png`;
      const shot = await stableShot(page, join(captures, file));
      // Checked after the fact, not only before: a capture is worth nothing if
      // the page re-themed while it was being taken, and "half the pixels
      // differ" is a slow way to be told that.
      const drawnAs = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
      if (drawnAs !== theme) {
        failures.push(`${file}: captured while the page was ${drawnAs ?? 'unthemed'}, not ${theme}`);
        continue;
      }

      const baselineFile = join(baselines, file);
      const current = decode(shot);
      // The decode is real: a screenshot of this window is this size, and a
      // decoder returning something else would make every comparison pass.
      if (current.width !== VIEW.width || current.height !== VIEW.height) {
        failures.push(`${file}: captured ${current.width}x${current.height}, expected ${VIEW.width}x${VIEW.height}`);
        continue;
      }

      if (approve) {
        await writeFile(baselineFile, shot);
        written.push(file);
        continue;
      }

      const existing = await readFile(baselineFile).catch(() => undefined);
      if (!existing) {
        failures.push(`${file}: no baseline. Review report/screenshots/${file}, then approve it with: node scripts/screenshots.mjs --approve`);
        continue;
      }
      const result = compare(decode(existing), current);
      if (!result.same) {
        changed.push(`${file}: ${result.reason}`);
      }
    }
  }

  if (approve) {
    console.log(`Screenshots approved: ${written.length} baseline(s) written to baselines/ — ${written.join(', ')}`);
  } else if (failures.length || changed.length) {
    console.error('Screenshot baselines failed.');
    for (const failure of [...failures, ...changed]) console.error(`  ${failure}`);
    if (changed.length) {
      console.error('  Compare report/screenshots/ against baselines/. If the change is wanted,');
      console.error('  approve it with: node scripts/screenshots.mjs --approve');
    }
    process.exitCode = 1;
  } else {
    console.log(`Screenshots: ${PAGES.length * THEMES.length} baselines (${PAGES.join(' and ')}, in ${THEMES.join(' and ')}) match, pixel for pixel: PASS`);
  }
} catch (error) {
  console.error('Screenshot capture could not run.');
  console.error(redact(error.message).split('\n').slice(0, 20).join('\n'));
  // What the page was saying at the time. A locator timeout on its own leaves
  // the reason to be guessed at.
  const reported = await application?.firstWindow()
    .then(window => window.locator('#message').textContent())
    .catch(() => undefined);
  if (reported) console.error(`The page reported: ${redact(reported)}`);
  process.exitCode = 1;
} finally {
  await application?.close().catch(() => {});
  await rm(directory, { recursive: true, force: true });
}
