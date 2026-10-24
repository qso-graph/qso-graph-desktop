// SPDX-License-Identifier: GPL-3.0-only
// The extension limits (QGD-APP-0021, QGD-APP-0022), read from
// data/extension-limits.json and checked whole. A limit that is missing,
// not a whole number or outside a sane range refuses the file, rather than
// running an extension host with no limit at all.
export interface ExtensionLimits {
  readonly requestDeadlineMs: number;
  // A fetch goes to the credential core, whose own ceiling is 120 s, so its
  // deadline sits past that and the core answers first (as deadlines.ts does).
  readonly sourceFetchDeadlineMs: number;
  readonly activateDeadlineMs: number;
  readonly deactivateDeadlineMs: number;
  readonly messageBytes: number;
  readonly inFlight: number;
  readonly heartbeatMs: number;
  readonly heartbeatMisses: number;
  readonly restartBudget: number;
  readonly restartWindowMs: number;
}

const BOUNDS: Readonly<Record<keyof ExtensionLimits, readonly [number, number]>> = {
  requestDeadlineMs: [1_000, 120_000],
  sourceFetchDeadlineMs: [121_000, 300_000],
  activateDeadlineMs: [1_000, 60_000],
  deactivateDeadlineMs: [500, 30_000],
  messageBytes: [16_384, 16_777_216],
  inFlight: [1, 1_024],
  heartbeatMs: [500, 60_000],
  heartbeatMisses: [1, 20],
  restartBudget: [1, 20],
  restartWindowMs: [10_000, 86_400_000]
};

export class LimitsError extends Error {}

export function parseLimits(value: unknown): ExtensionLimits {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new LimitsError('The extension limits are not an object.');
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key !== 'register' && key !== 'note' && !Object.hasOwn(BOUNDS, key)) throw new LimitsError(`The extension limits have a field this core does not know: "${key}".`);
  }
  const limits: Partial<Record<keyof ExtensionLimits, number>> = {};
  for (const [key, [low, high]] of Object.entries(BOUNDS) as [keyof ExtensionLimits, readonly [number, number]][]) {
    const limit = record[key];
    if (!Number.isInteger(limit) || (limit as number) < low || (limit as number) > high) {
      throw new LimitsError(`The extension limit "${key}" is not a whole number from ${low} to ${high}.`);
    }
    limits[key] = limit as number;
  }
  return limits as ExtensionLimits;
}
