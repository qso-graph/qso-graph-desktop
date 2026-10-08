// SPDX-License-Identifier: GPL-3.0-only
// Application logging, QGD-LOG-0001 through QGD-LOG-0012.
//
// The decisions — what to rotate, what to remove, which level is in force — are
// pure functions here, so the Verify: Test the specification claims for them is
// a real test rather than a filesystem fixture that only runs on one machine.
// The filesystem and pino sit behind them in a thin layer.

export const LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;
export type Level = (typeof LEVELS)[number];

// QGD-LOG-0009: the default level is info.
export const DEFAULT_LEVEL: Level = 'info';
// QGD-LOG-0006: rotate by size.
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
// QGD-LOG-0007: a hard cap on the whole folder, oldest removed first.
export const MAX_TOTAL_BYTES = 50 * 1024 * 1024;
// QGD-LOG-0008: retention by age.
export const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
// QGD-LOG-0010: a raised level reverts on its own after this long.
export const RAISED_LEVEL_MS = 60 * 60 * 1000;

// QGD-LOG-0003: redaction by field name, in the logger, so that a caller
// cannot forget it. Names rather than values: a value-based filter only
// catches the shapes it was taught, and this has to hold for a secret nobody
// anticipated.
export const REDACTED_FIELDS = [
  'password', 'passphrase', 'apiKey', 'api_key', 'secret', 'token',
  'credential', 'credentials', 'authorization', 'cookie', 'key'
];

// Every place a redacted name can appear in a log record, including one level
// of nesting and the common wrappers.
export function redactionPaths(fields: readonly string[] = REDACTED_FIELDS): string[] {
  const paths: string[] = [];
  for (const field of fields) {
    paths.push(field, `*.${field}`, `*.*.${field}`);
  }
  return paths;
}

export interface LogFile {
  name: string;
  bytes: number;
  modifiedMs: number;
}

export interface PlanOptions {
  // The files that are being written to right now and must not be removed.
  // More than one since QGD-LOG-0011: the engine writes its own, in this same
  // directory, through a process we do not control — deleting the file it has
  // open would lose the records and free nothing.
  //
  // The first is the application's own, and the only one rotation applies to:
  // renaming a file out from under PostgreSQL's collector would leave it
  // writing into the archive, so the engine rotates its own by configuration.
  active: string | readonly string[];
  nowMs: number;
  maxFileBytes?: number;
  maxTotalBytes?: number;
  maxAgeMs?: number;
}

export interface Plan {
  rotate: boolean;
  remove: string[];
}

// QGD-LOG-0006 to QGD-LOG-0008, and QGD-LOG-0011 for the engine's own files,
// which live in the same folder and are therefore under the same caps.
//
// Age first, then the total cap, oldest first. The active file is never
// removed: it is the one being written, and removing it loses the record of
// whatever is happening right now.
export function plan(files: readonly LogFile[], options: PlanOptions): Plan {
  const maxFileBytes = options.maxFileBytes ?? MAX_FILE_BYTES;
  const maxTotalBytes = options.maxTotalBytes ?? MAX_TOTAL_BYTES;
  const maxAgeMs = options.maxAgeMs ?? MAX_AGE_MS;

  const inUse = typeof options.active === 'string' ? [options.active] : options.active;
  const active = files.find(file => file.name === inUse[0]);
  const rotate = active !== undefined && active.bytes >= maxFileBytes;

  const removable = files
    .filter(file => !inUse.includes(file.name))
    .sort((a, b) => a.modifiedMs - b.modifiedMs || a.name.localeCompare(b.name));

  const remove = new Set<string>();
  for (const file of removable) {
    if (options.nowMs - file.modifiedMs >= maxAgeMs) remove.add(file.name);
  }

  let total = files.reduce((sum, file) => sum + file.bytes, 0);
  for (const file of removable) if (remove.has(file.name)) total -= file.bytes;
  for (const file of removable) {
    if (total <= maxTotalBytes) break;
    if (remove.has(file.name)) continue;
    remove.add(file.name);
    total -= file.bytes;
  }

  return { rotate, remove: [...remove] };
}

export interface LevelState {
  level?: string;
  raisedAtMs?: number;
}

export function isLevel(value: unknown): value is Level {
  return typeof value === 'string' && (LEVELS as readonly string[]).includes(value);
}

// QGD-LOG-0010: a raised debug level reverts on its own, after a set time and
// at restart, so it cannot be left on. Both conditions are needed: a time limit
// alone leaves it on for an hour of a session that never ends, and a restart
// rule alone leaves it on for as long as the application stays open.
export function effectiveLevel(
  state: LevelState | undefined,
  nowMs: number,
  startedAtMs: number,
  revertAfterMs: number = RAISED_LEVEL_MS
): Level {
  if (!state || !isLevel(state.level) || state.level === DEFAULT_LEVEL) return DEFAULT_LEVEL;
  // A level less verbose than the default is a quietening, not a raise, and is
  // kept: nothing is hidden by it that the default would have shown.
  if (LEVELS.indexOf(state.level) > LEVELS.indexOf(DEFAULT_LEVEL)) return state.level;
  if (typeof state.raisedAtMs !== 'number' || !Number.isFinite(state.raisedAtMs)) return DEFAULT_LEVEL;
  if (nowMs - state.raisedAtMs >= revertAfterMs) return DEFAULT_LEVEL;
  if (state.raisedAtMs < startedAtMs) return DEFAULT_LEVEL;
  return state.level;
}
