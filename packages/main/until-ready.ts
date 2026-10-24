// SPDX-License-Identifier: GPL-3.0-only
// Asking a service that may still be starting.
//
// Every outbound request goes through the credential core (QGD-SEC-0020), and
// at a start Home asks its cards before that core is up. The answer then was
// "the callsign service is starting", the card said "NOAA could not be
// reached" although nothing had asked NOAA, and it said so until its next
// refresh fifteen minutes later (KI7MT, 2026-10-22). So a request that meets
// a service still starting waits for it, a bounded while, and only a service
// that has not come up in that time is a failure.
export interface UntilReadyOptions {
  // How long to keep asking, in all.
  withinMs: number;
  // The first wait between asks; each wait doubles, up to a second.
  firstWaitMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export async function untilReady<T>(
  ask: () => Promise<T>, starting: (answer: T) => boolean, options: UntilReadyOptions
): Promise<T> {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>(settle => setTimeout(settle, ms)));
  const now = options.now ?? Date.now;
  const until = now() + options.withinMs;
  let wait = options.firstWaitMs ?? 100;
  for (;;) {
    const answer = await ask();
    if (!starting(answer) || now() + wait > until) return answer;
    await sleep(wait);
    wait = Math.min(wait * 2, 1000);
  }
}
