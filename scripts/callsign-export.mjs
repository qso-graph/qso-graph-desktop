// SPDX-License-Identifier: GPL-3.0-only
// P6-persona-owns-credential, P6-export-encrypted, P6-export-header,
// P6-export-round-trip, P6-import-all-or-none, P6-import-cannot-tell and
// P6-export-goes-nowhere (QGD-PSN-0001, QGD-PSN-0007 to QGD-PSN-0011).
//
// Against the real credential core and the real Keychain, because what is
// being proved is that callsigns and Locations go into one encrypted file and
// arrive in a second profile that had none, and that no secret does: the
// export reads none from the Keychain and the restore writes none to it
// (KI7MT, 2026-10-23: "Users still manage their credentials"). A round-trip
// through a mock proves nothing about the Keychain.
//
// Two profile directories stand in for two machines. They share one Keychain,
// which is this machine's, and a callsign keeps its id when it moves, so the
// first profile's entries are deleted before the restore: what is shown is
// that no login arrived, not that the Keychain lost one.
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { sentinelsIn } from './artifact-scan.mjs';
import { classify } from './endpoint.mjs';
import { enableTestKeychain } from './keychain-service.mjs';

// Fixtures go to this product's test Keychain service, never beside a real
// credential, and are swept on exit (QGD-CRD-0003). Called before the core is
// loaded, because the service name is read when an entry is made.
enableTestKeychain();

const require = createRequire(import.meta.url);
const { CallsignCore } = require('../dist/native/callsign.node');

const first = await mkdtemp(join(tmpdir(), 'qg-export-from-'));
const second = await mkdtemp(join(tmpdir(), 'qg-export-to-'));
// The callsigns' ids, which the core chooses, and the first one's description.
let id;
let alsoHere;
const description = `qg-test-${randomUUID()}`;
const password = `QG_FAKE_CREDENTIAL_${randomUUID()}`;
const apiKey = `QG_FAKE_CREDENTIAL_${randomUUID()}`;
const passphrase = `a passphrase ${randomUUID()}`;
const from = new CallsignCore(first);
const to = new CallsignCore(second);
const notes = [];

function check(ok, name) { if (!ok) throw new Error(`${name} failed; values omitted.`); }

// A refusal, taken without letting the message carry a value into the output.
function refusal(action, name) {
  try { action(); } catch (error) { return String(error.message); }
  throw new Error(`${name} was not refused.`);
}

try {
  // ---- a profile worth moving -----------------------------------------
  id = from.create('W1AW', description, '2026-01-01').id;
  from.saveCredentials(id, 'qrz', { username: 'W1AW', password });
  from.saveCredentials(id, 'clublog', { username: 'w1aw@example.invalid', password, apiKey });
  from.setPreference(id, 'clublog', 'api_key');
  alsoHere = from.create('W1AW/P', '').id;

  // ---- P6-persona-owns-credential --------------------------------------
  {
    // QGD-PSN-0001: a credential belongs to a callsign and a service, never to
    // the application. Two callsigns, one service, two different secrets —
    // and removing one leaves the other, which is the half that would be
    // missed by a store keyed on the service alone.
    const second = `QG_FAKE_CREDENTIAL_${randomUUID()}`;
    from.saveCredentials(alsoHere, 'qrz', { username: 'W1AW/P', password: second });
    check(from.requireCredential(id, 'qrz').password === password, 'The first callsign keeps its own');
    check(from.requireCredential(alsoHere, 'qrz').password === second, 'The second callsign has its own');
    from.deleteCredentials(alsoHere, 'qrz');
    check(!from.credentialStatus(alsoHere, 'qrz').stored, 'The second callsign\u2019s credential is gone');
    check(from.requireCredential(id, 'qrz').password === password,
      'And removing it left the first callsign\u2019s alone');
    notes.push('two callsigns hold separate secrets for one service, and removing one leaves the other');
  }

  // ---- P6-export-encrypted --------------------------------------------
  // The Locations go in with the callsigns, as QG Storage hands them over
  // (KI7MT, 2026-10-23); a street address is the value that must stay sealed.
  const street = `QG_FAKE_STREET_${randomUUID()}`;
  const locations = JSON.stringify({ stations: [{ id: randomUUID(), name: 'Home', place: { MY_GRIDSQUARE: 'DN13', MY_POTA_REF: street } }], defaults: {}, active: null });
  const file = from.exportCallsigns(passphrase, locations);
  check(Buffer.isBuffer(file) && file.length > 100, 'Export produced a file');

  // Every value that went in, searched for in the bytes that came out. The
  // sentinel scan is the same one make verify runs over every artifact, so a
  // credential in an export would be caught by the project's own rule as
  // well as by this.
  for (const secret of [password, apiKey, 'W1AW', description, 'w1aw@example.invalid', street]) {
    check(!file.includes(Buffer.from(secret)), 'Export holds no value in the clear');
  }
  check(sentinelsIn(file.toString('latin1')).length === 0, 'Export holds no credential sentinel');
  notes.push(`${file.length} bytes, holding none of the five values that went into it`);

  // QGD-PSN-0007: without a passphrase there is no file, rather than a file
  // anyone can read.
  for (const empty of ['', '   ']) {
    const message = refusal(() => from.exportCallsigns(empty, locations), 'An export with no passphrase');
    check(/passphrase/i.test(message), 'Refusal says a passphrase is needed');
  }
  notes.push('an export with no passphrase is refused rather than written in the clear');

  // ---- P6-export-header ------------------------------------------------
  const newline = file.indexOf(0x0a);
  const secondNewline = file.indexOf(0x0a, newline + 1);
  check(file.toString('utf8', 0, newline) === 'QGD-CALLSIGN-EXPORT', 'The file names itself');
  const header = JSON.parse(file.toString('utf8', newline + 1, secondNewline));
  check(header.version === 1, 'The header carries a version');
  check(header.cipher === 'AES-256-GCM', 'The header names its cipher');
  check(header.kdf === 'PBKDF2-HMAC-SHA256', 'The header names its KDF');
  check(Number.isInteger(header.iterations) && header.iterations >= 100_000, 'The header carries the KDF cost');
  check(/^[0-9a-f]{32}$/.test(header.salt), 'The header carries a 16-byte salt');
  check(/^[0-9a-f]{24}$/.test(header.nonce), 'The header carries a 12-byte nonce');
  check(typeof header.created === 'string' && header.created.length > 10, 'The header says when');
  notes.push(`the header names ${header.cipher}, ${header.kdf} at ${header.iterations.toLocaleString()} ` +
    'iterations, with its salt and nonce, in the clear');

  // Two exports of the same profile share nothing: a salt and a nonce that
  // repeated would be the defect that makes the second file readable from
  // the first.
  const again = from.exportCallsigns(passphrase, locations);
  const headerAgain = JSON.parse(again.toString('utf8', again.indexOf(0x0a) + 1, again.indexOf(0x0a, again.indexOf(0x0a) + 1)));
  check(headerAgain.salt !== header.salt, 'A second export draws a new salt');
  check(headerAgain.nonce !== header.nonce, 'A second export draws a new nonce');
  check(!again.subarray(secondNewline).equals(file.subarray(secondNewline)), 'A second export is different ciphertext');
  notes.push('a second export of the same profile shares neither its salt, its nonce, nor a byte of its ciphertext');

  // ---- P6-export-round-trip --------------------------------------------
  // The first machine's entries go, so only the file can bring them back.
  for (const service of ['qrz', 'clublog']) from.deleteCredentials(id, service);
  check(!from.credentialStatus(id, 'qrz').stored && !from.credentialStatus(id, 'clublog').stored,
    'The Keychain no longer holds what the file carries');
  const preview = to.inspectImport(file, passphrase);
  // No login travels (KI7MT, 2026-10-23: "Users still manage their
  // credentials"): the export read none, so the file holds none.
  check(preview.callsigns === 2 && preview.logins === 0, 'The preview counts the callsigns, and no login');
  check(preview.arriving.length === 2 && preview.here.length === 0, 'A clean machine has nothing to remove first');
  check(preview.locations === locations, 'The Locations come back as they went in, for QG Storage');
  check(!JSON.stringify(preview).includes(password), 'The preview carries no secret');

  const applied = to.applyImport(file, passphrase, false);
  check(applied.callsigns === 2 && applied.locations === locations, 'The restore reports what it did');
  const ids = to.list().map(entry => entry.id);
  check(ids.includes(id) && ids.includes(alsoHere), 'Both callsigns arrived, with their ids');
  const arrived = to.list().find(entry => entry.id === id);
  check(arrived.call === 'W1AW' && arrived.description === description && arrived.start === '2026-01-01',
    'The callsign arrived whole');

  // The services arrived, and no secret did: each is there to have its login
  // entered, under the same id, so the Keychain name is the first machine's.
  check(to.credentialStatus(id, 'clublog').preferred === 'api_key', 'The service preference arrived');
  const status = to.credentialStatus(id, 'qrz');
  check(!status.stored, 'No login arrived: none is in the Keychain');
  refusal(() => to.requireCredential(id, 'qrz'), 'A login that was not restored');
  notes.push('two callsigns and a service preference arrive in a profile that had none, with their ids, and no login: none is in the file or the Keychain');

  // ---- P6-import-all-or-none ------------------------------------------
  {
    // A clean slate, never a merge (KI7MT, 2026-10-23): a machine that has
    // callsigns is told which, and a restore is refused until the operator
    // says to remove them first; then they go, and the file's arrive.
    const second = to.inspectImport(file, passphrase);
    check(second.here.length === 2, 'A restore onto a machine that has callsigns names them');
    refusal(() => to.applyImport(file, passphrase, false), 'A restore onto callsigns not said to be removed');
    check(to.list().length === 2, 'And it changed nothing');
    const replaced = to.applyImport(file, passphrase, true);
    check(replaced.callsigns === 2 && to.list().length === 2, 'Said to remove them first, the restore replaces them');
    notes.push('a restore onto a machine with callsigns names them, refuses until told to remove them, then replaces them');

    // A file that fails its tag changes nothing at all.
    const before = JSON.stringify(to.list());
    const altered = Buffer.from(file);
    altered[altered.length - 1] ^= 0x01;
    refusal(() => to.applyImport(altered, passphrase, true), 'An altered file');
    check(JSON.stringify(to.list()) === before, 'A refused import changed nothing');

    // And so does a file that is not an export at all.
    refusal(() => to.applyImport(Buffer.from('hello'), passphrase, true), 'A file that is not an export');
    check(JSON.stringify(to.list()) === before, 'A file that is not an export changed nothing');
    notes.push('a file that fails its tag, and a file that is not an export, each change nothing');
  }

  // ---- P6-import-cannot-tell ------------------------------------------
  {
    // QGD-PSN-0010. An AEAD tag fails identically for both, so the product
    // says so rather than guessing — and the two messages have to be the
    // same message, not two messages that happen to agree today.
    const altered = Buffer.from(file);
    altered[altered.length - 1] ^= 0x01;
    const wrongPassphrase = refusal(() => to.inspectImport(file, 'not the passphrase'), 'A wrong passphrase');
    const alteredFile = refusal(() => to.inspectImport(altered, passphrase), 'An altered file');
    check(wrongPassphrase === alteredFile, 'The two refusals are the same message');
    check(/may be the wrong passphrase/.test(wrongPassphrase), 'It says it may be the passphrase');
    check(/may have been altered/.test(wrongPassphrase), 'And that it may be the file');
    // A message claiming to know which would be a guess presented as a fact.
    check(!/^The passphrase is wrong/.test(wrongPassphrase), 'It does not claim the passphrase is wrong');
    check(!/corrupt/i.test(wrongPassphrase), 'It does not claim the file is corrupt');
    notes.push('a wrong passphrase and an altered file give one message, which says it may be either');
  }

  // ---- the header is part of the file, not a label on it ---------------
  {
    const text = file.toString('latin1');
    const edited = Buffer.from(
      text.replace(`"iterations":${header.iterations}`, '"iterations":1000'), 'latin1');
    check(!edited.equals(file), 'The header edit changed the file');
    const message = refusal(() => to.inspectImport(edited, passphrase), 'A file with an edited header');
    check(/may be the wrong passphrase/.test(message), 'An edited header fails the same tag');
    notes.push('lowering the iteration count in the header fails the same tag the ciphertext does');
  }

  // ---- P6-export-goes-nowhere ------------------------------------------
  {
    // QGD-PSN-0011. The credential core can reach the network — it tests
    // credentials — so "an export sends nothing" is a claim about this path,
    // and it is read off the process rather than argued.
    //
    // The reading is taken by another process. The core's export is a
    // synchronous call into Rust: it blocks this thread, so a timer here
    // cannot fire until it has returned, and a socket opened and closed
    // inside the call would never be seen. That is the socket worth catching.
    const sampler = spawn(process.execPath,
      // netstat takes longer per reading than lsof, so Windows samples for longer
      // to read this process as many times.
      [resolve('scripts/socket-sampler.mjs'), String(process.pid), process.platform === 'win32' ? '8000' : '1500'],
      { stdio: ['ignore', 'pipe', 'ignore'] });
    let output = '';
    sampler.stdout.on('data', chunk => { output += chunk; });
    // Nothing is opened until the sampler has taken its first reading.
    const watching = Date.now() + 30_000;
    while (!output.startsWith('watching\n')) {
      if (Date.now() > watching || sampler.exitCode !== null) throw new Error('The sampler never started watching this process');
      await new Promise(done => setTimeout(done, 20));
    }

    // The positive control: a socket opened on purpose, while the sampler is
    // watching, has to appear in what it saw. Without it, an empty list means
    // nothing — it could be a sampler that is not looking at this process.
    const { createServer } = await import('node:net');
    const listener = createServer();
    await new Promise(done => listener.listen(0, '127.0.0.1', done));
    const port = listener.address().port;
    await new Promise(done => setTimeout(done, 300));
    await new Promise(done => listener.close(done));

    // Then the thing being measured, inside the sampler's window.
    const during = from.exportCallsigns(passphrase, locations);
    const opened = to.inspectImport(during, passphrase);
    check(during.length > 100 && opened.callsigns === 2, 'The sampled export and open worked');

    await new Promise(done => sampler.once('exit', done));
    const watched = JSON.parse(output.slice('watching\n'.length) || '{}');
    check(Number(watched.readings) > 10, 'The sampler read this process many times');
    check(watched.sockets.some(socket => String(socket).endsWith(`:${port}`)),
      'The sampler saw a socket this script opened on purpose');
    const external = watched.sockets
      .map(socket => {
        const [local, remote] = String(socket).split('->');
        return classify({ local, remote: remote ?? '' });
      })
      .filter(endpoint => endpoint.external);
    check(external.length === 0, 'Nothing external was opened while exporting and importing');
    notes.push(`${watched.readings} readings by another process across an export and an import: ` +
      `${watched.sockets.length} socket(s), none external, and the control socket among them`);
  }

  // ---- nothing of the profile is written anywhere but the file ---------
  {
    // The export is bytes handed back, not a file the core wrote. Where it
    // goes is the operator's choice (QGD-PSN-0011), so this writes it and
    // checks that what landed is what was handed over.
    const path = join(first, 'exported.qgp');
    await writeFile(path, file);
    const read = await readFile(path);
    check(read.equals(file), 'What was written is what was exported');
    const onDisk = new CallsignCore(await mkdtemp(join(tmpdir(), 'qg-export-third-')));
    check(onDisk.inspectImport(read, passphrase).callsigns === 2, 'A file read back from disk imports');
    notes.push('the export is bytes the operator places; a file written and read back imports whole');
  }

  console.log(`Callsign export and import: ${notes.length} checks: PASS`);
  for (const note of notes) console.log(`  ${note}`);
} catch (error) {
  // The message is this script's own and carries no value, but it is kept to
  // one line in case a core error ever reaches here.
  console.error(String(error.message).split('\n')[0]);
  process.exitCode = 1;
} finally {
  for (const core of [from, to]) {
    for (const name of [id, alsoHere].filter(Boolean)) {
      try { if (core.list().some(entry => entry.id === name)) core.removeCallsign(name); } catch { /* cleaning up */ }
    }
  }
  await rm(first, { recursive: true, force: true });
  await rm(second, { recursive: true, force: true });
}
