// SPDX-License-Identifier: GPL-3.0-only
// The engine's channel, and the process that owns it.
//
// QGD-ENG-0003 is the rule this is built around: the application starts before
// the engine is up, so nothing here is on the path to a window appearing. The
// engine is asked to start in the background, and the shell draws whether or
// not it ever does.
import { app, ipcMain, utilityProcess, type UtilityProcess } from 'electron';
import { join } from 'node:path';
import { allowsSender } from './persona-contract.js';
import { createLogger, logDirectory, writeForwarded } from './logger.js';
import { isEngineStatus, validateEngineCommand, type EngineReply, type EngineStatus } from './engine-contract.js';

const log = createLogger('engine-broker');

export const ENGINE_CHANNEL = 'engine:request';

export interface EngineBrokerOptions {
  compiledDirectory: string;
  binaries: string;
  data: string;
  sockets: string;
  buildFile: string;
  migrations: string;
  // Off by default in tests that only want the shell.
  startAtLaunch?: boolean;
}

export function startEngineBroker(options: EngineBrokerOptions): () => void {
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
    worker = utilityProcess.fork(join(options.compiledDirectory, 'engine-service.js'), [
      options.binaries, options.data, logDirectory(), options.sockets, options.migrations, options.buildFile
    ], { serviceName: 'QG Engine', stdio: 'ignore' });

    worker.on('message', (message: unknown) => {
      if (message === null || typeof message !== 'object') return;
      const payload = message as { ready?: unknown; log?: unknown; id?: unknown; reply?: unknown };
      if (typeof payload.log === 'string') { writeForwarded(payload.log); return; }
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

  return () => {
    stopped = true;
    ipcMain.removeHandler(ENGINE_CHANNEL);
    // Asked to stop cleanly; killed if it will not. A postmaster left running
    // would refuse the next launch (QGD-ENG-0008).
    const closing = ask({ type: 'stop' }, 20_000);
    void closing.finally(() => { worker?.kill(); worker = undefined; });
    failPending('The application is closing.');
  };
}

// Where the engine's files live, beside everything else the application owns.
export function enginePaths(): { data: string; sockets: string } {
  const base = app.getPath('userData');
  return { data: join(base, 'engine', 'data'), sockets: join(base, 'engine', 'sockets') };
}
