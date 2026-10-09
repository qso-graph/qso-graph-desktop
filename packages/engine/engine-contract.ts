// SPDX-License-Identifier: GPL-3.0-only
// What the renderer may ask about the engine, and what it is told back.
//
// QGD-SEC-0006 applies here as it does to every other boundary. The renderer
// cannot name a data directory, a backup path or a role: every one of those is
// the frame's, and a command carrying one would be the renderer choosing where
// the database lives.
export const ENGINE_STATES = ['starting', 'running', 'stopped', 'failed', 'unavailable'] as const;
export type EngineState = (typeof ENGINE_STATES)[number];

export interface EngineStatus {
  state: EngineState;
  // The PostgreSQL version in use, once there is one to report.
  version?: string;
  // Why it is not running, in words a person can act on. Never a stack trace
  // and never a path the renderer has no business knowing.
  reason?: string;
}

export type EngineCommand =
  | { type: 'status' }
  | { type: 'start' }
  | { type: 'stop' };

export type EngineReply =
  | { ok: true; status: EngineStatus }
  | { ok: false; error: string };

export function isEngineState(value: unknown): value is EngineState {
  return typeof value === 'string' && (ENGINE_STATES as readonly string[]).includes(value);
}

export function isEngineStatus(value: unknown): value is EngineStatus {
  if (typeof value !== 'object' || value === null) return false;
  const status = value as Record<string, unknown>;
  if (!isEngineState(status.state)) return false;
  if (status.version !== undefined && typeof status.version !== 'string') return false;
  if (status.reason !== undefined && typeof status.reason !== 'string') return false;
  return Object.keys(status).every(key => ['state', 'version', 'reason'].includes(key));
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateEngineCommand(value: unknown): value is EngineCommand {
  if (!record(value)) return false;
  if (!['status', 'start', 'stop'].includes(value.type as string)) return false;
  // Exactly the type and nothing else: a command carrying a path would be the
  // renderer deciding where the database is.
  return Object.keys(value).length === 1;
}
