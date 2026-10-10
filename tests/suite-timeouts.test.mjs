// SPDX-License-Identifier: GPL-3.0-only
// A suite's outer bound must clear the waits inside it.
//
// The defect this is a control on: `make verify` killed every suite at a flat
// 120s, while electron-smoke waits 705s in total and electron-audit 300s. A
// suite killed by the runner is not a suite that failed, and the report cannot
// tell them apart.
//
// Derived, not listed. Each suite's own `timeout:` and `timeout: N_000` waits
// are read out of its source, so adding or raising a wait inside a suite fails
// here rather than silently overrunning the runner — the same rule as
// QGD-SEC-0021, where a scope is derived and never a list to remember.
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SUITE_TIMEOUT_MS, SUITE_TIMEOUT_MS, suiteCommands, suiteTimeout
} from '../scripts/suites.mjs';

// `timeout: 150_000`, `{ timeout: 15_000 }`, `timeout: 30000`.
const WAITS = /timeout:\s*([\d_]+)/g;

// The sum, not the longest.
//
// The longest alone is not the worst case: electron-smoke holds nineteen
// waits, the largest 180s and the total 705s, so a bound that merely clears
// the biggest single wait still kills it. If every wait falls due in turn, the
// suite needs their sum — an overestimate where the waits are alternatives,
// which is the safe direction for a ceiling.
const waitBudget = async file => {
  let text;
  try { text = await readFile(file, 'utf8'); } catch { return 0; }
  return [...text.matchAll(WAITS)]
    .map(match => Number(match[1].replace(/_/g, '')))
    .reduce((total, wait) => total + wait, 0);
};

describe('the runner bound on each suite', () => {
  it('clears the waits written inside that suite, added up', async () => {
    const thin = [];
    for (const [name, args] of suiteCommands('npm')) {
      // Only the suites that are a script of ours; an npm script's waits live
      // in whatever it runs and are covered by that script's own entry.
      const script = args.find(arg => typeof arg === 'string' && arg.startsWith('scripts/'));
      if (!script) continue;
      const budget = await waitBudget(script);
      if (budget === 0) continue;
      const outer = suiteTimeout(name);
      // Strictly greater: a bound equal to the budget kills the suite at the
      // moment its last wait comes due, with nothing left for the work.
      if (outer <= budget) thin.push(`${name}: waits total ${budget}ms, killed at ${outer}ms`);
    }
    expect(thin, 'each of these is killed by the runner before its own wait can finish').toEqual([]);
  });

  it('names only suites that are really in the run', () => {
    // A timeout for a suite that no longer exists is a number nobody is
    // reading, and the next person reads it as live.
    const names = suiteCommands('npm').map(([name]) => name);
    for (const name of Object.keys(SUITE_TIMEOUT_MS)) {
      expect(names, `${name} has a timeout but is not a suite`).toContain(name);
    }
  });

  it('leaves the default where nothing asked for more', () => {
    expect(suiteTimeout('a-suite-that-does-not-exist')).toBe(DEFAULT_SUITE_TIMEOUT_MS);
    expect(suiteTimeout('electron-smoke')).toBeGreaterThan(DEFAULT_SUITE_TIMEOUT_MS);
  });
});
