// SPDX-License-Identifier: GPL-3.0-only
// P8-messages, in part: the limits come from data/extension-limits.json and
// are checked whole (QGD-APP-0021, QGD-APP-0022).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseLimits } from '../packages/main/extension-limits.js';

const shipped = JSON.parse(readFileSync('data/extension-limits.json', 'utf8'));

describe('the extension limits (QGD-APP-0021, QGD-APP-0022)', () => {
  it('reads the shipped register', () => {
    const limits = parseLimits(shipped);
    // The fetch deadline sits past the credential core's own 120 s ceiling.
    expect(limits.sourceFetchDeadlineMs).toBeGreaterThan(120_000);
    expect(limits.heartbeatMs * limits.heartbeatMisses).toBeLessThan(limits.requestDeadlineMs * 2);
  });

  it('refuses a missing, fractional, out-of-range or unknown limit', () => {
    const { inFlight: _gone, ...missing } = shipped;
    expect(() => parseLimits(missing)).toThrowError(/"inFlight" is not a whole number/);
    expect(() => parseLimits({ ...shipped, inFlight: 2.5 })).toThrowError(/"inFlight"/);
    expect(() => parseLimits({ ...shipped, restartBudget: 0 })).toThrowError(/"restartBudget"/);
    expect(() => parseLimits({ ...shipped, sourceFetchDeadlineMs: 60_000 })).toThrowError(/"sourceFetchDeadlineMs"/);
    expect(() => parseLimits({ ...shipped, unlimited: true })).toThrowError(/does not know: "unlimited"/);
    expect(() => parseLimits(null)).toThrowError(/not an object/);
    // Inherited names are not limits: JSON.parse makes them own fields, and
    // an `in` check would have let them through.
    for (const name of ['__proto__', 'constructor', 'toString']) {
      const withName = JSON.parse(JSON.stringify(shipped).replace('{', `{"${name}":1,`));
      expect(() => parseLimits(withName), name).toThrowError(new RegExp(`does not know: "${name}"`));
    }
  });
});
