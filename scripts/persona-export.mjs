// SPDX-License-Identifier: GPL-3.0-only
// P6-persona-owns-credential, P6-export-encrypted, P6-export-header,
// P6-export-round-trip, P6-import-all-or-none, P6-import-cannot-tell and
// P6-export-goes-nowhere (QGD-PSN-0001, QGD-PSN-0007 to QGD-PSN-0011).
//
// Against the real credential core and the real Keychain, because what is
// being proved is that the secrets come out of the Keychain, go into one
// encrypted file, and arrive in a second profile that had none — and a
// round-trip through a mock proves nothing about the Keychain.
//
// Two profile directories stand in for two machines. They share one Keychain,
// which is this machine's, so the second profile's personas are named
// differently from the first's: what is being shown is that the bundle carried
// the credential, not that the Keychain already had it.
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { sentinelsIn } from './artifact-scan.mjs';
import { classify } from './endpoint.mjs';

const require = createRequire(import.meta.url);
const { PersonaCore } = require('../dist/native/persona.node');

const first = await mkdtemp(join(tmpdir(), 'qg-export-from-'));
const second = await mkdtemp(join(tmpdir(), 'qg-export-to-'));
const persona = `qg-test-${randomUUID()}`;
const alsoHere = `qg-test-${randomUUID()}`;
const password = `QG_FAKE_CREDENTIAL_${randomUUID()}`;
const apiKey = `QG_FAKE_CREDENTIAL_${randomUUID()}`;
const passphrase = `a passphrase ${randomUUID()}`;
const from = new PersonaCore(first);
const to = new PersonaCore(second);
const notes = [];

function check(ok, name) { if (!ok) throw new Error(`${name} failed; values omitted.`); }

// A refusal, taken without letting the message carry a value into the output.
function refusal(action, name) {
  try { action(); } catch (error) { return String(error.message); }
  throw new Error(`${name} was not refused.`);
}

try {
  // ---- a profile worth moving -----------------------------------------
  from.upsert(persona, 'W1AW', '2026-01-01');
  from.saveCredentials(persona, 'qrz', { username: 'W1AW', password });
  from.saveCredentials(persona, 'clublog', { username: 'w1aw@example.invalid', password, apiKey });
  from.setPreference(persona, 'clublog', 'api_key');
  from.upsert(alsoHere, 'W1AW/P');

  // ---- P6-persona-owns-credential --------------------------------------
  {
    // QGD-PSN-0001: a credential belongs to a persona and a service, never to
    // the application. Two personas, one service, two different secrets —
    // and removing one leaves the other, which is the half that would be
    // missed by a store keyed on the service alone.
    const second = `QG_FAKE_CREDENTIAL_${randomUUID()}`;
    from.saveCredentials(alsoHere, 'qrz', { username: 'W1AW/P', password: second });
    check(from.requireCredential(persona, 'qrz').password === password, 'The first persona keeps its own');
    check(from.requireCredential(alsoHere, 'qrz').password === second, 'The second persona has its own');
    from.deleteCredentials(alsoHere, 'qrz');
    check(!from.credentialStatus(alsoHere, 'qrz').stored, 'The second persona\u2019s credential is gone');
    check(from.requireCredential(persona, 'qrz').password === password,
      'And removing it left the first persona\u2019s alone');
    notes.push('two personas hold separate secrets for one service, and removing one leaves the other');
  }

  // ---- P6-export-encrypted --------------------------------------------
  const file = from.exportPersonas(passphrase);
  check(Buffer.isBuffer(file) && file.length > 100, 'Export produced a file');

  // Every value that went in, searched for in the bytes that came out. The
  // sentinel scan is the same one make verify runs over every artifact, so a
  // credential in an export would be caught by the project's own rule as
  // well as by this.
  for (const secret of [password, apiKey, 'W1AW', persona, 'w1aw@example.invalid']) {
    check(!file.includes(Buffer.from(secret)), 'Export holds no value in the clear');
  }
  check(sentinelsIn(file.toString('latin1')).length === 0, 'Export holds no credential sentinel');
  notes.push(`${file.length} bytes, holding none of the five values that went into it`);

  // QGD-PSN-0007: without a passphrase there is no file, rather than a file
  // anyone can read.
  for (const empty of ['', '   ']) {
    const message = refusal(() => from.exportPersonas(empty), 'An export with no passphrase');
    check(/passphrase/i.test(message), 'Refusal says a passphrase is needed');
  }
  notes.push('an export with no passphrase is refused rather than written in the clear');

  // ---- P6-export-header ------------------------------------------------
  const newline = file.indexOf(0x0a);
  const secondNewline = file.indexOf(0x0a, newline + 1);
  check(file.toString('utf8', 0, newline) === 'QGD-PERSONA-EXPORT', 'The file names itself');
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
  const again = from.exportPersonas(passphrase);
  const headerAgain = JSON.parse(again.toString('utf8', again.indexOf(0x0a) + 1, again.indexOf(0x0a, again.indexOf(0x0a) + 1)));
  check(headerAgain.salt !== header.salt, 'A second export draws a new salt');
  check(headerAgain.nonce !== header.nonce, 'A second export draws a new nonce');
  check(!again.subarray(secondNewline).equals(file.subarray(secondNewline)), 'A second export is different ciphertext');
  notes.push('a second export of the same profile shares neither its salt, its nonce, nor a byte of its ciphertext');

  // ---- P6-export-round-trip --------------------------------------------
  const preview = to.inspectImport(file, passphrase);
  check(preview.personas === 2 && preview.credentials === 2, 'The preview counts what is inside');
  check(preview.arriving.length === 2 && preview.overwritten.length === 0, 'Nothing is overwritten on a clean machine');
  check(!JSON.stringify(preview).includes(password), 'The preview carries no secret');

  const applied = to.applyImport(file, passphrase);
  check(applied.personas === 2 && applied.credentials === 2, 'The import reports what it did');
  const names = to.list().map(entry => entry.name);
  check(names.includes(persona) && names.includes(alsoHere), 'Both personas arrived');
  const arrived = to.list().find(entry => entry.name === persona);
  check(arrived.callsign === 'W1AW' && arrived.start === '2026-01-01', 'The persona arrived whole');

  // The secrets arrived, which is the half an operator would notice missing.
  // Read through requireCredential, which is the trusted path that decrypts.
  check(to.requireCredential(persona, 'qrz').password === password, 'The password arrived');
  check(to.requireCredential(persona, 'clublog').password === apiKey, 'The preferred API key arrived');
  check(to.credentialStatus(persona, 'clublog').preferred === 'api_key', 'The service preference arrived');
  const status = to.credentialStatus(persona, 'clublog');
  check(status.stored && status.kindsKnown && status.hasPassword && status.hasApiKey,
    'The status answers without being asked to read anything');
  notes.push('two personas, two credentials and a service preference arrive in a profile that had none');

  // ---- P6-import-all-or-none ------------------------------------------
  {
    // A machine that already has one of them is told which, before anything
    // is done. The second profile now holds both, so a second import of the
    // same file overwrites both and says so.
    const second = to.inspectImport(file, passphrase);
    check(second.overwritten.length === 2 && second.arriving.length === 0,
      'An import onto a machine that has them says what it would overwrite');
    notes.push('an import that would overwrite says which personas, before it does');

    // A file that fails its tag changes nothing at all.
    const before = JSON.stringify(to.list());
    const altered = Buffer.from(file);
    altered[altered.length - 1] ^= 0x01;
    refusal(() => to.applyImport(altered, passphrase), 'An altered file');
    check(JSON.stringify(to.list()) === before, 'A refused import changed nothing');

    // And so does a file that is not an export at all.
    refusal(() => to.applyImport(Buffer.from('hello'), passphrase), 'A file that is not an export');
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
      [resolve('scripts/socket-sampler.mjs'), String(process.pid), '1500'],
      { stdio: ['ignore', 'pipe', 'ignore'] });
    let output = '';
    sampler.stdout.on('data', chunk => { output += chunk; });

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
    const during = from.exportPersonas(passphrase);
    const opened = to.inspectImport(during, passphrase);
    check(during.length > 100 && opened.personas === 2, 'The sampled export and open worked');

    await new Promise(done => sampler.once('exit', done));
    const watched = JSON.parse(output || '{}');
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
    const onDisk = new PersonaCore(await mkdtemp(join(tmpdir(), 'qg-export-third-')));
    check(onDisk.inspectImport(read, passphrase).personas === 2, 'A file read back from disk imports');
    notes.push('the export is bytes the operator places; a file written and read back imports whole');
  }

  console.log(`Persona export and import: ${notes.length} checks: PASS`);
  for (const note of notes) console.log(`  ${note}`);
} catch (error) {
  // The message is this script's own and carries no value, but it is kept to
  // one line in case a core error ever reaches here.
  console.error(String(error.message).split('\n')[0]);
  process.exitCode = 1;
} finally {
  for (const core of [from, to]) {
    for (const name of [persona, alsoHere]) {
      try { if (core.list().some(entry => entry.name === name)) core.removePersona(name); } catch { /* cleaning up */ }
    }
  }
  await rm(first, { recursive: true, force: true });
  await rm(second, { recursive: true, force: true });
}
