// SPDX-License-Identifier: GPL-3.0-only
import { LOOKUP_OUTCOMES, type LookupOutcome } from './persona-contract.js';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateServiceCommand, type ServiceCommand, type CallsignReply } from './persona-contract.js';
import { serviceIds, summarise, validateRegister, type ServiceRegister } from './services.js';
import type { NativeModule, NativeCredentialStatus, NativeCredentialTest } from '../persona-core/native.js';
import type { CredentialStatus, CredentialTest } from './persona-contract.js';
import { createForwardingLogger } from '../logging/logger.js';
import { forStore } from './credential-store.js';

const require = createRequire(import.meta.url);
// One explicit assertion at the boundary, against the declared shape in
// native.d.ts, rather than `any` spreading through every call into the core.
// dist/personas/persona-service.js, so the addon is a sibling directory of
// this one: build-native.mjs puts it in dist/native (QGD-REP-0001).
const native = require(join(dirname(fileURLToPath(import.meta.url)), '..', 'native', 'persona.node')) as NativeModule;
const { CallsignCore, initCoreLogging, drainCoreLogs } = native;
const core = new CallsignCore(process.argv[2]);
// The same register the broker read, checked again here (QGD-SEC-0006: this
// process validates what reaches it rather than trusting the one before it).
// Read synchronously at start because nothing can be served without it.
let services: ReadonlySet<string> = new Set();
let register: ServiceRegister | undefined;
let registerProblem: string | undefined;
try {
  register = validateRegister(JSON.parse(readFileSync(process.argv[3], 'utf8')));
  services = serviceIds(register);
} catch (error) {
  registerProblem = error instanceof Error ? error.message : String(error);
}
const log = createForwardingLogger('callsigns', line => process.parentPort.postMessage({ log: line }));
if (registerProblem !== undefined) {
  // Said once, loudly: every command naming a service will be refused, and a
  // refusal with no reason anywhere is the thing nobody can diagnose.
  log.error({ reason: registerProblem }, 'the service register could not be read');
}

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

log.info({}, 'callsign service started');
forwardCoreLogs();
function snapshot() { return { callsigns: core.list(), active: core.active() ?? null }; }

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
    testable: native.testable,
    stored: native.stored,
    kindsKnown: native.kindsKnown,
    hasUsername: native.hasUsername,
    hasPassword: native.hasPassword,
    hasApiKey: native.hasApiKey,
    preferred,
    effective: FIELDS.find(value => value === native.effective) ?? null
  };
}

function toTest(native: NativeCredentialTest): CredentialTest {
  const outcome = OUTCOMES.find(value => value === native.outcome);
  if (!outcome) throw new Error('The callsign request could not be completed.');
  return { outcome };
}
function execute(command: ServiceCommand): CallsignReply {
  try {
    switch (command.type) {
      case 'list': return { ok: true, data: snapshot() };
      // An empty list rather than an error: a register that could not be read
      // is already said once in the log, and a screen that gets nothing shows
      // no services instead of a failure it cannot explain.
      case 'services': return { ok: true, data: register ? summarise(register) : [] };
      case 'create': core.create(command.call, command.description, command.start, command.end); return { ok: true, data: snapshot() };
      case 'update': core.update(command.id, command.call, command.description, command.start, command.end); return { ok: true, data: snapshot() };
      case 'set-active': core.setActive(command.id); return { ok: true, data: snapshot() };
      case 'remove-callsign': core.removeCallsign(command.id); return { ok: true, data: snapshot() };
      case 'status': return { ok: true, data: toStatus(core.credentialStatus(command.id, command.provider)) };
      case 'test-credential': return { ok: true, data: toTest(core.testCredential(command.id, command.provider)) };
      case 'save-credentials': core.saveCredentials(command.id, command.provider, command.credentials); return { ok: true, data: toStatus(core.credentialStatus(command.id, command.provider)) };
      case 'delete-credentials': core.deleteCredentials(command.id, command.provider); return { ok: true, data: toStatus(core.credentialStatus(command.id, command.provider)) };
      case 'remove-secret': core.removeSecret(command.id, command.provider, command.field); return { ok: true, data: toStatus(core.credentialStatus(command.id, command.provider)) };
      case 'set-preference': core.setPreference(command.id, command.provider, command.preferred); return { ok: true, data: toStatus(core.credentialStatus(command.id, command.provider)) };
      // The sealed bytes, handed to the broker to put where the operator
      // chose. Nothing of the bundle is in this reply but its ciphertext.
      case 'fetch-reference': {
        const fetched = core.fetchReference(command.url, command.etag, command.lastModified);
        return { ok: true, data: {
          fresh: fetched.fresh, body: fetched.body,
          etag: fetched.etag, lastModified: fetched.lastModified
        } };
      }
      // QGD-APP-0007: act with the credential, return the answer. The secret
      // stays in this process; what crosses back is the outcome and the
      // fields the service sent.
      case 'service-lookup': {
        const callsign = command.parameters.callsign ?? '';
        const looked = core.serviceLookup(command.id, command.service, command.operation, callsign);
        // The core's outcome is one of a fixed set; checked rather than cast,
        // because it crosses a process boundary (QGD-SEC-0006).
        const outcome = (LOOKUP_OUTCOMES as readonly string[]).includes(looked.outcome)
          ? (looked.outcome as LookupOutcome)
          : 'invalid-response';
        return { ok: true, data: { outcome, fields: looked.fields } };
      }
      case 'export-callsigns': return { ok: true, data: { bytes: core.exportCallsigns(command.passphrase) } };
      case 'import-callsigns': {
        const file = Buffer.from(command.file);
        if (!command.apply) {
          const preview = core.inspectImport(file, command.passphrase);
          return { ok: true, data: preview };
        }
        return { ok: true, data: core.applyImport(file, command.passphrase) };
      }
    }
  } catch (error) {
    // Native methods emit static, credential-free messages. Unexpected errors
    // use a fixed message; never return a stack or the command payload.
    const messages = [
      'Use a non-empty name without colons or control characters.', 'Enter a callsign: letters, digits and /.',
      'Keep the description to 64 characters, on one line.', 'A callsign could not be created.',
      'Use YYYY-MM-DD for dates.', 'End date must not precede start date.', 'Callsign not found.',
      'Keychain is unavailable.', 'Keychain could not read this credential.',
      'Keychain could not save this credential.', 'Keychain could not remove this credential.',
      'Enter a password or API key.', 'Profile could not be saved.',
      'The list of callsigns could not be read. It has not been changed.',
      'Stored credential has an unsupported format. It has not been changed.',
      'Credential preference is invalid.', 'Credential preferences could not be read.', 'Secret field is invalid.',
      'The callsign was not removed because Keychain could not delete a credential. Some credentials may already be removed; retry to finish.',
      'Secure client is unavailable.', 'No username is stored.', 'No password or API key is stored.',
      // Moving callsigns between machines. Each is a fixed sentence from the
      // core, carrying no value (QGD-PSN-0010's is the one that must reach the
      // operator intact, because it is the one that says what it cannot tell).
      'Choose a passphrase. An export is encrypted or it is not written.',
      'This file could not be opened with that passphrase. It may be the wrong passphrase, or the file may have been altered.',
      'This is not a QSO Graph Desktop export.',
      "This file's header is not the shape an export has.",
      'This export was written by a different version of QSO Graph Desktop.',
      'This export uses an algorithm this version does not have.',
      'This export opened, and what is inside it is not an export of callsigns.',
      'This file is larger than any export this product writes.',
      'This export holds a credential with no service.',
      'This export could not be read.',
      'The export could not be written.',
      "This machine's random number generator is unavailable.",
      // Fetching reference data, all fixed sentences carrying no URL.
      'Reference data is fetched over HTTPS only.',
      'The reference source could not be reached.',
      'The reference source refused the request.',
      'The reference source sent more than this product will read.',
      'The reference source could not be read.'
    ];
    const message = error instanceof Error && messages.includes(error.message) ? error.message : 'The callsign request could not be completed.';
    log.warn({ command: command.type, reason: message }, 'callsign operation failed');
    // Named for the store this platform has (Keychain, Credential Manager,
    // the keyring); the sentence is still one of the fixed ones above.
    return { ok: false, error: forStore(message, process.platform) };
  }
}
process.parentPort.on('message', (event: { data?: unknown }) => {
  // The envelope is checked before anything in it is used: the id has to be a
  // real id before it can be echoed back, and the command has to pass the
  // contract before it reaches the core.
  const data: unknown = event.data;
  const envelope = data !== null && typeof data === 'object' ? data as { id?: unknown; command?: unknown } : {};
  const { id, command } = envelope;
  if (!Number.isSafeInteger(id) || !validateServiceCommand(command, services)) {
    process.parentPort.postMessage({ id: typeof id === 'number' ? id : null, reply: { ok: false, error: 'Invalid callsign request.' } });
    return;
  }
  const reply = execute(command);
  // Drained on the command that raised them, so the ordering a reader expects
  // is the ordering they appear in.
  forwardCoreLogs();
  process.parentPort.postMessage({ id, reply });
});
process.parentPort.postMessage({ ready: true });
