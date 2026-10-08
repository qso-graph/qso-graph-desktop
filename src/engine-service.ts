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
import { join } from 'node:path';
import { createForwardingLogger } from './logger.js';
import { chooseSocketDirectory, socketCandidates, type Endpoint } from './engine/endpoint.js';
import { initialise, start, status, stop, type EnginePaths } from './engine/supervisor.js';
import { connectAsSuperuser } from './engine/roles.js';
import { applyMigrations, recordInstallation } from './engine/migrate.js';
import { validateEngineCommand, type EngineReply, type EngineStatus } from './engine-contract.js';

const [, , binaries, data, logs, sockets, migrations, buildFile] = process.argv;
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
  await initialise(paths);
  await start(paths, endpoint);
  // The migrations are part of starting: an engine that is up but not
  // migrated is not one anything should be writing to (QGD-ENG-0013).
  const client = await connectAsSuperuser(endpoint, 'postgres', error => {
    log.warn({ reason: error.message }, 'engine connection dropped');
  });
  try {
    await applyMigrations(client, migrations);
    const build = JSON.parse(await readFile(buildFile, 'utf8')) as { major: number; version: string };
    version = build.version;
    await recordInstallation(client, build.major, build.version);
  } finally {
    await client.end().catch(() => {});
  }
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
      // Read from disk rather than remembered, because the postmaster may have
      // gone without telling anyone — except while this process is in the
      // middle of starting it, when the disk says "stopped" and is about to be
      // wrong. Neither "starting" nor "failed" is overwritten by it.
      const state = await status(paths);
      if (state === 'running') current = { state: 'running', version };
      else if (current.state !== 'starting' && current.state !== 'failed') {
        current = { state: 'stopped', version };
      }
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
log.info({ data: join(data, '').length > 0 }, 'engine supervisor ready');
