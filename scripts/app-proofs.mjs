// SPDX-License-Identifier: GPL-3.0-only
// P7's exit gate, walked in the real application (QGD-APP-0014).
//
// "An app without a grant is refused; proven by a no-credential app (solar)
// and a granted one (QRZ lookup); and by a test application that uses the API
// and nothing else."
//
// Three applications, and the pairs are the proof:
//
// - the harness declared nothing, so it is refused every capability and
//   allowed only to read its own standing (QGD-APP-0005);
// - solar declared `source:solar`, which needs nobody's permission, so the
//   same fetch the harness is refused goes through for it;
// - qrz-lookup declared two grants that need the operator, so it is refused
//   until they are allowed, works once they are, and is refused again the
//   moment one is withdrawn — with no restart (QGD-APP-0012).
//
// **No part of this needs the internet.** The grant decision happens before a
// connection is attempted, so every assertion below is about what the frame
// allowed or refused. Where solar's fetch does reach NOAA, the only thing
// asserted is that it was not refused for want of a grant: a network failure
// and a refusal are different replies and only one of them is this gate's
// business.
import { _electron as electron, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { enableTestKeychain } from './keychain-service.mjs';
import { accountsUnder, KEYCHAIN_SERVICE } from './keychain-service.mjs';

// Fixtures go to this product's test Keychain service and are swept on exit
// (QGD-CRD-0013).
enableTestKeychain();

const directory = await mkdtemp(join(tmpdir(), 'qg-app-proofs-'));
const profile = join(directory, 'profile');
const userData = join(directory, 'userdata');
const logs = join(directory, 'logs');
await mkdir(userData, { recursive: true });
const persona = `qg-test-${randomUUID()}`;
const notes = [];
let application;

// What this product's real Keychain service held before the run, so the check
// at the end is "unchanged" rather than "empty".
const productionBefore = accountsUnder(KEYCHAIN_SERVICE).sort();

// A fourth application, planted for this run only: an `unofficial` tier, which
// this release refuses to load because the sandbox those tiers need is a later
// Part (QGD-APP-0004). It proves two things no valid manifest can — that the
// refusal happens before any of its code runs, and that the host mounts only
// what the frame accepted.
const REFUSED = 'refused-probe';
//
// Built in a temporary directory, never in the repository. An earlier version
// wrote into proofs/ and edited solar's own manifest for one launch, which a
// Ctrl-C would have left behind as an `unofficial` tier in a tracked file —
// and the next run would have read that as the original and kept failing.
// Found in review. QG_DESKTOP_APP_DIRS points the frame here instead, so
// nothing tracked is touched by any path through this suite.
const manifests = join(directory, 'manifests');
async function plantManifests(options = {}) {
  await rm(manifests, { recursive: true, force: true });
  for (const name of ['harness', 'solar', 'qrz-lookup']) {
    const manifest = JSON.parse(await readFile(join('proofs', name, 'manifest.json'), 'utf8'));
    if (options.unofficial === name) manifest.tier = 'unofficial';
    await mkdir(join(manifests, name), { recursive: true });
    await writeFile(join(manifests, name, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  }
  // The planted fourth: refused for its tier, and with no component of its own.
  await mkdir(join(manifests, REFUSED), { recursive: true });
  await writeFile(join(manifests, REFUSED, 'manifest.json'), JSON.stringify({
    id: REFUSED, name: 'Refused on purpose', tier: 'unofficial',
    version: '1.0.0', grants: [], page: 'Nothing.svelte'
  }, null, 2) + '\n');
}
await plantManifests();

// The proofs are absent from an ordinary build, so this suite builds them in.
// It is the only thing that does (QGD-APP-0014.1).
const built = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], {
  encoding: 'utf8',
  env: { ...process.env, QG_DESKTOP_PROOFS: '1' }
});
if (built.status !== 0) {
  console.error('The proofs build failed.');
  console.error((built.stderr || built.stdout || '').split('\n').slice(0, 12).join('\n'));
  process.exit(1);
}

// Retrying, not a single read.
//
// tryEverything awaits each request in turn, so reading a later attempt's
// verdict the instant the first one appears can see "not asked yet" — which
// would fail make verify on a slow machine while the grant model was behaving
// perfectly. Found in review. toHaveText polls; innerText does not.
const expectVerdict = (page, label, verdict) =>
  expect(page.locator('#harness-attempts li', { hasText: label }).locator('.verdict'))
    .toHaveText(verdict, { timeout: 15_000 });
const detailOf = async (page, label) =>
  page.locator('#harness-attempts li', { hasText: label }).locator('.detail').innerText();

try {
  application = await electron.launch({
    args: ['.'], cwd: process.cwd(),
    env: {
      ...process.env,
      QG_DESKTOP_PROFILE_DIR: profile,
      QG_DESKTOP_USER_DATA_DIR: userData,
      QG_DESKTOP_LOG_DIR: logs,
      QG_DESKTOP_APP_DIRS: manifests,
      // The app API needs no database, and the gate should not wait for one.
      QG_DESKTOP_ENGINE_OFF: '1'
    },
    timeout: 30_000
  });
  const page = await application.firstWindow();

  // A persona to act as, made first.
  //
  // This used to happen after the solar fetch, and the suite failed about two
  // runs in seven — both times, as far as the evidence goes, on runs where
  // NOAA did not answer. `core.fetchReference` is a synchronous napi call on
  // the persona service, so a slow fetch blocks every persona command behind
  // it; the create came back with nothing said and no persona made. That
  // coupling is not what this gate is for, so it is gone from the order
  // rather than waited out. The blocking fetch itself is recorded in
  // docs/P7.md as an open observation, because it is older than P7 and this
  // suite only happened to find it.
  await page.getByRole('navigation', { name: 'Sections' })
    .getByRole('button', { name: 'Personas', exact: true }).click();
  // By id, not by label: every page stays mounted, so "Callsign" matches both
  // the Personas form and the lookup application's own field.
  // Waited for the persona SERVICE, not for the form.
  //
  // This is what the intermittent failure actually was, and the log said so in
  // the end: "applications loaded" at 02:07:01.724, the lookup refused at
  // .878, and "persona service started" at 02:07:02.178 — after. The service
  // starts on first use, and a create issued during that window went nowhere
  // with nothing said, leaving the first-run offer on screen.
  //
  // Waiting for the form was no help: its markup is drawn before the service
  // exists. The precondition is the service answering, which is what
  // packaged-smoke.mjs already waits for in the same situation.
  await expect.poll(
    () => page.evaluate(() => window.personas.request({ type: 'list' }).then(reply => reply.ok, () => false)),
    { message: 'the persona service must be answering before a persona is created', timeout: 30_000 }
  ).toBe(true);
  await expect(page.getByRole('heading', { name: 'Create a persona' })).toBeVisible({ timeout: 15_000 });
  await page.locator('#persona-name').fill(persona);
  await page.locator('#callsign').fill('W1AW');
  await expect(page.locator('#persona-name')).toHaveValue(persona);
  await expect(page.locator('#callsign')).toHaveValue('W1AW');
  await page.getByRole('button', { name: 'Create persona', exact: true }).click();
  try {
    // 35s, longer than the broker's own 30s wait on the persona service.
    //
    // Deliberate, and the reason is the failure this caught. The broker waits
    // up to 30s for the service and then answers in the product's own words
    // ("Keychain did not respond..."), which #message shows. At 15s the gate
    // gave up first, so a slow create failed with the screen still blank and
    // #message empty — a race between two timeouts, reported as a product
    // fault. Waiting past the broker's means the product always speaks first,
    // so a failure here is the product failing and the diagnostic below has
    // its words to quote. Found in review.
    await expect(page.getByRole('heading', { name: 'W1AW', exact: true })).toBeVisible({ timeout: 35_000 });
  } catch (error) {
    // The product's own words, which say what happened where a locator timeout
    // cannot. This creation has failed intermittently — about two runs in
    // seven — and the suspicion is the persona service: the solar fetch above
    // goes through it, and a create that queues behind a slow one can time out
    // in the broker. Captured rather than guessed at.
    const message = await page.locator('#message').innerText().catch(() => '(no #message)');
    // #page-title, because it IS the element the assertion is about: it reads
    // "Create a persona" before a create and the callsign after one. An
    // earlier diagnostic dumped h2 only, and #page-title is an h1 — so the one
    // failure this caught could not be told apart from a create that silently
    // did nothing. Read into a variable here, never interpolated unread: a
    // diagnostic that throws a ReferenceError discards the very failure it
    // exists to explain, which is worse than no diagnostic. Found in review.
    const pageTitle = await page.locator('#page-title').innerText().catch(() => '(no #page-title)');
    const titles = (await page.locator('h1, h2, h3').allInnerTexts()).join(' | ');
    // What the persona service itself said. The suspicion is that a reference
    // fetch through it — solar's — leaves a later persona command unanswered,
    // and the broker's own log is the only place that would show it.
    let service = '(no log)';
    try {
      const { readdir, readFile: read } = await import('node:fs/promises');
      const names = await readdir(logs);
      const lines = [];
      for (const name of names) {
        for (const line of (await read(join(logs, name), 'utf8')).split('\n')) {
          if (/persona|apps|upsert|restart/i.test(line)) lines.push(line.slice(0, 220));
        }
      }
      service = lines.slice(-12).join('\n    ');
    } catch { /* the log is diagnostic; its absence is not the failure */ }
    throw new Error(
      `${error.message}\n  #page-title was: ${JSON.stringify(pageTitle)}\n  #message was: ${message}\n  headings were: ${titles}\n  log said:\n    ${service}`);
  }


  // The rail offers Apps only in a proofs build, which is itself part of
  // QGD-APP-0014.1: a release has no such entry.
  await page.getByRole('navigation', { name: 'Sections' })
    .getByRole('button', { name: 'Apps', exact: true }).click();
  await expect(page.locator('#app-proofs')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'App API harness' })).toBeVisible();
  notes.push('the three proof applications loaded from their manifests and are on screen');

  // The planted unofficial manifest: refused, named, and nothing of it mounted.
  await expect(page.locator('#app-proofs-refused')).toContainText(REFUSED);
  const why = await page.locator('#app-proofs-refused').innerText();
  expect(why, 'the refusal must say the tier is the reason').toContain('unofficial');
  expect(why).toContain('sandbox');
  expect(await page.getByText('Refused on purpose').count(),
    'a refused application must not be mounted at all').toBe(0);
  notes.push('an unofficial manifest is refused before its code runs, and the host mounts nothing of it');

  // ---------------------------------------------------------------------
  // The harness: declared nothing, so it holds nothing.
  await expect(page.locator('#harness-standing')).toContainText('holding no grants');
  await page.getByRole('button', { name: 'Try every capability' }).click();

  await expectVerdict(page, 'Know my own standing', 'allowed');
  notes.push('an application holding nothing may still read its own standing');

  // Every other capability refused, each naming what was asked for.
  for (const [label, capability] of [
    ['List the personas', 'persona:list'],
    ['Fetch the space-weather source', 'source:solar'],
    ['Look a callsign up with the QRZ credential', 'service:qrz']
  ]) {
    await expectVerdict(page, label, 'refused');
    const detail = await detailOf(page, label);
    expect(detail, `the refusal of ${label} must name ${capability}`).toContain(capability);
    // QGD-APP-0011: the application is named too, so an operator reading this
    // knows who asked.
    expect(detail, 'the refusal must name the application').toContain('App API harness');
    // And it says the grant was never declared, which is the unfixable case —
    // distinct from one the operator could allow (QGD-APP-0005).
    expect(detail).toContain('did not declare');
  }
  notes.push('every capability it did not declare is refused, each naming the application and the grant');

  // A capability that does not exist is reported as missing, not unallowed.
  await expectVerdict(page, 'Fetch a source nobody registered', 'refused');
  const invented = await detailOf(page, 'Fetch a source nobody registered');
  expect(invented).toContain('not a capability this product has');
  notes.push('a source nobody registered is reported as absent rather than as a grant to go and allow');

  // ---------------------------------------------------------------------
  // QRZ lookup: refused, allowed, refused again.
  await expect(page.locator('#lookup-no-personas')).toBeVisible();
  notes.push('qrz-lookup is refused the persona list on a fresh profile, having been allowed nothing');

  // The operator allows the two grants. Through the settings channel, which is
  // the path a Settings page would use (QGD-APP-0012).
  const allow = async grants => page.evaluate(
    value => window.settings.request({ type: 'write', key: 'grants', value }),
    { 'qrz-lookup': grants });
  expect(await allow(['persona:list', 'service:qrz'])).toMatchObject({ ok: true });

  await page.getByRole('navigation', { name: 'Sections' })
    .getByRole('button', { name: 'Apps', exact: true }).click();
  // Asked again in the page, not reloaded. An earlier version of this called
  // page.reload() here, which was the suite working around a defect rather
  // than testing anything: the application could not recover from its first
  // refusal because Shell keeps every page mounted and the list was read once
  // at construction.
  await page.locator('#lookup-refresh').click();
  await expect(page.locator('#lookup-persona')).toBeVisible({ timeout: 15_000 });
  notes.push('allowing persona:list lets it offer the personas on asking again, with no reload of the window');

  await page.locator('#lookup-callsign').fill('W1AW');
  await page.getByRole('button', { name: 'Look up' }).click();
  await expect(page.locator('#lookup-problem, #lookup-fields')).toBeVisible({ timeout: 30_000 });
  const granted = await page.locator('#lookup-problem').count() === 0
    ? ''
    : await page.locator('#lookup-problem').innerText();
  // Allowed, so not a refusal. There is no QRZ credential saved, so the
  // honest answer is that one is missing — which is the frame having acted
  // with a credential it does not have, not a grant problem.
  // The specific outcome, not merely the absence of a refusal.
  //
  // This asserted only that the message did not contain "service:qrz", which
  // passed on any other failure — an unsupported operation, a malformed
  // service command, a serviceLookup port that was never wired. The withdrawal
  // check below runs before that port, so the suite could report PASS without
  // a working granted lookup ever happening. Caught in review.
  //
  // The persona was created moments ago and has no QRZ credential, so the one
  // right answer is that one is missing: the frame reached the credential core
  // with the grant, and the core found nothing to act with.
  expect(granted, 'the granted lookup must reach the core and report a missing credential')
    .toContain('No QRZ credential is saved');
  notes.push('with the grant allowed the lookup reaches the credential core, which reports no credential saved');

  // Withdrawn. The same call, refused, without restarting anything.
  expect(await allow(['persona:list'])).toMatchObject({ ok: true });
  await page.getByRole('button', { name: 'Look up' }).click();
  await expect(page.locator('#lookup-problem')).toContainText('service:qrz', { timeout: 15_000 });
  const withdrawn = await page.locator('#lookup-problem').innerText();
  expect(withdrawn).toContain('Callsign lookup');
  // The fixable case, worded differently from the undeclared one.
  expect(withdrawn).toContain('has not been allowed');
  notes.push('withdrawing service:qrz refuses the same call immediately, with no restart');

  // And the persona list still works, so the withdrawal took only what it named.
  await expect(page.locator('#lookup-persona')).toBeVisible();
  notes.push('the grant that was left alone still works, so a withdrawal removes only what it names');

  // ---------------------------------------------------------------------
  // Solar: the same fetch, declared, and so not refused.
  //
  // Last, and waiting past the core rather than racing it. Both for one
  // reason: `core.fetchReference` is a synchronous napi call on the persona
  // service with a 120s ceiling (reference.rs), so a slow NOAA blocks every
  // persona command behind it.
  //
  // Run earlier, that stalled the QRZ steps' persona work and failed the gate
  // on upstream latency while the grant model was behaving perfectly — the
  // coupling recorded in docs/P7.md, which reordering the persona create did
  // not escape because this step was still ahead of them. Nothing follows it
  // now, so a blocked worker has nothing left to block. And the wait is 150s,
  // past the core's own 120s, so the product always answers first and a
  // failure here is the product failing rather than two timeouts racing.
  // Found in review.
  await page.getByRole('button', { name: 'Fetch the latest indices' }).click();
  await expect(page.locator('#solar-table, #solar-problem')).toBeVisible({ timeout: 150_000 });
  const solarProblem = await page.locator('#solar-problem').count() === 0
    ? ''
    : await page.locator('#solar-problem').innerText();
  // Not a grant refusal, and — if it did not succeed — a failure that came
  // from the core.
  //
  // "Not refused" alone was a gate that could not fail: replace fetchSource
  // with a stub throwing "not implemented" and SolarPage shows that, which
  // contains no grant id, so the exit gate reported success while nothing was
  // fetched through anything. Offline tolerance is not tolerance of arbitrary
  // breakage. Found in review.
  //
  // So the accepted failures are enumerated, and they are the core's own
  // words (packages/persona-core/src/reference.rs) plus the page's own "it
  // answered with nothing I can read". Each means the request reached the
  // core and the core reached the network; any other message — a stub, a
  // disconnected port, the broker answering the wrong shape — is outside the
  // set and fails. `Reference data is fetched over HTTPS only.` is
  // deliberately NOT accepted: that is a register defect, not an upstream one.
  const CORE_UPSTREAM = [
    'The reference source could not be reached.',
    'The reference source refused the request.',
    'The reference source could not be read.',
    'The reference source sent more than this product will read.',
    'The source answered, and held nothing this page could read.'
    // Deliberately NOT accepted: 'The reference source did not answer in
    // time.', the broker's own 135s deadline. I added it here as an upstream
    // condition and it is not one — the core bounds its own request at 120s
    // and answers in words, so the broker's deadline is reached only when the
    // core never answered at all: a wedged worker or a dropped reply. Accepting
    // it would have let this gate pass on exactly the broken delivery it is
    // supposed to catch. Found in review.
  ];
  expect(solarProblem, 'solar declared source:solar and must not be refused it').not.toContain('source:solar');
  if (solarProblem !== '') {
    expect(CORE_UPSTREAM, `solar failed with words the core does not use: ${JSON.stringify(solarProblem)}`)
      .toContain(solarProblem.trim());
  }
  const reached = solarProblem === '';
  notes.push(reached
    ? 'solar, declaring one grant and no credential, fetched through the core and drew its table'
    : 'solar was allowed its fetch; the source itself did not answer, which is not a grant refusal');

  // ---------------------------------------------------------------------
  // Nothing of the operator's was touched.
  await application.close();
  application = undefined;
  // Compared against what was there before the run, not against empty.
  //
  // Requiring the production service to hold nothing meant `make verify` could
  // not pass on a machine where the operator actually uses the application —
  // which is every machine, once KI7MT recreates his personas. Found in
  // review.
  expect(accountsUnder(KEYCHAIN_SERVICE).sort(),
    'the run must leave this product’s real Keychain service exactly as it found it')
    .toEqual(productionBefore);
  notes.push(productionBefore.length === 0
    ? 'the run left nothing in the real Keychain service'
    : `the real Keychain service is unchanged: the same ${productionBefore.length} entr(ies) as before the run`);

  // ---------------------------------------------------------------------
  // The refusal, with an application the host really does mount.
  //
  // The planted `refused-probe` proves the frame refuses a manifest, but it
  // has no component and no branch in AppsPage, so "not mounted" was true of
  // it however the host behaved — a vacuous assertion. Found in review.
  //
  // So solar's own manifest is made unofficial for one launch. If the host
  // stopped gating on what loaded, SolarPage would mount and its heading would
  // be on screen; the control for this control is the main walk above, where
  // the valid manifest puts it there.
  await plantManifests({ unofficial: 'solar' });
  const second = await mkdtemp(join(tmpdir(), 'qg-app-proofs-refused-'));
  try {
    application = await electron.launch({
      args: ['.'], cwd: process.cwd(),
      env: {
        ...process.env,
        QG_DESKTOP_PROFILE_DIR: join(second, 'profile'),
        QG_DESKTOP_USER_DATA_DIR: join(second, 'userdata'),
        QG_DESKTOP_LOG_DIR: join(second, 'logs'),
        QG_DESKTOP_APP_DIRS: manifests,
        QG_DESKTOP_ENGINE_OFF: '1'
      },
      timeout: 30_000
    });
    const refusedPage = await application.firstWindow();
    await refusedPage.getByRole('navigation', { name: 'Sections' })
      .getByRole('button', { name: 'Apps', exact: true }).click();
    // The harness still loads, so the host is working and this is not a page
    // that simply failed to render.
    await expect(refusedPage.getByRole('heading', { name: 'App API harness' }))
      .toBeVisible({ timeout: 15_000 });
    await expect(refusedPage.locator('#app-proofs-refused')).toContainText('solar');
    // And nothing of solar: not its heading, not its button, not its markup.
    expect(await refusedPage.getByRole('heading', { name: 'Space weather' }).count(),
      'a refused application must not be mounted').toBe(0);
    expect(await refusedPage.getByRole('button', { name: 'Fetch the latest indices' }).count(),
      'nor any of its controls').toBe(0);
    expect(await refusedPage.locator('#solar-table, #solar-problem, #solar-note').count(),
      'nor anything its initialisation would have drawn').toBe(0);
    notes.push('refusing a real application leaves none of its markup on screen, while the others still load');
    await application.close();
    application = undefined;
  } finally {
    await rm(second, { recursive: true, force: true });
  }

  console.log(`App API proofs: ${notes.length} checks: PASS`);
  for (const note of notes) console.log(`  ${note}`);
} catch (error) {
  console.error('App API proofs failed.');
  // What had already passed, so a failure says where in the walk it happened
  // rather than only what the last assertion wanted.
  console.error(`  got as far as ${notes.length} check(s):`);
  for (const note of notes) console.error(`    ${note}`);
  console.error(String(error.message).split('\n').slice(0, 20).join('\n'));
  process.exitCode = 1;
} finally {
  await application?.close().catch(() => {});
  await rm(directory, { recursive: true, force: true });
  // Nothing to restore: every manifest this suite wrote is inside `directory`,
  // which goes with it.
}
