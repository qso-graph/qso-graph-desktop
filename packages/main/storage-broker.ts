// SPDX-License-Identifier: GPL-3.0-only
// QG Storage's channel, and the process that owns the stores (QGD-ENG-0006).
//
// Nothing here is on the path to a window appearing: the storage process is
// started in the background, and the shell draws whether or not it ever comes
// up (QGD-ENG-0003). Its status reaches the screen two ways: once when the
// screen asks, and pushed whenever it changes (an exit, a restart, a finished
// reference build). So nothing polls and nothing goes stale.
import { app, BrowserWindow, ipcMain, utilityProcess, type UtilityProcess } from 'electron';
import { join } from 'node:path';
import { allowsSender, type FetchedReference } from '../personas/persona-contract.js';
import { PERSONA_STARTING } from './persona-broker.js';
import { createLogger, writeForwarded } from '../logging/logger.js';
import {
  STORAGE_CHANNEL, STORAGE_STATUS_CHANNEL, type StorageCommand, type StorageReply, type StorageStatus,
  isStorageReply, isStorageStatus, validateStorageCommand
} from '../storage/storage-contract.js';

const log = createLogger('storage-broker');

// Closing the stores is quick: a WAL checkpoint and a close. This is the
// backstop for a process that does not answer.
export const SHUTDOWN_MS = 5_000;

export interface StorageBrokerOptions {
  distDirectory: string;
  root: string;               // the application's own directory (userData)
  stateMigrations: string;    // drizzle/state
  referenceDdl: string;       // drizzle/reference
  registerFile: string;       // data/reference-sources.json
  referenceCache: string;     // where verified sources are kept
  appVersion: string;
  // How QG Storage reaches a reference source: by asking, never by
  // connecting. The credential core is the one process that opens an
  // outbound connection (QGD-SEC-0020).
  fetchReference: (url: string, etag?: string, lastModified?: string) => Promise<FetchedReference | string>;
}

export interface StorageBroker {
  stop: () => Promise<void>;
  // The persona made active, whose default station QG Storage makes active
  // (QGD-STN-0005). Main's to say, never a window's: there is no command for it.
  personaActivated: (name: string) => void;
}

export function startStorageBroker(options: StorageBrokerOptions): StorageBroker {
  let worker: UtilityProcess | undefined;
  let stopped = false;
  let nextId = 0;
  let failures = 0;
  let last: StorageStatus = { state: 'starting' };
  let heldActivation: string | undefined;
  const pending = new Map<number, { settle: (reply: StorageReply) => void; timer: NodeJS.Timeout }>();
  let closed: (() => void) | undefined;

  // Pushed to every window. A window that is not listening ignores it.
  function push(status: StorageStatus) {
    last = status;
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(STORAGE_STATUS_CHANNEL, status);
    }
  }

  function failPending(reason: string) {
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.settle({ ok: true, status: { ...last, state: 'unavailable', reason } });
    }
    pending.clear();
  }

  function spawn() {
    if (stopped) return;
    worker = utilityProcess.fork(join(options.distDirectory, 'storage', 'storage-service.js'), [
      options.root, options.stateMigrations, options.referenceDdl, options.registerFile,
      options.referenceCache, options.appVersion
    ], { serviceName: 'QG Storage', stdio: 'ignore' });
    // Logged so the connection-capture suite can name this process, and so a
    // support bundle can tell which pid was storage (QGD-ENG-0017). After the
    // spawn event: until then Electron does not know the pid.
    const spawned = worker;
    spawned.once('spawn', () => { log.info({ storagePid: spawned.pid }, 'storage service started'); });
    // An activation made while there was no process, handed to this one. QG
    // Storage holds it until its stores are open.
    if (heldActivation) { spawned.postMessage({ personaActive: heldActivation }); heldActivation = undefined; }

    // This process, and no later one. An answer to something it asked for is
    // delivered to it only while it is still the current process: a fetch that
    // outlives it is dropped, never handed to its replacement, whose request
    // ids start again from one.
    const self = worker;
    worker.on('message', (message: unknown) => {
      if (message === null || typeof message !== 'object') return;
      const payload = message as { ready?: unknown; log?: unknown; id?: unknown; reply?: unknown;
        reference?: unknown; status?: unknown; closed?: unknown };
      if (typeof payload.log === 'string') { writeForwarded(payload.log); return; }
      if (payload.closed === true) { closed?.(); return; }
      // A reference source, asked for by QG Storage. Checked here before it is
      // passed on: it is a message from another process, even one of ours
      // (QGD-SEC-0006).
      if (payload.reference !== null && typeof payload.reference === 'object') {
        const request = payload.reference as { id?: unknown; url?: unknown; etag?: unknown; lastModified?: unknown };
        const id = request.id;
        if (!Number.isSafeInteger(id)) return;
        const answer = (result: unknown) => { if (worker === self) self.postMessage({ referenceAnswer: { id, result } }); };
        if (typeof request.url !== 'string' || !request.url.startsWith('https://') || request.url.length > 2048) {
          answer('Reference data is fetched over HTTPS only.');
          return;
        }
        void options.fetchReference(
          request.url,
          typeof request.etag === 'string' ? request.etag : undefined,
          typeof request.lastModified === 'string' ? request.lastModified : undefined
        ).then(
          // Not ready yet means nothing was asked of any server: said as such,
          // so QG Storage may try again soon without spending a request against
          // a source's daily limit (QGD-REF-0010).
          result => answer(result === PERSONA_STARTING ? { notReady: true } : result),
          () => answer('The reference source could not be reached.'));
        return;
      }
      if (payload.status !== undefined) {
        if (isStorageStatus(payload.status)) {
          if (payload.status.state === 'ready') failures = 0;
          push(payload.status);
        }
        return;
      }
      if (payload.ready === true) return;
      if (!Number.isSafeInteger(payload.id)) return;
      const reply = payload.reply;
      if (!isStorageReply(reply)) return;
      const item = pending.get(payload.id as number);
      if (item) { clearTimeout(item.timer); pending.delete(payload.id as number); item.settle(reply); }
    });

    worker.once('exit', () => {
      worker = undefined;
      failPending('The storage service stopped.');
      if (stopped) return;
      // The same back-off as the persona broker: a process that cannot start
      // must not become a restart loop writing a log file a minute.
      const wait = Math.min(500 * 2 ** failures++, 30_000);
      push({ state: 'unavailable', reason: 'The storage service stopped and is being restarted.' });
      log.warn({ waitMs: wait, failures }, 'storage service exited; restarting');
      setTimeout(spawn, wait);
    });
  }

  function ask(command: StorageCommand = { type: 'status' }, timeoutMs = 10_000): Promise<StorageReply> {
    if (worker === undefined) {
      return Promise.resolve({ ok: true, status: { ...last, state: 'unavailable', reason: 'The storage service is not running.' } });
    }
    const id = nextId++;
    return new Promise<StorageReply>((settle) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        settle({ ok: true, status: { ...last, state: 'unavailable', reason: 'The storage service did not answer in time.' } });
      }, timeoutMs);
      timer.unref?.();
      pending.set(id, { settle, timer });
      worker?.postMessage({ id, command });
    });
  }

  ipcMain.handle(STORAGE_CHANNEL, async (event, command: unknown): Promise<StorageReply> => {
    if (!allowsSender(event.senderFrame, event.sender.mainFrame, event.senderFrame?.url) ||
        !validateStorageCommand(command)) {
      log.warn({ accepted: false }, 'storage request refused');
      return { ok: false, error: 'Invalid storage request.' };
    }
    if (command.type === 'update-reference') log.info({}, 'reference update asked for');
    return ask(command);
  });

  spawn();

  // Awaited at quit: the stores are closed cleanly, or the process is killed
  // after SHUTDOWN_MS. SQLite recovers either way; a clean close leaves no
  // WAL for the next start to replay.
  const stop = async () => {
    stopped = true;
    ipcMain.removeHandler(STORAGE_CHANNEL);
    failPending('The application is closing.');
    if (worker) {
      const done = new Promise<'closed'>((settle) => { closed = () => settle('closed'); });
      worker.postMessage({ close: true });
      const outcome = await Promise.race([done, new Promise<'timeout'>((settle) => setTimeout(() => settle('timeout'), SHUTDOWN_MS))]);
      // Said either way, so a shutdown that timed out and was killed can never
      // look like one that closed (the smoke suite reads these).
      if (outcome === 'closed') log.info({}, 'storage closed');
      else log.warn({ waitedMs: SHUTDOWN_MS }, 'storage did not close in time; killed');
    }
    worker?.kill();
    worker = undefined;
  };
  return {
    stop,
    // A persona's name only, never anything about it. If QG Storage is not
    // running the active station simply stays as it was.
    // Kept until a process has it, so an activation made while QG Storage was
    // restarting is applied when it is back rather than lost.
    personaActivated: (name) => {
      if (worker) worker.postMessage({ personaActive: name });
      else heldActivation = name;
    }
  };
}

// The application's own directory, and where verified sources are kept in it.
export function storageRoot(): { root: string; referenceCache: string } {
  const root = app.getPath('userData');
  return { root, referenceCache: join(root, 'reference') };
}
