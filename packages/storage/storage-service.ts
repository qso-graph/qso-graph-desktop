// SPDX-License-Identifier: GPL-3.0-only
// QG Storage: the one process that opens a SQLite store (QGD-ENG-0006,
// QGD-PRC-0004).
//
// It is given its paths on the command line by the broker, and nothing it
// does takes a path from a message. It opens state.sqlite at once, answers
// status straight away, and keeps reference.sqlite current in the background,
// building on a worker so it never stops answering (QGD-ENG-0015).
//
// It opens no connection. A reference source is asked for through the broker,
// which asks the credential core, the one process that reaches the network
// (QGD-SEC-0020). Every failure is reduced before it is logged or sent
// (QGD-ENG-0016).
import { readFile } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { createForwardingLogger } from '../logging/logger.js';
import type { Register } from '../reference/register.js';
import { StorageFailure, describe, reduce } from './errors.js';
import { layout, openState } from './layout.js';
import { Reference, type DatasetState, type ReferenceStatus } from './reference.js';
import type { Store } from './sqlite.js';
import type { stateSchema } from './schema.js';
import {
  type DatasetSummary, type StorageReply, type StorageStatus, validateStorageCommand
} from './storage-contract.js';

const [, , root, stateMigrations, referenceDdl, registerFile, referenceCache, appVersion] = process.argv;
const log = createForwardingLogger('storage', (line) => process.parentPort.postMessage({ log: line }));
const paths = { ...layout(root), referenceCache };

// ---- asking for a reference source, through the broker --------------------
let nextFetch = 0;
const fetches = new Map<number, (answer: unknown) => void>();

function askForReference(url: string, etag?: string, lastModified?: string): Promise<unknown> {
  const id = ++nextFetch;
  return new Promise((settle) => {
    // A source that never answers must not hold a refresh open for ever.
    const timer = setTimeout(() => { fetches.delete(id); settle('unreachable'); }, 180_000);
    fetches.set(id, (answer) => { clearTimeout(timer); settle(answer); });
    // `reference`, not `fetch`: the network gate reads a property called fetch
    // as a client reaching the network, and it is right to.
    process.parentPort.postMessage({ reference: { id, url, ...(etag ? { etag } : {}), ...(lastModified ? { lastModified } : {}) } });
  });
}

interface Answer { fresh: boolean; body: Uint8Array; etag: string | null; lastModified: string | null }
function asAnswer(answer: unknown): Answer {
  // Nothing was asked of any server: the credential core was not up yet.
  if ((answer as { notReady?: unknown } | null)?.notReady === true) throw new StorageFailure({ kind: 'pending' });
  const value = answer as Answer | null;
  if (typeof answer === 'string' || !value || typeof value.fresh !== 'boolean') throw new Error('unreachable');
  return value;
}

const fetchArchive = async (url: string): Promise<Buffer> => {
  const answer = asAnswer(await askForReference(url));
  if (!answer.fresh) throw new Error('unreachable');
  return Buffer.from(answer.body);
};

const fetchText = async (url: string, conditional: { etag?: string | null; lastModified?: string | null }) => {
  const answer = asAnswer(await askForReference(url, conditional.etag ?? undefined, conditional.lastModified ?? undefined));
  if (!answer.fresh) return { status: 'unchanged' as const };
  return { status: 'fresh' as const, body: Buffer.from(answer.body).toString('utf8'), etag: answer.etag, lastModified: answer.lastModified };
};

// ---- status -------------------------------------------------------------
let state: Store<typeof stateSchema> | undefined;
let reference: Reference | undefined;
let referenceStatus: ReferenceStatus | undefined;
let refreshing = false;
let failed: string | undefined;

function sizeOf(...files: string[]): number {
  let total = 0;
  for (const file of files) { try { total += statSync(file).size; } catch { /* not there */ } }
  return total;
}

function summary(dataset: DatasetState): DatasetSummary {
  return dataset.state === 'loaded'
    ? { state: 'loaded', fetchedAt: dataset.fetchedAt, rows: dataset.rows, ...(dataset.version ? { version: dataset.version } : {}) }
    : { state: 'not loaded' };
}

function status(): StorageStatus {
  if (failed) return { state: 'failed', folder: root, reason: failed };
  if (!state) return { state: 'starting', folder: root };
  const referenceSize = sizeOf(paths.reference);
  return {
    state: 'ready',
    folder: root,
    sizes: { state: sizeOf(paths.state, `${paths.state}-wal`), reference: referenceSize > 0 ? referenceSize : null },
    ...(referenceStatus ? {
      reference: {
        adif: summary(referenceStatus.adif),
        parks: summary(referenceStatus.pota.parks),
        programs: summary(referenceStatus.pota.programs),
        locations: summary(referenceStatus.pota.locations),
        refreshing
      }
    } : {})
  };
}

const publish = () => process.parentPort.postMessage({ status: status() });

// A source that was never asked for, because the credential core was not up
// yet when storage first asked (the two processes start side by side), is
// asked for again soon: 15 s, doubling, at most every 30 minutes. Only that.
// A request that did reach a server and failed is not retried here: POTA is
// asked at most once a day (QGD-REF-0010), and the next start or the next day's
// refresh asks again.
const RETRY_FIRST_MS = 15_000;
const RETRY_MOST_MS = 30 * 60_000;
let retries = 0;
let retryTimer: NodeJS.Timeout | undefined;

function scheduleRetry(notAsked: boolean): void {
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = undefined; }
  if (!notAsked) { retries = 0; return; }
  const wait = Math.min(RETRY_FIRST_MS * 2 ** retries++, RETRY_MOST_MS);
  retryTimer = setTimeout(() => { retryTimer = undefined; void refresh(); }, wait);
  retryTimer.unref?.();
}

async function refresh(): Promise<void> {
  if (!reference) return;
  refreshing = true;
  publish();
  let notAsked = false;
  try {
    const outcome = await reference.refresh();
    referenceStatus = outcome.status;
    notAsked = [outcome.adif, ...Object.values(outcome.pota)]
      .some((result) => result.state === 'kept' && result.failure.kind === 'pending');
    // Kinds and states only (QGD-ENG-0016): never a message, a path or a value.
    log.info({
      built: outcome.built, deferred: outcome.deferred === true,
      adif: outcome.adif.state, buildFailure: outcome.buildFailure?.kind,
      pota: Object.fromEntries(Object.entries(outcome.pota).map(([list, result]) =>
        [list, result.state === 'kept' ? `kept (${result.failure.kind})` : result.state]))
    }, 'reference data');
  } catch (error) {
    log.warn({ failure: describe(reduce(error, 'build')) }, 'reference refresh failed');
  } finally {
    refreshing = false;
    publish();
    scheduleRetry(notAsked);
  }
}

async function start(): Promise<void> {
  try {
    state = await openState(paths, stateMigrations, appVersion);
    const register = JSON.parse(await readFile(registerFile, 'utf8')) as Register;
    reference = new Reference({ paths, ddl: referenceDdl, register, state, fetchArchive, fetchText });
    referenceStatus = await reference.status();
    log.info({}, 'storage ready');
  } catch (error) {
    failed = 'Storage could not be opened.';
    log.error({ failure: describe(reduce(error, 'open')) }, 'storage could not be opened');
  }
  publish();
  if (!failed) void refresh();
}

function close(): void {
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = undefined; }
  try { reference?.close(); } catch { /* closing what is left */ }
  try { state?.close(); } catch { /* closing what is left */ }
  reference = undefined;
  state = undefined;
}

process.parentPort.on('message', (event) => {
  const data = event.data as { referenceAnswer?: unknown; id?: unknown; command?: unknown; close?: unknown };
  if (data?.referenceAnswer !== null && typeof data?.referenceAnswer === 'object') {
    const { id, result } = data.referenceAnswer as { id?: unknown; result?: unknown };
    if (!Number.isSafeInteger(id)) return;
    const waiting = fetches.get(id as number);
    if (waiting) { fetches.delete(id as number); waiting(result); }
    return;
  }
  if (data?.close === true) {
    // Asked for at quit: every store closed cleanly, so the WAL is checkpointed
    // and nothing is left for the next start to recover.
    close();
    process.parentPort.postMessage({ closed: true });
    return;
  }
  if (!Number.isSafeInteger(data?.id)) return;
  const reply: StorageReply = validateStorageCommand(data.command)
    ? { ok: true, status: status() }
    : { ok: false, error: 'Invalid storage request.' };
  process.parentPort.postMessage({ id: data.id, reply });
});

process.parentPort.postMessage({ ready: true });
void start();
