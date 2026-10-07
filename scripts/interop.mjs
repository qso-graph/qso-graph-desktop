// SPDX-License-Identifier: GPL-3.0-only
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const { PersonaCore } = require('../dist/native/persona.node');
const directory = await mkdtemp(join(tmpdir(), 'qg-persona-interop-'));
const core = new PersonaCore(directory);
const persona = `qg-test-${randomUUID()}`;
const other = `qg-test-${randomUUID()}`;
const provider = 'qrz_logbook';
const password = `QG_FAKE_CREDENTIAL_${randomUUID()}`;
const apiKey = `QG_FAKE_CREDENTIAL_${randomUUID()}`;
const pythonKey = `QG_FAKE_CREDENTIAL_${randomUUID()}`;
function check(result, name) { if (!result) throw new Error(`${name} failed; credential values omitted.`); }
const python = process.env.QG_INTEROP_PYTHON || resolve('../../.venv/bin/python');
const pythonSource = process.env.QG_AUTH_SOURCE || resolve('../qso-graph-auth/src');
try {
  core.upsert(persona, 'w1aw', '2026-01-01', undefined);
  core.saveCredentials(persona, provider, { username: 'W1AW', password, apiKey });
  const run = spawnSync(python, ['-c', `
import json, sys
from pathlib import Path
from qso_graph_auth.credentials import Credentials, get_creds, set_creds
from qso_graph_auth.identity.store import PersonaStore
from qso_graph_auth.identity.manager import PersonaManager
try:
    stage = 'input'
    data = json.load(sys.stdin)
    stage = 'persona format'
    store = PersonaStore(Path(data['directory']) / 'personas.json')
    if store.get(data['persona']).callsign != 'W1AW': raise ValueError()
    stage = 'read Rust Keychain entry'
    print('Python interoperability: reading synthetic Rust Keychain entry.', flush=True)
    creds = get_creds(data['persona'], data['provider'])
    if not creds or creds.password != data['password'] or creds.api_key != data['apiKey']: raise ValueError()
    stage = 'credential selection'
    selected = PersonaManager(store).require(data['persona'], data['provider'])
    if selected != ('W1AW', data['apiKey']): raise ValueError()
    stage = 'Python Keychain write'
    set_creds(data['persona'], data['provider'], Credentials(username='W1AW', api_key=data['pythonKey']))
    store.upsert(name=data['other'], callsign='K1ABC', start=None, end=None)
    print('Python read Rust credentials and wrote a replacement: PASS')
except BaseException as error:
    print('Python interoperability failed at ' + stage + ' (' + type(error).__name__ + '); values omitted.')
    sys.exit(1)
`], {
    input: JSON.stringify({ directory, persona, other, provider, password, apiKey, pythonKey }),
    env: { ...process.env, PYTHONPATH: pythonSource }, encoding: 'utf8', timeout: 30_000
  });
  if (run.status !== 0) {
    console.error(run.error ? 'Python proof did not finish; check for a Keychain permission dialog.' : run.stdout.trim());
  }
  check(run.status === 0, 'Rust → Python interoperability');
  const selected = core.requireCredential(persona, provider);
  check(selected.username === 'W1AW' && selected.password === pythonKey, 'Python → Rust interoperability');
  check(core.list().some(p => p.name === other && p.callsign === 'K1ABC'), 'Python → Rust persona metadata');
  check(!core.credentialStatus(other, provider).stored, 'Persona credential isolation');
  const status = core.credentialStatus(persona, provider);
  check(status.stored && status.hasApiKey && !status.hasPassword, 'Safe credential status');
  check(Object.keys(status).sort().join(',') === 'effective,hasApiKey,hasPassword,hasUsername,preferred,stored', 'No secret in status API');
  core.setActive(persona.toUpperCase());
  check(core.active() === persona, 'Case-insensitive active persona');
  const index = await readFile(join(directory, 'personas.json'), 'utf8');
  check(![password, apiKey, pythonKey].some(secret => index.includes(secret)), 'No secret in persona index');
  check(core.deleteCredentials(persona, provider) && !core.credentialStatus(persona, provider).stored, 'Credential deletion');
  console.log('Rust ↔ qso-graph-auth Keychain and persona-format interoperability: PASS');
  console.log('Credential isolation, safe status, active persona and deletion: PASS');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  try { core.deleteCredentials(persona, provider); } catch {
    const cleanup = spawnSync(python, ['-c', `
import json, sys
from qso_graph_auth.credentials import delete_creds
data = json.load(sys.stdin)
delete_creds(data['persona'], data['provider'])
`], { input: JSON.stringify({ persona, provider }), env: { ...process.env, PYTHONPATH: pythonSource }, timeout: 15_000, stdio: ['pipe', 'ignore', 'ignore'] });
    if (cleanup.status !== 0) { console.error('Synthetic Keychain cleanup failed.'); process.exitCode = 1; }
  }
  await rm(directory, { recursive: true, force: true });
}
