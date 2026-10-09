// SPDX-License-Identifier: GPL-3.0-only
// The engine supervisor, as its own process.
//
// QGD-PRC-0004 and QGD-ENG-0006: starting a database is slow, can hang and can
// fail in ways that have nothing to do with the rest of the application, so it
// happens here and a failure of it is a failure of this process only.
//
// It is given its paths on the command line by the broker. Nothing it does
// takes a path from a message.
import { readFile } from 'node:fs/promises';
import { createForwardingLogger } from './logger.js';
import { chooseSocketDirectory, socketCandidates, type Endpoint } from './engine/endpoint.js';
import { status, stop, type EnginePaths } from './engine/supervisor.js';
import { bringUp } from './engine/start.js';
import type { ReferenceState } from './engine/start.js';
import type { Register } from './engine/reference/load.js';
import { validateEngineCommand, type EngineReply, type EngineStatus } from './engine-contract.js';

// What is worth logging about each answer. No credential, no path.
function describe(reference: ReferenceState): Record<string, unknown> {
  if (reference.state === 'loaded') {
    return { adif: reference.loaded.version, values: reference.loaded.values, fromCache: reference.fromCache };
  }
  if (reference.state === 'unavailable') return { reason: reference.reason };
  return {};
}

const [, , binaries, data, logs, sockets, migrations, buildFile, registerFile, referenceCache] = process.argv;
const log = createForwardingLogger('engine', line => process.parentPort.postMessage({ log: line }));

const paths: EnginePaths = {
  binaries,
  data,
  logs,
  sockets: chooseSocketDirectory(socketCandidates(data, sockets))
};
const endpoint: Endpoint = { kind: 'socket', directory: paths.sockets };

let current: EngineStatus = { state: 'stopped' };
let version = 'unknown';

async function bring(up: boolean): Promise<EngineStatus> {
  if (!up) {
    await stop(paths);
    return { state: 'stopped', version };
  }
  current = { state: 'starting', version };
  // Read here rather than at module load: a register that cannot be read is
  // a reference load that cannot happen, which QGD-REF-0014 says is reported
  // and does not stop the engine.
  const register = await readFile(registerFile, 'utf8')
    .then(text => JSON.parse(text) as Register)
    .catch(error => {
      log.warn({ reason: String(error instanceof Error ? error.message : error) }, 'the reference register could not be read');
      return undefined;
    });
  const started = await bringUp(paths, endpoint, {
    migrations,
    buildFile,
    ...(register ? { reference: { register, cacheDirectory: referenceCache } } : {}),
    onWarning: (message, fields) => log.warn(fields ?? {}, message)
  });
  version = started.version;
  log.info({ migrations: started.migrationsApplied }, 'engine up and migrated');
  // Said plainly either way, because "nothing in the log about it" is how a
  // reference load that never happened looks exactly like one that did.
  log.info({ reference: started.reference.state, ...describe(started.reference) }, 'reference data');
  return { state: 'running', version };
}

// One at a time. Starting a database takes seconds — initdb, the postmaster,
// then the migrations — and a stop arriving in the middle of that would be
// acting on a database that is half up. Every command waits for the one
// before it.
let queue: Promise<unknown> = Promise.resolve();
function serialised<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work);
  queue = next.catch(() => undefined);
  return next;
}

async function handle(command: unknown): Promise<EngineReply> {
  if (!validateEngineCommand(command)) return { ok: false, error: 'Invalid engine request.' };
  try {
    if (command.type === 'status') {
      // Answered without waiting for the queue: asking how it is must not
      // block behind a start that takes half a minute, which is the whole
      // reason anything is asking.
      //
      // While a start is in flight, the answer is "starting" and nothing else.
      // The postmaster is listening well before the migrations have run, so a
      // disk read would say "running" of a database that is not yet one
      // anything should be writing to — and a migration that hung would leave
      // that showing indefinitely. Only bringUp finishing makes it running.
      if (current.state === 'starting' || current.state === 'failed') {
        return { ok: true, status: current };
      }
      // Otherwise the disk is the authority: the postmaster may have gone
      // without telling anyone.
      const state = await status(paths);
      current = { state: state === 'running' ? 'running' : 'stopped', version };
      return { ok: true, status: current };
    }
    current = await serialised(() => bring(command.type === 'start'));
    log.info({ state: current.state }, 'engine state changed');
    return { ok: true, status: current };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'The engine could not be reached.';
    // The detail goes to the log, which is redacted and capped; the renderer
    // is told what happened and not where.
    log.warn({ reason, detail: String((error as { detail?: unknown }).detail ?? '') }, 'engine command failed');
    current = { state: 'failed', version, reason };
    return { ok: true, status: current };
  }
}

process.parentPort.on('message', event => {
  const payload = event.data as { id?: unknown; command?: unknown };
  if (!Number.isSafeInteger(payload?.id)) return;
  void handle(payload.command).then(reply => {
    process.parentPort.postMessage({ id: payload.id, reply });
  });
});

process.parentPort.postMessage({ ready: true });
log.info({}, 'engine supervisor ready');
