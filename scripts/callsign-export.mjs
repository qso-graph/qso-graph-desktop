// SPDX-License-Identifier: GPL-3.0-only
// P6-persona-owns-credential, P6-export-public, P6-export-round-trip,
// P6-import-all-or-none and P6-export-goes-nowhere (QGD-PSN-0001,
// QGD-PSN-0007 to QGD-PSN-0011).
//
// Against the real credential core and the real Keychain, because what is
// being proved is that callsigns and Locations go into one plain file and
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

  // ---- P6-export-public ------------------------------------------------
  // KI7MT, 2026-10-23: "we don't store anything that's not publicly
  // available", and a login never moves. A backup is a plain file of what is
  // public, so it is searched for every private value that went in, and none
  // may be there: no secret, and no username either (Club Log's is an email
  // address).
  const locations = JSON.stringify({ stations: [{ id: randomUUID(), name: 'Home', place: { MY_GRIDSQUARE: 'DN13' } }], defaults: {}, active: null });
  const file = from.exportBackup(locations);
  check(Buffer.isBuffer(file) && file.length > 100, 'A backup produced a file');
  for (const secret of [password, apiKey, 'w1aw@example.invalid']) {
    check(!file.includes(Buffer.from(secret)), 'A backup holds no login and no username');
  }
  check(sentinelsIn(file.toString('latin1')).length === 0, 'A backup holds no credential sentinel');
  const parsed = JSON.parse(file.toString('utf8'));
  check(parsed.format === 'qso-graph-desktop-backup' && parsed.version === 2, 'A backup names itself and its version');
  check(parsed.callsigns.some(entry => entry.call === 'W1AW' && entry.description === description), 'A backup holds the callsigns, readably');
  check(parsed.locations.stations[0].name === 'Home', 'A backup holds the Locations it was handed');
  notes.push(`a ${file.length}-byte plain file holding the callsigns and Locations, and none of the three private values that went into the profile`);

  // ---- P6-export-round-trip --------------------------------------------
  // The first machine's entries go, so only the file could bring them back,
  // and it must not.
  for (const service of ['qrz', 'clublog']) from.deleteCredentials(id, service);
  const preview = to.inspectBackup(file);
  check(preview.callsigns === 2, 'The preview counts the callsigns');
  check(preview.arriving.length === 2 && preview.here.length === 0, 'A clean machine has nothing to remove first');
  check(JSON.parse(preview.locations).stations[0].name === 'Home', 'The Locations come back as they went in, for QG Storage');

  const applied = to.applyBackup(file, false);
  check(applied.callsigns === 2, 'The restore reports what it did');
  const ids = to.list().map(entry => entry.id);
  check(ids.includes(id) && ids.includes(alsoHere), 'Both callsigns arrived, with their ids');
  const arrived = to.list().find(entry => entry.id === id);
  check(arrived.call === 'W1AW' && arrived.description === description && arrived.start === '2026-01-01',
    'The callsign arrived whole');
  // The services arrived, and no login did: each is there to have its login
  // entered, under the same id, so the Keychain name is the first machine's.
  check(to.credentialStatus(id, 'clublog').preferred === 'api_key', 'The service preference arrived');
  check(!to.credentialStatus(id, 'qrz').stored, 'No login arrived: none is in the Keychain');
  refusal(() => to.requireCredential(id, 'qrz'), 'A login that was not restored');
  notes.push('two callsigns and a service preference arrive in a profile that had none, with their ids, and no login: none is in the file or the Keychain');

  // ---- P6-import-all-or-none ------------------------------------------
  {
    // A clean slate, never a merge (KI7MT, 2026-10-23).
    const second = to.inspectBackup(file);
    check(second.here.length === 2, 'A restore onto a machine that has callsigns names them');
    refusal(() => to.applyBackup(file, false), 'A restore onto callsigns not said to be removed');
    check(to.list().length === 2, 'And it changed nothing');
    const replaced = to.applyBackup(file, true);
    check(replaced.callsigns === 2 && to.list().length === 2, 'Said to remove them first, the restore replaces them');
    notes.push('a restore onto a machine with callsigns names them, refuses until told to remove them, then replaces them');

    // A file that is not a backup, or is one this build cannot read, changes nothing.
    const before = JSON.stringify(to.list());
    for (const [bad, name] of [
      [Buffer.from('hello'), 'A file that is not a backup'],
      [Buffer.from(file.toString('utf8').replace('"version": 2', '"version": 9')), 'A backup of another version'],
      [Buffer.from(file.toString('utf8').replace('{', '{"credentials":{},')), 'A backup carrying a field it does not have'],
      [Buffer.from('QGD-CALLSIGN-EXPORT\n{}'), 'An encrypted export from an earlier build']
    ]) {
      refusal(() => to.applyBackup(bad, true), name);
      check(JSON.stringify(to.list()) === before, `${name} changed nothing`);
    }
    notes.push('a file that is not a backup, one of another version, one carrying an unknown field, and an earlier encrypted export each change nothing');
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
    const during = from.exportBackup(locations);
    const opened = to.inspectBackup(during);
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
    const path = join(first, 'backup.json');
    await writeFile(path, file);
    const read = await readFile(path);
    check(read.equals(file), 'What was written is what was exported');
    const onDisk = new CallsignCore(await mkdtemp(join(tmpdir(), 'qg-export-third-')));
    check(onDisk.inspectBackup(read).callsigns === 2, 'A file read back from disk restores');
    notes.push('the backup is bytes the operator places; a file written and read back restores whole');
  }

  console.log(`Callsign and Location backup and restore: ${notes.length} checks: PASS`);
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
