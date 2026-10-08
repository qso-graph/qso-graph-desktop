// SPDX-License-Identifier: GPL-3.0-only
// What the Logs page may ask for, and what a valid request looks like.
//
// QGD-LOG-0013 puts the surface in Settings; the behaviour it drives is
// QGD-LOG-0009 to QGD-LOG-0012, which already exist. This contract is the
// narrow opening between them, held to QGD-SEC-0006 like every other boundary:
// a command is validated and rejected, never coerced into something near enough.
import { LEVELS, isLevel, type Level } from './logging.js';

export type LogsCommand =
  | { type: 'read' }
  | { type: 'set-level'; level: Level }
  | { type: 'export' };

export interface LogsStatus {
  level: Level;
  // Shown beside the switch so the page can say what reverting means without
  // restating the numbers in two places.
  defaultLevel: Level;
  revertAfterMs: number;
  // The user's own log folder. No secret, and the one thing somebody sending
  // diagnostics always wants to know.
  directory: string;
}

export type LogsReply =
  | { ok: true; kind: 'status'; status: LogsStatus }
  | { ok: true; kind: 'exported'; files: number; bytes: number }
  | { ok: true; kind: 'cancelled' }
  | { ok: false; error: string };

export const LOG_LEVELS = LEVELS;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function keys(value: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(value).every(key => allowed.includes(key));
}

export function validateLogsCommand(value: unknown): value is LogsCommand {
  if (!record(value)) return false;
  switch (value.type) {
    case 'read':
    case 'export':
      return keys(value, ['type']);
    case 'set-level':
      return keys(value, ['type', 'level']) && isLevel(value.level);
    default:
      return false;
  }
}
