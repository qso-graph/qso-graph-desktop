// SPDX-License-Identifier: GPL-3.0-only
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCommand, type PersonaCommand, type PersonaReply } from './persona-contract.js';
import type { NativeModule, NativeCredentialStatus, NativeCredentialTest } from './native.js';
import type { CredentialStatus, CredentialTest } from './persona-contract.js';
import { createForwardingLogger } from './logger.js';

const require = createRequire(import.meta.url);
// One explicit assertion at the boundary, against the declared shape in
// native.d.ts, rather than `any` spreading through every call into the core.
const native = require(join(dirname(fileURLToPath(import.meta.url)), 'native/persona.node')) as NativeModule;
const { PersonaCore, initCoreLogging, drainCoreLogs } = native;
const core = new PersonaCore(process.argv[2]);
const log = createForwardingLogger('persona', line => process.parentPort.postMessage({ log: line }));

// QGD-LOG-0001: the core raises events through `tracing`; they are drained here
// and emitted through this process's logger, so they reach the one stream and
// pass the same redaction as everything else — the core is trusted not to raise
// a secret (QGD-LOG-0004), and this is the second place that would catch it.
initCoreLogging();
const LEVELS: Record<string, 'debug' | 'info' | 'warn' | 'error'> = {
  TRACE: 'debug', DEBUG: 'debug', INFO: 'info', WARN: 'warn', ERROR: 'error'
};
interface CoreRecord { level?: string; fields?: Record<string, unknown> }

function forwardCoreLogs(): void {
  let lines: string[];
  try { lines = drainCoreLogs(); } catch { return; }
  for (const line of lines) {
    let parsed: unknown;
    try { parsed = JSON.parse(line); } catch { continue; }
    if (parsed === null || typeof parsed !== 'object') continue;
    const record = parsed as CoreRecord;
    const { message, ...fields } = record.fields ?? {};
    const level = LEVELS[String(record.level ?? 'INFO').toUpperCase()] ?? 'info';
    log[level]({ ...fields, source: 'core' }, typeof message === 'string' ? message : 'core event');
  }
}

log.info({}, 'persona service started');
forwardCoreLogs();
function snapshot() { return { personas: core.list(), active: core.active() ?? null }; }

// The core speaks strings; the IPC contract speaks unions. Narrowing here is
// the point of typing the boundary: the two shapes are not the same, and until
// this was typed one was being handed to the renderer as the other. An
// unexpected value is refused, never widened to fit.
const PREFERENCES = ['service', 'password', 'api_key'] as const;
const FIELDS = ['password', 'api_key'] as const;
const OUTCOMES = ['success', 'rejected', 'network-error', 'rate-limited', 'invalid-response', 'missing', 'unsupported'] as const;

function toStatus(native: NativeCredentialStatus): CredentialStatus {
  const preferred = PREFERENCES.find(value => value === native.preferred);
  if (!preferred) throw new Error('Credential preference is invalid.');
  return {
    stored: native.stored,
    hasUsername: native.hasUsername,
    hasPassword: native.hasPassword,
    hasApiKey: native.hasApiKey,
    preferred,
    effective: FIELDS.find(value => value === native.effective) ?? null
  };
}

function toTest(native: NativeCredentialTest): CredentialTest {
  const outcome = OUTCOMES.find(value => value === native.outcome);
  if (!outcome) throw new Error('The persona operation could not be completed.');
  return { outcome };
}
function execute(command: PersonaCommand): PersonaReply {
  try {
    switch (command.type) {
      case 'list': return { ok: true, data: snapshot() };
      case 'upsert': core.upsert(command.name, command.callsign, command.start, command.end); return { ok: true, data: snapshot() };
      case 'set-active': core.setActive(command.name); return { ok: true, data: snapshot() };
      case 'remove-persona': core.removePersona(command.name); return { ok: true, data: snapshot() };
      case 'status': return { ok: true, data: toStatus(core.credentialStatus(command.persona, command.provider)) };
      case 'test-credential': return { ok: true, data: toTest(core.testCredential(command.persona, command.provider)) };
      case 'save-credentials': core.saveCredentials(command.persona, command.provider, command.credentials); return { ok: true, data: toStatus(core.credentialStatus(command.persona, command.provider)) };
      case 'delete-credentials': core.deleteCredentials(command.persona, command.provider); return { ok: true, data: toStatus(core.credentialStatus(command.persona, command.provider)) };
      case 'remove-secret': core.removeSecret(command.persona, command.provider, command.field); return { ok: true, data: toStatus(core.credentialStatus(command.persona, command.provider)) };
      case 'set-preference': core.setPreference(command.persona, command.provider, command.preferred); return { ok: true, data: toStatus(core.credentialStatus(command.persona, command.provider)) };
    }
  } catch (error) {
    // Native methods emit static, credential-free messages. Unexpected errors
    // use a fixed message; never return a stack or the command payload.
    const messages = [
      'Use a non-empty name without colons or control characters.', 'Enter a callsign.',
      'Use YYYY-MM-DD for dates.', 'End date must not precede start date.', 'Persona not found.',
      'Keychain is unavailable.', 'Keychain could not read this credential.',
      'Keychain could not save this credential.', 'Keychain could not remove this credential.',
      'Enter a password or API key.', 'Profile could not be saved.',
      'The persona index could not be read. It has not been changed.',
      'Stored credential has an unsupported format. It has not been changed.',
      'Credential preference is invalid.', 'Credential preferences could not be read.', 'Secret field is invalid.',
      'Persona was not removed because Keychain could not delete a credential. Some credentials may already be removed; retry to finish.',
      'Secure client is unavailable.', 'No username is stored.', 'No password or API key is stored.'
    ];
    const message = error instanceof Error && messages.includes(error.message) ? error.message : 'The persona operation could not be completed.';
    log.warn({ command: command.type, reason: message }, 'persona operation failed');
    return { ok: false, error: message };
  }
}
process.parentPort.on('message', (event: { data?: unknown }) => {
  // The envelope is checked before anything in it is used: the id has to be a
  // real id before it can be echoed back, and the command has to pass the
  // contract before it reaches the core.
  const data: unknown = event.data;
  const envelope = data !== null && typeof data === 'object' ? data as { id?: unknown; command?: unknown } : {};
  const { id, command } = envelope;
  if (!Number.isSafeInteger(id) || !validateCommand(command)) {
    process.parentPort.postMessage({ id: typeof id === 'number' ? id : null, reply: { ok: false, error: 'Invalid persona request.' } });
    return;
  }
  const reply = execute(command);
  // Drained on the command that raised them, so the ordering a reader expects
  // is the ordering they appear in.
  forwardCoreLogs();
  process.parentPort.postMessage({ id, reply });
});
process.parentPort.postMessage({ ready: true });
