// SPDX-License-Identifier: GPL-3.0-only
// A park to activate, as QG Storage answers them (activations.ts): apart from
// the query so the window's contract can name it without reaching the store.

// A park of My Area with POTA's count of its activations (QGD-REF-0019): null
// where POTA publishes null, a park nobody has attempted. Its position is the
// park list's, and only a usable one is sent (QGD-REF-0011).
export interface ActivationPark {
  readonly reference: string;
  readonly name: string;
  readonly latitude: number;
  readonly longitude: number;
  // As POTA publishes it: "US-ID", or "US-ID,US-OR" for a park in two.
  readonly locations: string;
  readonly activations: number | null;
}

// Bounds on what the store sends: ten locations of POTA's largest hold some
// 2,000 parks each, and a name is at most a line.
export const ACTIVATION_PARKS = 20_000;
export const ACTIVATION_TEXT = 200;
