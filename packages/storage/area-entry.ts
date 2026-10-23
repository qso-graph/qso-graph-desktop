// SPDX-License-Identifier: GPL-3.0-only
// My Area's choices, as QG Storage answers them (area.ts). Apart from the
// queries so the window's contract can name them without reaching the store.

// A POTA program and its locations, as the tree shows them: United States,
// then Idaho (US-ID).
export interface AreaLocation { readonly code: string; readonly name: string }
export interface AreaProgram { readonly prefix: string; readonly name: string; readonly locations: readonly AreaLocation[] }

// Bounds on what the store sends: POTA has some 250 programs and 4,000
// locations, and these sit well past both.
export const AREA_PROGRAMS = 400;
export const AREA_LOCATIONS = 1000;
