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
// captures and compares; it does not decide. An agent once ran --approve on a
// change to two sentences the product shows, which was not its call to make.
// So the command now records who ran it against
// data/baseline-approval.json, and every run says how many baselines are
// waiting for KI7MT.
//
// The content is fixed: one callsign with a fixed call, description and date, and
// a log directory inside the repository rather than a temporary one — a path
// that changed every run would redraw the Logs page every run and the
// comparison would mean nothing. Baselines are machine-local until there is a
// CI matrix; QGD-SCP-0003 and QGD-SCP-0004 defer that to Release 1.
import { _electron as electron, expect } from '@playwright/test';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { redact } from './report.mjs';
import { colourCount, compare, decode, describeDiff, RENDER_TOLERANCE } from './png.mjs';
import { assertNoVisibleWindow } from './no-visible-window.mjs';

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
// What varies by nature from one run to the next, and is masked: the
// operator's own folder (a temporary one here), the sizes of the stores, the
// clock in the header and every card's time. A mask covers the value and
// nothing more: a mask over a label or a button would let that label or button
// change unseen (Hopper, 2026-10-12, found three that did). The values
// themselves are the smoke suite's to assert. A mask is a box drawn over the
// element in the capture, so it hides content and nothing else.
//
// Conditions' page (P8) is drawn from recorded NOAA responses
// (tests/fixtures/noaa/quiet), so it is the same every run. Its times are
// masked: they gain the date once the day they show is not today, so the
// recorded responses would redraw the page at midnight. Home itself is tiles
// drawn from the manifest and has nothing that moves (KI7MT, 2026-10-22).
const VOLATILE = [
  // The operator's folder (a temporary one here) and the stores' sizes: only
  // the values, so the words around them are still compared.
  '#storage-folder', '.storage-size',
  // The log folder is this checkout's report/screenshot-logs: fixed within one
  // checkout, but the baselines are committed and compared from any checkout
  // (~/qgd-bob, a maintainer's own clone), so the path differs between them.
  '#log-directory',
  // The header's clock: its times, not its "UTC" and "Local" labels.
  '#header-clock .clock-time',
  '#page-observed', '.figure-time'
];
// Not masked, because in this run they do not change: nothing is fetched at
// start, so Home's reference line and Storage's reference list both say "not
// loaded", and the capture waits until they do.

// The masks that are actually in view. Playwright paints a mask where its
// element is even when a scrolling panel has moved it out of sight, which put
// grey boxes over the page title in troubleshooting-end. So each element is
// masked only while it is inside every scrolling ancestor's visible area.
async function visibleMasks(page, selectors) {
  const out = [];
  for (const selector of selectors) {
    const shown = await page.locator(selector).evaluateAll(elements => elements.map(element => {
      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) return false;
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (!/(auto|scroll|hidden)/.test(style.overflowY + style.overflowX)) continue;
        const clip = parent.getBoundingClientRect();
        if (box.bottom <= clip.top || box.top >= clip.bottom || box.right <= clip.left || box.left >= clip.right) return false;
      }
      return true;
    }));
    shown.forEach((visible, index) => { if (visible) out.push(page.locator(selector).nth(index)); });
  }
  return out;
}

async function stableShot(page, path, masks = VOLATILE) {
  // The pointer off every control first. A button under it is drawn hovered,
  // and a hovered button is drawn through a filter (brightness), whose edges
  // are not rasterised the same way twice: after a click on Home the pointer
  // stayed on it, and the rail icons' edges came out up to 33 shades
  // different from one run to the next, 14 pixels, a different capture
  // failing each run (2026-10-22). The middle of the header holds nothing
  // that reacts to the pointer.
  await page.mouse.move(Math.round(VIEW.width / 2), 28);
  let previous;
  let last;
  const mask = await visibleMasks(page, masks);
  for (let attempt = 0; attempt < 24; attempt++) {
    const shot = await page.screenshot({ path, mask, maskColor: '#888888' });
    if (previous) {
      last = compare(decode(previous), decode(shot));
      if (last.same) {
        // A window that is never shown can hand back an empty frame, and an
        // empty frame is stable — so settling is not evidence of a picture.
        const colours = colourCount(decode(shot));
        if (colours < 16) {
          throw new Error(
            `${path}: the capture holds ${colours} colour(s), which is a blank `
            + 'frame rather than a screen. The window is hidden during a suite '
            + 'run (packages/main/window-visibility.ts); capture has to keep '
            + 'working with it hidden.'
          );
        }
        return shot;
      }
    }
    previous = shot;
    await page.waitForTimeout(250);
  }
  throw new Error(`${path}: the page never stopped changing (${last?.reason ?? 'no comparison'})`);
}

// The fixture callsign. Until 2026-10-22 Keychain entries were named by a
// callsign's name, so a fixture called "Home station" would have read the
// operator's own saved credentials into the baseline, and this had to be
// called something nobody would choose. An entry is now named by the
// callsign's random id (QGD-CRD-0003), so the fixture can read as an
// operator's would.
const FIXTURE = { description: 'Home station', call: 'W1AW', start: '2026-01-01' };
const VIEW = { width: 1100, height: 740 };
const THEMES = ['light', 'dark'];
const PAGES = ['Home', 'Callsigns', 'Locations', 'Settings'];
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
// Every capture this run took, for the count it reports.
const captured = [];

// Capture one surface and compare it, or write it when approving.
//
// A function rather than loop body because Troubleshooting is captured by
// opening it, not by navigating to it, and the two must be recorded the same
// way: same settle loop, same scroll reset, same theme check after the fact.
// A capture of something drawn over Home: the pin dialog, Troubleshooting. A
// mask is painted over its element even where the overlay covers it, which
// put grey blocks across Troubleshooting's text and its Close button. So the
// masks of a page's times are left out; Home has no moving values of its own
// since its pins became tiles (KI7MT, 2026-10-22).
const OVER_HOME_MASKS = VOLATILE.filter(selector => selector !== '#page-observed' && selector !== '.figure-time');
async function recordOverHome(page, file, theme, options = {}) {
  await record(page, file, theme, OVER_HOME_MASKS, options);
}

// Everything below the first screen, a screen at a time with an overlap, so
// no part of a tall page is in no capture: <name>-2, <name>-3, ... and the
// last one <name>-end, scrolled to the end. Hopper found Callsigns' middle (the
// credential fields) in neither the top capture nor the end one.
const OVERLAP = 60;
async function recordScreens(page, name, theme, capture, pane = '.page-main') {
  const [height, client] = await page.evaluate(target => {
    // The one on screen: every page keeps its own .page-main in the document,
    // and the first is Home's even while another page shows.
    const element = [...document.querySelectorAll(target)].find(candidate => candidate.clientHeight > 0);
    return element ? [element.scrollHeight, element.clientHeight] : [0, 0];
  }, pane);
  if (height <= client) return;
  const step = client - OVERLAP;
  for (let at = step, index = 2; at < height - client; at += step, index += 1) {
    await capture(page, `${name}-${index}-${theme}.png`, theme, VOLATILE, { scroll: at, pane });
  }
  await capture(page, `${name}-end-${theme}.png`, theme, VOLATILE, { scroll: 'end', pane });
}

async function record(page, file, theme, masks = VOLATILE, { scroll = 'top', pane = '.page-main' } = {}) {
    // Both panes at a known offset, and proven to be there. A page captured at
    // a different scroll offset differs over its whole content area for a
    // reason no colour comparison can name. 'top' for every page; 'end' for a
    // page whose last card is below the fold (Settings' Extensions), which no
    // capture from the top contains.
    // `pane` is the element scrolled to its end: the page, or an overlay that
    // scrolls on its own (Troubleshooting).
    await page.evaluate(([scrollTo, target]) => {
      // Only what is on screen: hidden pages keep their panes in the document,
      // and a pane with no height cannot scroll.
      for (const element of [...document.querySelectorAll(`aside, .page-main, ${target}`)].filter(e => e.clientHeight > 0)) {
        element.scrollTop = !element.matches(target) ? 0 : scrollTo === 'end' ? element.scrollHeight : typeof scrollTo === 'number' ? scrollTo : 0;
        element.scrollLeft = 0;
      }
    }, [scroll, pane]);
    const offsets = await page.evaluate(([scrollTo, target]) => [...document.querySelectorAll(`aside, .page-main, ${target}`)]
      .filter(element => element.clientHeight > 0)
      .map(element => (!element.matches(target) || scrollTo === 'top' ? `${element.scrollTop},${element.scrollLeft}`
        : scrollTo === 'end' ? (element.scrollTop + element.clientHeight >= element.scrollHeight - 1 ? 'end' : `stopped at ${element.scrollTop}`)
          : (Math.abs(element.scrollTop - scrollTo) <= 1 ? 'at' : `stopped at ${element.scrollTop}`))), [scroll, pane]);
    for (const offset of offsets) {
      expect(['0,0', 'end', 'at'], `every pane is where the capture expects it (${scroll})`).toContain(offset);
    }
    const shot = await stableShot(page, join(captures, file), masks);
    captured.push(file);
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
    const result = compare(baseline, current, RENDER_TOLERANCE);
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
  // Every extension starts off (KI7MT, 2026-10-23). The screens are of an
  // operator who has turned on the launch row, pinned in that order, so the
  // built-in extensions' pages are in the captures.
  await mkdir(join(directory, 'chromium'), { recursive: true });
  await writeFile(join(directory, 'chromium', 'settings.json'), JSON.stringify({
    extensionsOn: ['conditions', 'astro', 'pota', 'adif-lookup'],
    pins: ['conditions/conditions', 'astro/astro', 'pota/parks', 'adif-lookup/lookup']
  }));
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
      QG_DESKTOP_NO_WELCOME: '1', QG_DESKTOP_PROFILE_DIR: join(directory, 'profile'),
      QG_DESKTOP_USER_DATA_DIR: join(directory, 'chromium'),
      QG_DESKTOP_LOG_DIR: logs,
      // Recorded NOAA responses, so Conditions draws the same every run and
      // nothing depends on NOAA answering (source-fixtures.ts).
      QG_DESKTOP_SOURCE_FIXTURES: resolve('tests/fixtures/noaa/quiet')
    },
    timeout: 30_000
  });
  const page = await application.firstWindow();
  await assertNoVisibleWindow(application, page, 'screenshots');
  // The application opens on Home now (QGD-FRM-0011). Callsigns is a click away.
  await page.getByRole('navigation', { name: 'Sections' })
    .getByRole('button', { name: 'Callsigns', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Add a callsign' })).toBeVisible();
  await page.setViewportSize(VIEW);

  // The one thing on these pages that moves. A blinking caret is two pixels
  // that differ every other frame, which no amount of waiting settles — and it
  // is not part of the design being baselined. Inserted through the CSSOM
  // because QGD-SEC-0008 forbids an inline style and CSP does not reach the
  // CSSOM. The only other change is the fixed widths of masked values, below.
  await page.evaluate(() => {
    const sheet = document.styleSheets[0];
    sheet.insertRule('*, *::before, *::after { caret-color: transparent !important; }', sheet.cssRules.length);
    // A mask is the box of the value it covers, and a value whose text varies
    // (a temporary folder, a size, a time in a proportional font) varies the
    // box, so the edge of the grey moved by a few pixels between two runs and
    // the comparison failed for nothing. Each masked value gets a fixed width
    // for the capture; what is under the mask is not compared anyway.
    sheet.insertRule('#storage-folder, #log-directory { display: inline-block; width: 40ch; overflow: hidden; white-space: nowrap; vertical-align: bottom; }', sheet.cssRules.length);
    sheet.insertRule('.storage-size { display: inline-block; width: 8ch; overflow: hidden; white-space: nowrap; vertical-align: bottom; }', sheet.cssRules.length);
    sheet.insertRule('#page-observed, .figure-time { display: inline-block; width: 16ch; overflow: hidden; white-space: nowrap; }', sheet.cssRules.length);
  });

  // The callsign broker owns a utility process that starts after the window
  // does. Filling the form before it answers means the create request is sent
  // to something that is not there yet — which is why this suite failed to
  // create a callsign on roughly one run in five while the application was
  // perfectly healthy. scripts/smoke.mjs has always waited; these did not.
  await expect.poll(() => page.evaluate(() => window.callsigns.request({ type: 'list' }).then(reply => reply.ok)),
    { message: 'the callsign service must be answering before the form is used', timeout: 30_000 }).toBe(true);
  await page.getByLabel('Description', { exact: true }).fill(FIXTURE.description);
  await page.getByLabel('Callsign', { exact: true }).fill(FIXTURE.call);
  await page.getByLabel('Start date', { exact: true }).fill(FIXTURE.start);
  await page.getByRole('button', { name: 'Add callsign', exact: true }).click();
  // The callsign round-trips through the Rust core. Five seconds is Playwright's
  // default and it is not enough on a machine that is busy — this assertion
  // failed twice that way while the application was behaving correctly.
  await expect(page.getByRole('heading', { name: FIXTURE.call, exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Use this callsign', exact: true }).click();
  await expect(page.locator('#active-callsign')).toContainText(`Callsign: ${FIXTURE.call}`);
  // The status line is a line of text in the baseline, and it was the last
  // thing moving between runs. app.ts retries its first callsign list for up to
  // two and a half seconds, and when that finally lands it selects the active
  // callsign, which clears the line — so whether the message was still there at
  // capture time depended on which finished first.
  //
  // Converged on deliberately rather than raced: selecting the callsign clears
  // the line, and so does the late startup list, so both orderings end in the
  // same state and the baseline shows a page at rest.
  await page.locator('.callsign-item').first().click();
  await expect(page.locator('#message')).toHaveText('');

  const rail = name => page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name, exact: true });

  // Settings' reference rows settle once storage answers. Nothing is fetched
  // at start, so in this run each says "Not downloaded"; that is waited for,
  // and then it is compared like any text.
  await rail('Settings').click();
  await expect.poll(() => page.locator('.reference-state').allInnerTexts(),
    { message: 'Settings must say what reference data is downloaded before anything is captured', timeout: 60_000 })
    .toEqual(['Not downloaded', 'Not downloaded']);

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
      // with it the precondition. P8 brought two more answers, Home's pins
      // and Settings' extension switch, and both are waited for below.
      if (name === 'Home') await expect(page.locator('.pin-tile', { hasText: 'Conditions' })).toBeVisible({ timeout: 30_000 });
      if (name === 'Settings') await expect(page.getByRole('switch', { name: /^Conditions/ })).toBeVisible({ timeout: 30_000 });
      await record(page, `${name.toLowerCase()}-${theme}.png`, theme);
      // Home and Callsigns run past the first screen; what is below it is
      // captured too (the credentials and
      // export). Settings' end is its own capture below.
      if (name !== 'Settings') await recordScreens(page, name.toLowerCase(), theme, record);
    }

    // Conditions' page, opened from its pin (KI7MT, 2026-10-22): the data
    // that used to be on Home, drawn by the core from the Conditions extension's answer.
    await rail('Home').click();
    await page.locator('.pin-tile', { hasText: 'Conditions' }).click();
    await expect(page.locator('section.page-body')).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 });
    await page.evaluate(() => { const focused = document.activeElement; if (focused && 'blur' in focused) focused.blur(); });
    await record(page, `conditions-${theme}.png`, theme);
    await recordScreens(page, 'conditions', theme, record);

    // Settings' last card, Extensions, is below the fold: Playwright calls the
    // switch visible there, but no capture from the top contains it. Captured
    // scrolled to the end, and the switch proven to be inside the frame.
    await rail('Settings').click();
    await record(page, `settings-extensions-${theme}.png`, theme, VOLATILE, { scroll: 'end' });
    const switchBox = await page.getByRole('switch', { name: /^Conditions/ }).boundingBox();
    expect(switchBox && switchBox.y >= 0 && switchBox.y + switchBox.height <= VIEW.height,
      'the Conditions switch must be inside the settings-extensions capture').toBe(true);

    // "Customize your pins" (QGD-HOM-0003), opened over Home and cancelled.
    await rail('Home').click();
    await page.locator('#customize-pins').click();
    await expect(page.getByRole('dialog', { name: 'Customize your pins' })).toBeVisible();
    await page.evaluate(() => { const focused = document.activeElement; if (focused && 'blur' in focused) focused.blur(); });
    await recordOverHome(page, `pins-${theme}.png`, theme);
    await page.getByRole('dialog', { name: 'Customize your pins' }).getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog', { name: 'Customize your pins' })).toBeHidden();

    // Troubleshooting, opened from the status bar rather than navigated to.
    //
    // Captured because it is where the logs, the level switch and the support
    // bundle live now (QGD-LOG-0013) and where storage's detail is
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
    // And storage's own answer: Ready, with its sections drawn.
    await expect.poll(() => page.getByLabel('State', { exact: true }).inputValue(), { timeout: 60_000 }).toBe('Ready');
    await expect.poll(() => page.locator('#reference-datasets').innerText(), { timeout: 60_000 }).toMatch(/not loaded/);
    await recordOverHome(page, `troubleshooting-${theme}.png`, theme);
    // The panel scrolls on its own, and the Logs card is below its fold.
    await recordScreens(page, 'troubleshooting', theme, (p, file, t, masks, options) => recordOverHome(p, file, t, options), '#troubleshooting');
    await page.locator('#close-troubleshooting').click();
    await expect(page.locator('#troubleshooting')).toHaveCount(0);
  }

  // Stations with stations in them (P9-screens): the list, the editor, a
  // portable station at a park, and Home with a station active. Made after
  // every capture above, so those show a profile with none. Saved through
  // storage directly, as the stations suite proves the page saves them.
  const save = station => page.evaluate(draft => window.storage.request({ type: 'save-station', station: draft }), station);
  // The fixture's callsign is W1AW, so its default is W1AW's own station:
  // the Hiram Percy Maxim Memorial Station at ARRL headquarters in Newington,
  // Connecticut (KI7MT, 2026-10-22). No street address: the screens need none.
  const HQ = 'Hiram Percy Maxim Memorial Station';
  const home = await save({ name: HQ, kind: 'Home', place: {
    MY_GRIDSQUARE: 'FN31pr', MY_LAT: 'N041 42.882', MY_LON: 'W072 43.632', MY_DXCC: '291', MY_STATE: 'CT',
    MY_CNTY: 'CT,Hartford', MY_CQ_ZONE: '5', MY_ITU_ZONE: '8', MY_ARRL_SECT: 'CT' } });
  expect(home, 'W1AW\'s station must save').toMatchObject({ ok: true });
  expect(await save({ name: 'US-0001 Example Park', kind: 'Portable', place: {
    MY_POTA_REF: 'US-0001', MY_GRIDSQUARE: 'DN13sp', MY_DXCC: '291', MY_STATE: 'ID' } }), 'the park station must save').toMatchObject({ ok: true });
  expect(await save({ name: 'Car', kind: 'Mobile', place: { MY_GRIDSQUARE: 'DN14' } }), 'the Car station must save').toMatchObject({ ok: true });
  expect(await page.evaluate(async id => {
    const list = await window.callsigns.request({ type: 'list' });
    return window.storage.request({ type: 'set-default-station', callsign: list.data.active, id });
  }, home.saved))
    .toMatchObject({ ok: true });
  expect(await page.evaluate(id => window.storage.request({ type: 'set-active-station', id }), home.saved)).toMatchObject({ ok: true });
  await expect(page.locator('#active-station')).toHaveText(`Location: ${HQ} · FN31pr`, { timeout: 30_000 });
  const blur = () => page.evaluate(() => { const focused = document.activeElement; if (focused && 'blur' in focused) focused.blur(); });

  for (const theme of THEMES) {
    await rail('Settings').click();
    await page.getByLabel('Theme', { exact: true }).selectOption(theme);
    await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe(theme);

    await rail('Locations').click();
    await expect(page.locator('li.station-row')).toHaveCount(3, { timeout: 30_000 });
    await blur();
    await record(page, `stations-list-${theme}.png`, theme);

    await page.getByRole('button', { name: `Edit ${HQ}`, exact: true }).click();
    await expect(page.locator('#station-name')).toHaveValue(HQ);
    await blur();
    await record(page, `station-editor-${theme}.png`, theme);
    await recordScreens(page, 'station-editor', theme, record);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();

    await page.getByRole('button', { name: 'Edit US-0001 Example Park', exact: true }).click();
    await expect(page.locator('#station-my-pota-ref')).toHaveValue('US-0001');
    await blur();
    await record(page, `station-park-${theme}.png`, theme);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();

    // Home with a location active: the status bar names it with its grid.
    await rail('Home').click();
    await expect(page.locator('.pin-tile', { hasText: 'Conditions' })).toBeVisible({ timeout: 30_000 });
    await blur();
    await record(page, `home-station-${theme}.png`, theme);
  }

  // A baseline no capture produces any more is a picture of a screen that is
  // gone, still counted as approved. Home's scrolled end was one: it stopped
  // being captured when Home fit on one screen, and nothing said so.
  const orphans = (await readdir(baselines)).filter(file => file.endsWith('.png') && !captured.includes(file)).sort();
  for (const file of orphans) {
    failures.push(`${file}: a baseline nothing captures any more. Remove it and record it as retired in data/baseline-approval.json`);
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
    // Counted from what was captured, not from a list of pages: the pages now
    // run to several captures each, and the fixed count said 8 when it was 20.
    console.log(`Screenshots: ${captured.length} baselines match, within ${RENDER_TOLERANCE} shades per colour: PASS`);
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
