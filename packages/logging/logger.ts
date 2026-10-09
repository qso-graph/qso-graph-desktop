// SPDX-License-Identifier: GPL-3.0-only
// The filesystem and pino layer behind packages/logging/logging.ts, which holds the
// decisions. QGD-LOG-0001 through QGD-LOG-0011.
//
// One writer. The main process owns the log file, its rotation and its
// retention; every other process serialises its records — already redacted —
// and sends them to main, which appends them. Three processes each holding
// their own descriptor to one path cannot work: whichever rotates first renames
// the file the others are still writing into, and retention then deletes it,
// losing their records silently.
//
// Nothing here may interrupt the application. Every call is guarded, because a
// log line that throws inside a crash handler stops the restart that handler
// exists to perform.
import { mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import {
  DEFAULT_LEVEL, effectiveLevel, isEngineLog, plan, redactionPaths,
  type Level, type LogFile, type LevelState
} from './logging.js';

export const ACTIVE_LOG = 'qg-desktop.log';
const LEVEL_STATE = 'level.json';
const CAPS_INTERVAL_MS = 60_000;
const LEVEL_INTERVAL_MS = 30_000;
const STARTED_AT = Date.now();

// QGD-LOG-0002: the operating system's standard log folder, and nowhere else.
export function logDirectory(): string {
  if (process.env.QG_DESKTOP_LOG_DIR) return process.env.QG_DESKTOP_LOG_DIR;
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Logs', 'QSO Graph Desktop');
  if (process.platform === 'win32') {
    return join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'QSO Graph Desktop', 'Logs');
  }
  return join(process.env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state'), 'qg-desktop', 'logs');
}

function listing(directory: string): LogFile[] {
  const files: LogFile[] = [];
  for (const name of readdirSync(directory)) {
    if (name === LEVEL_STATE) continue;
    try {
      const info = statSync(join(directory, name));
      if (info.isFile()) files.push({ name, bytes: info.size, modifiedMs: info.mtimeMs });
    } catch { /* a file removed under us is not a finding */ }
  }
  return files;
}

// QGD-LOG-0006 to QGD-LOG-0008, and QGD-LOG-0011 for the engine's files, which
// sit in this folder and are therefore under the same caps.
export function enforceCaps(directory: string, nowMs = Date.now()): { rotated: boolean; removed: string[] } {
  let decision;
  try {
    const files = listing(directory);
    decision = plan(files, { active: [ACTIVE_LOG, ...liveEngineLogs(files)], nowMs });
  }
  catch { return { rotated: false, removed: [] }; }
  const removed: string[] = [];
  for (const name of decision.remove) {
    try { unlinkSync(join(directory, name)); removed.push(name); } catch { /* already gone */ }
  }
  if (decision.rotate) {
    const stamp = new Date(nowMs).toISOString().replace(/[:.]/g, '-');
    try { renameSync(join(directory, ACTIVE_LOG), join(directory, `qg-desktop-${stamp}.log`)); }
    catch { return { rotated: false, removed }; }
  }
  return { rotated: decision.rotate, removed };
}

function levelState(directory: string): LevelState | undefined {
  try { return JSON.parse(readFileSync(join(directory, LEVEL_STATE), 'utf8')) as LevelState; }
  catch { return undefined; }
}

// QGD-LOG-0009 and QGD-LOG-0010.
export function currentLevel(directory: string, nowMs = Date.now()): Level {
  return effectiveLevel(levelState(directory), nowMs, STARTED_AT);
}

// QGD-LOG-0013's half of QGD-LOG-0009 and QGD-LOG-0010: the switch that
// writes the level every process then follows.
//
// Written beside and renamed, like the settings file, so a process reading it
// while this runs sees the old state or the new one and never a half-written
// file. The running logger in this process is moved at once rather than at its
// next poll, because a switch that takes effect in half a minute reads as one
// that did not work.
//
// raisedAtMs is recorded only for a raise. effectiveLevel uses it for both
// halves of QGD-LOG-0010 — the hour, and the process start — so a quietening,
// which hides nothing the default would have shown, is simply kept.
export function setLevel(level: Level, directory = logDirectory(), nowMs = Date.now()): boolean {
  try {
    mkdirSync(directory, { recursive: true });
    const state: LevelState = level === DEFAULT_LEVEL ? { level } : { level, raisedAtMs: nowMs };
    const path = join(directory, LEVEL_STATE);
    const temporary = `${path}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(state) + '\n', { mode: 0o600 });
    renameSync(temporary, path);
    if (root && root.directory === directory) root.logger.level = currentLevel(directory, nowMs);
    return true;
  } catch {
    return false;
  }
}

export interface Intervals { capsMs?: number; levelMs?: number }

export interface Logger {
  info(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
  error(fields: Record<string, unknown>, message: string): void;
  debug(fields: Record<string, unknown>, message: string): void;
  stop(): void;
}

const SILENT: Logger = { info() {}, warn() {}, error() {}, debug() {}, stop() {} };

// Every call guarded: a destination can fail at any write, not only at the
// first, and the caller is often in the middle of handling something worse.
function guard(logger: pino.Logger): Logger {
  const at = (level: 'info' | 'warn' | 'error' | 'debug') =>
    (fields: Record<string, unknown>, message: string) => {
      try { logger[level](fields, message); } catch { /* logging never interrupts */ }
    };
  return { info: at('info'), warn: at('warn'), error: at('error'), debug: at('debug'), stop() {} };
}

function options(directory: string): pino.LoggerOptions {
  return {
    level: currentLevel(directory),
    base: { pid: process.pid },
    // QGD-LOG-0003: configured on the logger, by field name, so that no call
    // site can omit it — and here, so a secret is redacted before it is
    // serialised and therefore before it could cross a process boundary.
    redact: { paths: redactionPaths(), censor: '[redacted]' },
    timestamp: pino.stdTimeFunctions.isoTime
  };
}

// QGD-LOG-0011: the engine's logs are in this directory and under these caps,
// but the one PostgreSQL has open is not ours to delete — the records would go
// and the space would not be freed until the collector let go of it. The
// newest is treated as in use; the rest age out like any other archive.
export function liveEngineLogs(files: readonly LogFile[]): string[] {
  const engine = files.filter(file => isEngineLog(file.name));
  if (engine.length === 0) return [];
  const newest = engine.reduce((a, b) => (b.modifiedMs > a.modifiedMs ? b : a));
  return [newest.name];
}

// QGD-LOG-0010: the level is re-read while the process runs, so a raise expires
// on its own rather than only at the next start.
function followLevel(logger: pino.Logger, directory: string, everyMs: number): () => void {
  const timer = setInterval(() => {
    try {
      const level = currentLevel(directory);
      if (logger.level !== level) logger.level = level;
    } catch { /* keep the level we have */ }
  }, everyMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

// The main process: the only writer, and the only process that touches the
// folder. QGD-LOG-0006 to QGD-LOG-0008 are enforced while it runs, not only at
// construction, or a long session grows without bound.
// Rotation and retention applied once, with the writer moved onto the new file
// afterwards. The descriptor follows a rename, so without the reopen the writer
// keeps appending to the file it has just archived — and retention then deletes
// it, taking those records with it.
export function maintain(directory: string, destination: { reopen(): void }): { rotated: boolean; removed: string[] } {
  const result = enforceCaps(directory);
  if (result.rotated) { try { destination.reopen(); } catch { /* ignore */ } }
  return result;
}

export function createLogger(processName: string, directory = logDirectory(), intervals: Intervals = {}): Logger {
  try {
    // One destination and one maintenance timer per process. Several components
    // in the writing process ask for a logger — main and the broker both do —
    // and each opening its own reproduces the race this layer exists to avoid,
    // one process further in: whichever rotates first leaves the other writing
    // into the archive, which retention then deletes.
    if (root && root.directory === directory) return guard(root.logger.child({ process: processName }));
    root?.stop();

    mkdirSync(directory, { recursive: true });
    enforceCaps(directory);
    const destination = pino.destination({ dest: join(directory, ACTIVE_LOG), append: true, sync: true });
    // A destination reports a failed write or a failed reopen asynchronously,
    // where no try/catch around the call can reach it, and pino's default
    // listener rethrows. Routine maintenance must not be able to end the
    // application.
    destination.on?.('error', () => { /* logging never interrupts */ });

    const logger = pino(options(directory), destination);
    forwardTo = line => { try { destination.write(line); } catch { /* ignore */ } };

    const caps = setInterval(() => maintain(directory, destination), intervals.capsMs ?? CAPS_INTERVAL_MS);
    caps.unref?.();
    const stopLevel = followLevel(logger, directory, intervals.levelMs ?? LEVEL_INTERVAL_MS);
    root = { directory, logger, stop() { clearInterval(caps); stopLevel(); } };

    return { ...guard(logger.child({ process: processName })), stop() { root?.stop(); root = undefined; } };
  } catch {
    // Logging must never be the reason the application fails to start.
    return SILENT;
  }
}

// Set by createLogger in the process that owns the file.
let forwardTo: ((line: string) => void) | undefined;
let root: { directory: string; logger: pino.Logger; stop(): void } | undefined;

// Called by the broker when a utility process sends a record.
export function writeForwarded(line: unknown): boolean {
  if (typeof line !== 'string' || !forwardTo) return false;
  forwardTo(line);
  return true;
}

// A utility process: serialises and hands the line to main. It never opens the
// file, so it cannot race the rotation owner.
export function createForwardingLogger(
  processName: string,
  send: (line: string) => void,
  directory = logDirectory(),
  intervals: Intervals = {}
): Logger {
  try {
    const stream = { write(line: string) { try { send(line); } catch { /* ignore */ } } };
    const logger = pino({ ...options(directory), base: { process: processName, pid: process.pid } }, stream);
    const stopLevel = followLevel(logger, directory, intervals.levelMs ?? LEVEL_INTERVAL_MS);
    const guarded = guard(logger);
    return { ...guarded, stop: stopLevel };
  } catch {
    return SILENT;
  }
}
