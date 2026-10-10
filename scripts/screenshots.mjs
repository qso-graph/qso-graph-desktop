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
// **Approving is KI7MT's, not an agent's.** QGD-PRT-0103 says "screenshot
// baselines approved by KI7MT": a baseline is what the product is supposed to
// look like, so approving one is a judgement about what a user sees. An agent
// captures and compares; it does not decide. Watson ran --approve during P5
// and P6 on a change to two sentences the product shows, which was not his to
// make — Bob caught it. So the command now records who ran it against
// data/baseline-approval.json, and every run says how many baselines are
// waiting for KI7MT.
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
import { createHash } from 'node:crypto';
import { redact } from './report.mjs';
import { compare, decode, describeDiff } from './png.mjs';

// Who is approving. An agent passing --approve has to say so, and what it
// writes lands in "awaiting" rather than in "approved": the register is the
// honest record of what KI7MT has actually seen.
const APPROVAL_REGISTER = resolve('data/baseline-approval.json');
const approvedBy = (process.argv.find(argument => argument.startsWith('--by='))?.slice(5) ?? '').trim();

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
// Not a rail destination — an overlay opened from the status bar
// (QGD-LOG-0013, QGD-FRM-0012) — so it is captured by opening it rather than
// by navigating to it. Its own baseline, because it is where the logs, the
// level switch and the support bundle now live, and nothing else shows them.
const OVERLAY = 'Troubleshooting';

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

// Capture one surface and compare it, or write it when approving.
//
// A function rather than loop body because Troubleshooting is captured by
// opening it, not by navigating to it, and the two must be recorded the same
// way: same settle loop, same scroll reset, same theme check after the fact.
async function record(page, file, theme) {
    // Both panes back to the top, and proven to be there. A page captured at
    // a different scroll offset differs over its whole content area for a
    // reason no colour comparison can name.
    await page.evaluate(() => {
      for (const element of document.querySelectorAll('aside, .page-main')) {
        element.scrollTop = 0;
        element.scrollLeft = 0;
      }
    });
    const offsets = await page.evaluate(() => [...document.querySelectorAll('aside, .page-main')]
      .map(element => `${element.scrollTop},${element.scrollLeft}`));
    for (const offset of offsets) {
      expect(offset, 'every pane is scrolled to the top before capture').toBe('0,0');
    }
    const shot = await stableShot(page, join(captures, file));
    // Checked after the fact, not only before: a capture is worth nothing if
    // the page re-themed while it was being taken, and "half the pixels
    // differ" is a slow way to be told that.
    const drawnAs = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    if (drawnAs !== theme) {
      failures.push(`${file}: captured while the page was ${drawnAs ?? 'unthemed'}, not ${theme}`);
      return;
    }

    const baselineFile = join(baselines, file);
    const current = decode(shot);
    // The decode is real: a screenshot of this window is this size, and a
    // decoder returning something else would make every comparison pass.
    if (current.width !== VIEW.width || current.height !== VIEW.height) {
      failures.push(`${file}: captured ${current.width}x${current.height}, expected ${VIEW.width}x${VIEW.height}`);
      return;
    }

    if (approve) {
      await writeFile(baselineFile, shot);
      written.push(file);
      return;
    }

    const existing = await readFile(baselineFile).catch(() => undefined);
    if (!existing) {
      failures.push(`${file}: no baseline. Review report/screenshots/${file}, then approve it with: node scripts/screenshots.mjs --approve`);
      return;
    }
    const baseline = decode(existing);
    const result = compare(baseline, current);
    if (!result.same) {
      // The reason alone is a pixel count and one coordinate, which does
      // not say where the difference is or what shape it has — and that was
      // the whole question when this suite began failing intermittently.
      // describeDiff adds the region, how densely it differs inside it, how
      // far off the channels are, and some actual colours. It names no
      // cause, deliberately: see the note on it in png.mjs.
      changed.push(`${file}: ${result.reason}\n      ${describeDiff(baseline, current)}`);
    }
}

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
      '--disable-lcd-text',
      // One scale factor, not the scale of whichever display the window opened
      // on. This machine drives more than one, and a window opening on a
      // Retina panel one run and a 1x panel the next would rasterise the same
      // layout differently.
      //
      // Honest about what this did and did not do: it was added while chasing
      // the intermittent failure and it did NOT fix it — the suite still
      // failed 4 runs in 8 afterwards, and the cause turned out to be the
      // Applications inventory race handled below. It stays because it pins a
      // real variable and provably changes nothing: all six baselines still
      // match pixel for pixel with it in place.
      '--force-device-scale-factor=1',
      // Glyphs rasterised at whole pixels. Subpixel positioning makes the same
      // text render differently depending on its fractional x, which is the
      // other way a settled page differs between two runs.
      '--disable-font-subpixel-positioning'
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

  // The status bar says what the database is doing, and "starting" becomes
  // "running" a few seconds in. Waited for rather than captured mid-flight, or
  // every baseline would differ from one run to the next — the indicator is on
  // the status bar, so it is in all of them (QGD-FRM-0012).
  //
  // Read from the bar rather than from a page, which is also why this no
  // longer needs to navigate to Settings first: the engine's detail moved into
  // Troubleshooting on 2026-10-10.
  await expect.poll(() => page.locator('#engine-indicator').innerText(),
    { message: 'the engine must settle before anything is captured', timeout: 180_000 })
    .toBe('Database: Running');

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
      // Settings held a section fed over IPC until 2026-10-10, and a capture
      // taken while it still read "Reading which applications are
      // installed…" was a different page from the baseline — the failure this
      // suite had 4 runs in 8. That section is gone (QGD-APP-0012.1), and
      // with it the precondition. Nothing on these three pages now waits on
      // an answer from the main process except the engine, which is settled
      // above before anything is captured.
      await record(page, `${name.toLowerCase()}-${theme}.png`, theme);
    }

    // Troubleshooting, opened from the status bar rather than navigated to.
    //
    // Captured because it is where the logs, the level switch and the support
    // bundle live now (QGD-LOG-0013) and where the database's detail is
    // (QGD-FRM-0012) — none of which any other baseline shows. Opened from
    // the Home page so the panel is over the same backdrop every run, and
    // closed afterwards so the next theme starts from the same place.
    await rail('Home').click();
    await page.locator('#open-troubleshooting').click();
    await expect(page.locator('#troubleshooting')).toBeVisible();
    // The level switch reads the logs status over IPC. Waiting for the panel's
    // own content rather than for the panel is the lesson the Applications
    // section taught: markup is drawn before the answer arrives, and two
    // identical frames can both land inside that wait.
    await expect(page.locator('#log-level')).toBeVisible({ timeout: 30_000 });
    await record(page, `troubleshooting-${theme}.png`, theme);
    await page.locator('#close-troubleshooting').click();
    await expect(page.locator('#troubleshooting')).toHaveCount(0);
  }

  if (approve) {
    const register = JSON.parse(await readFile(APPROVAL_REGISTER, 'utf8'));
    const hashes = {};
    for (const file of written) {
      hashes[file] = createHash('sha256').update(await readFile(join(baselines, file))).digest('hex');
    }
    if (approvedBy.toUpperCase() === 'KI7MT') {
      register.approved.push({
        by: 'KI7MT', date: new Date().toISOString().slice(0, 10),
        what: `${written.length} baseline(s): ${written.join(', ')}`,
        recordedAtUtc: new Date().toISOString(),
        files: hashes
      });
      register.awaiting.files = {};
      console.log(`Screenshots approved by KI7MT: ${written.length} baseline(s) — ${written.join(', ')}`);
    } else {
      // Captured and written, and recorded as not yet approved. An agent can
      // keep the suite comparing against what the product draws without
      // pretending the judgement has been made.
      register.awaiting.files = { ...register.awaiting.files, ...hashes };
      console.log(`${written.length} baseline(s) written and recorded as AWAITING KI7MT — ${written.join(', ')}`);
      console.log('  Approving is his (QGD-PRT-0103). Run with --by=KI7MT only when he has said so.');
    }
    await writeFile(APPROVAL_REGISTER, JSON.stringify(register, null, 2) + '\n');
  } else if (failures.length || changed.length) {
    console.error('Screenshot baselines failed.');
    for (const failure of [...failures, ...changed]) console.error(`  ${failure}`);
    if (changed.length) {
      console.error('  Compare report/screenshots/ against baselines/. If the change is wanted,');
      console.error('  approve it with: node scripts/screenshots.mjs --approve');
    }
    process.exitCode = 1;
  } else {
    console.log(`Screenshots: ${(PAGES.length + 1) * THEMES.length} baselines (${PAGES.join(', ')} and ${OVERLAY}, in ${THEMES.join(' and ')}) match, pixel for pixel: PASS`);
    // Said on every green run, because a baseline nobody has approved is a
    // picture of what the product draws and not a statement that it is right
    // (QGD-PRT-0103).
    const register = JSON.parse(await readFile(APPROVAL_REGISTER, 'utf8').catch(() => '{}'));
    const waiting = Object.keys(register?.awaiting?.files ?? {}).length;
    if (waiting) {
      console.log(`  ${waiting} of them are waiting for KI7MT to approve ` +
        '(data/baseline-approval.json); an agent captured and compared, it did not approve.');
    }
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
