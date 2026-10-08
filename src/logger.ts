// SPDX-License-Identifier: GPL-3.0-only
// The filesystem and pino layer behind src/logging.ts, which holds the
// decisions. QGD-LOG-0001, QGD-LOG-0002, QGD-LOG-0005 to QGD-LOG-0011.
import { mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import {
  DEFAULT_LEVEL, effectiveLevel, isLevel, plan, redactionPaths,
  type Level, type LogFile, type LevelState
} from './logging.js';

export const ACTIVE_LOG = 'qg-desktop.log';
const LEVEL_STATE = 'level.json';
const STARTED_AT = Date.now();

// QGD-LOG-0002: the operating system's standard log folder, and nowhere else.
export function logDirectory(): string {
  if (process.env.QG_DESKTOP_LOG_DIR) return process.env.QG_DESKTOP_LOG_DIR;
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Logs', 'QG Desktop');
  if (process.platform === 'win32') {
    return join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'QG Desktop', 'Logs');
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

// QGD-LOG-0006 to QGD-LOG-0008 and QGD-LOG-0011, applied. The engine's own
// files sit in this folder, so the same caps reach them.
export function enforceCaps(directory: string, nowMs = Date.now()): { rotated: boolean; removed: string[] } {
  const decision = plan(listing(directory), { active: ACTIVE_LOG, nowMs });
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

export interface Logger {
  info(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
  error(fields: Record<string, unknown>, message: string): void;
  debug(fields: Record<string, unknown>, message: string): void;
}

// QGD-LOG-0001: one JSON-lines stream, every process writing into it, each
// record naming which process wrote it. QGD-LOG-0003: redaction is configured
// here, on the logger, so no call site can omit it.
export function createLogger(processName: string, directory = logDirectory()): Logger {
  try {
    mkdirSync(directory, { recursive: true });
    enforceCaps(directory);
    return pino({
      level: currentLevel(directory),
      base: { process: processName, pid: process.pid },
      redact: { paths: redactionPaths(), censor: '[redacted]' },
      timestamp: pino.stdTimeFunctions.isoTime
    }, pino.destination({ dest: join(directory, ACTIVE_LOG), append: true, sync: true }));
  } catch {
    // Logging must never be the reason the application fails to start.
    const noop = () => {};
    return { info: noop, warn: noop, error: noop, debug: noop };
  }
}
