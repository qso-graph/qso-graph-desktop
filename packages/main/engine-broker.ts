// SPDX-License-Identifier: GPL-3.0-only
// The engine's channel, and the process that owns it.
//
// QGD-ENG-0003 is the rule this is built around: the application starts before
// the engine is up, so nothing here is on the path to a window appearing. The
// engine is asked to start in the background, and the shell draws whether or
// not it ever does.
import { app, ipcMain, utilityProcess, type UtilityProcess } from 'electron';
import { join } from 'node:path';
import { allowsSender, type FetchedReference } from '../personas/persona-contract.js';
import { createLogger, logDirectory, writeForwarded } from '../logging/logger.js';
import { isEngineStatus, validateEngineCommand, type EngineReply, type EngineStatus } from '../engine/engine-contract.js';

const log = createLogger('engine-broker');

export const ENGINE_CHANNEL = 'engine:request';

// Long enough for a clean shutdown of a database, short enough that quitting
// is not something a user waits on indefinitely.
export const SHUTDOWN_MS = 20_000;

export interface EngineBrokerOptions {
  distDirectory: string;
  binaries: string;
  data: string;
  sockets: string;
  buildFile: string;
  migrations: string;
  // data/reference-sources.json, and where the fetched ADIF archive is kept
  // between starts (QGD-REF-0001).
  registerFile: string;
  referenceCache: string;
  // How the engine reaches a reference source: by asking, never by
  // connecting. The credential core is the one process in this product that
  // opens an outbound connection (D-18, D-31), so the engine's supervisor
  // posts a request and gets bytes back.
  fetchReference: (url: string, etag?: string, lastModified?: string) => Promise<FetchedReference | string>;
  // Off by default in tests that only want the shell.
  startAtLaunch?: boolean;
}

// The returned function is awaited: see the shutdown comment below.
export function startEngineBroker(options: EngineBrokerOptions): () => Promise<void> {
  let worker: UtilityProcess | undefined;
  let stopped = false;
  let nextId = 0;
  let failures = 0;
  let last: EngineStatus = { state: 'starting' };
  const pending = new Map<number, { resolve: (reply: EngineReply) => void; timer: NodeJS.Timeout }>();

  function failPending(reason: string) {
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.resolve({ ok: true, status: { state: 'unavailable', reason } });
    }
    pending.clear();
  }

  function spawn() {
    if (stopped) return;
    worker = utilityProcess.fork(join(options.distDirectory, 'engine', 'engine-service.js'), [
      options.binaries, options.data, logDirectory(), options.sockets, options.migrations,
      options.buildFile, options.registerFile, options.referenceCache
    ], { serviceName: 'QG Engine', stdio: 'ignore' });

    worker.on('message', (message: unknown) => {
      if (message === null || typeof message !== 'object') return;
      const payload = message as {
        ready?: unknown; log?: unknown; id?: unknown; reply?: unknown;
        reference?: unknown;
      };
      if (typeof payload.log === 'string') { writeForwarded(payload.log); return; }
      // A reference source, asked for by the engine. Checked here before it
      // is passed on, because this is a message from another process even
      // though that process is ours (QGD-SEC-0006).
      //
      // The field is `reference` and not `fetch` because the network gate
      // reads a property called `fetch` as a client reaching the network, and
      // it is right to: it cannot tell this message's field from window's.
      // Naming a field after the thing the gate exists to find is how the
      // next one gets an exception written for it.
      if (payload.reference !== null && typeof payload.reference === 'object') {
        const request = payload.reference as { id?: unknown; url?: unknown; etag?: unknown; lastModified?: unknown };
        const id = request.id;
        if (!Number.isSafeInteger(id)) return;
        const answer = (result: unknown) => worker?.postMessage({ referenceAnswer: { id, result } });
        if (typeof request.url !== 'string' || !request.url.startsWith('https://') || request.url.length > 2048) {
          answer('Reference data is fetched over HTTPS only.');
          return;
        }
        void options.fetchReference(
          request.url,
          typeof request.etag === 'string' ? request.etag : undefined,
          typeof request.lastModified === 'string' ? request.lastModified : undefined
        ).then(answer, () => answer('The reference source could not be reached.'));
        return;
      }
      if (payload.ready === true) { failures = 0; return; }
      if (!Number.isSafeInteger(payload.id)) return;
      const reply = payload.reply as EngineReply | undefined;
      // QGD-SEC-0006: checked before it is used, even from our own process.
      if (reply === undefined || typeof reply !== 'object') return;
      if (reply.ok === true && !isEngineStatus(reply.status)) return;
      if (reply.ok === true) last = reply.status;
      const item = pending.get(payload.id as number);
      if (item) { clearTimeout(item.timer); pending.delete(payload.id as number); item.resolve(reply); }
    });

    worker.once('exit', () => {
      worker = undefined;
      failPending('The engine service stopped.');
      if (stopped) return;
      // The same back-off the persona broker uses. An engine that cannot start
      // must not become a restart loop that writes a log file a minute.
      const wait = Math.min(500 * 2 ** failures++, 30_000);
      last = { state: 'failed', reason: 'The engine service stopped unexpectedly.' };
      log.warn({ waitMs: wait, failures }, 'engine service exited; restarting');
      setTimeout(spawn, wait);
    });
  }

  function ask(command: unknown, timeoutMs = 180_000): Promise<EngineReply> {
    if (worker === undefined) {
      // What was last known, with the reason it cannot be asked again. The
      // version it reported is still the version it will report.
      return Promise.resolve({
        ok: true,
        status: { ...last, state: 'unavailable', reason: 'The engine service is not running.' }
      });
    }
    const id = nextId++;
    return new Promise<EngineReply>(resolve => {
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve({ ok: true, status: { state: 'failed', reason: 'The engine did not answer in time.' } });
      }, timeoutMs);
      timer.unref?.();
      pending.set(id, { resolve, timer });
      worker?.postMessage({ id, command });
    });
  }

  ipcMain.handle(ENGINE_CHANNEL, async (event, command: unknown): Promise<EngineReply> => {
    if (!allowsSender(event.senderFrame, event.sender.mainFrame, event.senderFrame?.url) ||
        !validateEngineCommand(command)) {
      log.warn({ accepted: false }, 'engine request refused');
      return { ok: false, error: 'Invalid engine request.' };
    }
    return ask(command);
  });

  spawn();
  if (options.startAtLaunch !== false) {
    // Not awaited, and nothing waits on it: QGD-ENG-0003. A database that
    // takes twenty seconds to come up must not be twenty seconds of blank
    // window.
    setTimeout(() => { void ask({ type: 'start' }); }, 0);
  }

  // Returns when the engine has stopped, or when it has had long enough.
  // Awaited by the caller: a postmaster left running outlives the application
  // and refuses the next launch (QGD-ENG-0008), so this is not something to
  // start and walk away from.
  return async () => {
    stopped = true;
    ipcMain.removeHandler(ENGINE_CHANNEL);
    // Everything already in flight is abandoned FIRST, and the stop is asked
    // for after — failing the pending set would otherwise resolve the stop
    // request itself the instant it was made, and the worker would be killed
    // before it had stopped anything.
    failPending('The application is closing.');
    try {
      await Promise.race([
        ask({ type: 'stop' }, SHUTDOWN_MS),
        new Promise(resolve => setTimeout(resolve, SHUTDOWN_MS))
      ]);
    } catch {
      // Nothing to do about it here; the kill below is the backstop.
    }
    worker?.kill();
    worker = undefined;
  };
}

// Where the engine's files live, beside everything else the application owns.
export function enginePaths(): { data: string; sockets: string; referenceCache: string } {
  const base = app.getPath('userData');
  return {
    data: join(base, 'engine', 'data'),
    sockets: join(base, 'engine', 'sockets'),
    // Not beside the data: the data directory belongs to PostgreSQL, and a
    // file of ours in it is a file initdb and pg_upgrade did not expect.
    referenceCache: join(base, 'reference')
  };
}
