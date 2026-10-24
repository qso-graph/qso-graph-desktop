// SPDX-License-Identifier: GPL-3.0-only
// A request that meets a service still starting waits for it, a bounded
// while (KI7MT, 2026-10-22: Conditions said NOAA could not be reached at
// every start, because the credential core was not up yet).
import { describe, expect, it } from 'vitest';
import { untilReady } from '../packages/main/until-ready.js';

function clock() {
  let at = 0;
  return { now: () => at, sleep: async (ms: number) => { at += ms; } };
}

describe('asking a service that may still be starting', () => {
  it('asks again until the service is up, and returns its answer', async () => {
    const answers = ['starting', 'starting', 'starting', 'body'];
    const asked: number[] = [];
    const time = clock();
    const answer = await untilReady(async () => { asked.push(time.now()); return answers.shift()!; },
      value => value === 'starting', { withinMs: 30_000, ...time });
    expect(answer).toBe('body');
    expect(asked).toEqual([0, 100, 300, 700]);
  });

  it('returns an answer that is not "starting" at once, failure included', async () => {
    let asks = 0;
    const answer = await untilReady(async () => { asks += 1; return 'NOAA refused'; }, value => value === 'starting', { withinMs: 30_000, ...clock() });
    expect(answer).toBe('NOAA refused');
    expect(asks).toBe(1);
  });

  it('gives up with "starting" once the time is spent, never waiting past it', async () => {
    const time = clock();
    const answer = await untilReady(async () => 'starting', value => value === 'starting', { withinMs: 5_000, ...time });
    expect(answer).toBe('starting');
    expect(time.now()).toBeLessThanOrEqual(5_000);
  });
});
