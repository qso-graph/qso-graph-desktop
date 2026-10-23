// SPDX-License-Identifier: GPL-3.0-only
// How long the callsign service is given to answer one command, and what the
// operator is told when the time runs out.
//
// A table rather than a number, because one number was wrong. Every command
// had 30s and the Keychain's words, and a reference fetch is neither: the
// credential core gives that fetch up to 120s (reference.rs), so a slow but
// perfectly successful fetch was thrown away at 30s — and the operator was
// then told "Keychain did not respond. Check for a macOS permission dialog",
// about a network fetch that raises no dialog and touches no Keychain. Wrong
// twice over, and QGD-PSN-0013 does not permit the second: a message must not
// send someone looking for something that was never there. Found in review.
//
// Pure, and in `callsigns` rather than beside the broker, for one reason: the
// broker imports Electron, and a number no test can read is a number that
// drifts. tests/deadlines.test.mjs reads the core's own 120s out of
// reference.rs and fails if this stops exceeding it.
export interface Deadline {
  readonly ms: number;
  readonly said: string;
}

// Anything that reaches the OS credential store. The wait is for a person:
// macOS may be showing them a permission dialog, and that is what to say.
export const KEYCHAIN_DEADLINE: Deadline = {
  ms: 30_000,
  said: 'Keychain did not respond. Check for a macOS permission dialog, then try again.'
};

// By command type, for the ones the Keychain's deadline does not describe.
export const DEADLINES: Readonly<Record<string, Deadline>> = {
  // Past the core's own 120s ceiling, deliberately, so the core answers first
  // and this deadline is reached only when the core itself is wedged. A reply
  // the broker discarded while the core was still working looked to everyone
  // above like a failed fetch.
  'fetch-reference': {
    ms: 135_000,
    said: 'The reference source did not answer in time.'
  },
  // Past the core's own ceilings, for the same reason: 30s for the feed, two
  // hours for a download (updates.rs).
  'update-feed': {
    ms: 45_000,
    said: 'The update feed did not answer in time.'
  },
  'update-download': {
    ms: 2 * 60 * 60 * 1000 + 60_000,
    said: 'The update did not finish downloading in time.'
  },
  // A lookup is a Keychain read and then TWO sequential HTTPS requests — the
  // session key, then the callsign (validation.rs) — each with its own
  // ceiling. The Keychain's 30s was the wait for one person and no network at
  // all, so a lookup where the operator took a few seconds over the
  // permission dialog and both requests were slow blew through it while
  // everything was working. The broker then threw away the answer that did
  // arrive and told them the Keychain had not responded, which by then was
  // the one thing that had. Found in review.
  //
  // The budget is both requests' ceilings plus the wait for the person, and
  // tests/deadlines.test.mjs adds those up out of the Rust source.
  'service-lookup': {
    ms: 75_000,
    said: 'The lookup did not finish in time. Try again.'
  }
};

export function deadlineFor(type: string): Deadline {
  return DEADLINES[type] ?? KEYCHAIN_DEADLINE;
}
