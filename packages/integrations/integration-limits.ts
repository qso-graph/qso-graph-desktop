// SPDX-License-Identifier: GPL-3.0-only
// The integration limits (QGD-INT-0007, QGD-INT-0009), read from
// data/integration-limits.json and checked whole. A limit that is missing,
// not a whole number or outside a sane range refuses the file, rather than
// listening with no limit at all.
export interface IntegrationLimits {
  readonly maxDatagramBytes: number;
  readonly perSecond: number;
  readonly burst: number;
  readonly queueLength: number;
  readonly repliesPerMinute: number;
}

const BOUNDS: Readonly<Record<keyof IntegrationLimits, readonly [number, number]>> = {
  // No larger than a UDP datagram can be.
  maxDatagramBytes: [512, 65_507],
  perSecond: [1, 10_000],
  burst: [1, 100_000],
  queueLength: [16, 65_536],
  repliesPerMinute: [1, 60]
};

export class IntegrationLimitsError extends Error {}

export function parseIntegrationLimits(value: unknown): IntegrationLimits {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new IntegrationLimitsError('The integration limits are not an object.');
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key !== 'register' && key !== 'note' && !Object.hasOwn(BOUNDS, key)) throw new IntegrationLimitsError(`The integration limits have a field this core does not know: "${key}".`);
  }
  const limits: Partial<Record<keyof IntegrationLimits, number>> = {};
  for (const [key, [low, high]] of Object.entries(BOUNDS) as [keyof IntegrationLimits, readonly [number, number]][]) {
    const limit = record[key];
    if (!Number.isInteger(limit) || (limit as number) < low || (limit as number) > high) {
      throw new IntegrationLimitsError(`The integration limit "${key}" is not a whole number from ${low} to ${high}.`);
    }
    limits[key] = limit as number;
  }
  return limits as IntegrationLimits;
}
