// SPDX-License-Identifier: GPL-3.0-only
// My Area's choices, as QG Storage answers them (area.ts). Apart from the
// queries so the window's contract can name them without reaching the store.
//
// My Area follows POTA's own three levels (KI7MT, 2026-10-23: "They know this
// data better than we do"): a program (IT, Italy), an entity, which is a DXCC
// entity by POTA's numbering (291, the United States; 6, Alaska), and a
// location (US-ID, Idaho). Any of them may be chosen, and each is downloaded
// with one request.

// A POTA program with its entities and their locations, as the tree shows
// them: United States, then Alaska, then Alaska's location.
export interface AreaLocation { readonly code: string; readonly name: string }
export interface AreaEntity { readonly id: string; readonly name: string; readonly locations: readonly AreaLocation[] }
export interface AreaProgram { readonly prefix: string; readonly name: string; readonly entities: readonly AreaEntity[] }

// Bounds on what the store sends: POTA has some 250 programs, 4,000
// locations, and at most 6 entities in a program; these sit well past each.
export const AREA_PROGRAMS = 400;
export const AREA_ENTITIES = 20;
export const AREA_LOCATIONS = 1000;

// How each level is written in My Area, and in a download's cache name. A
// location is a program prefix and a part; an entity is POTA's number; a
// program is its prefix, which always holds a letter (none of POTA's 249 is
// all digits), so the three never read as one another.
export const AREA_LOCATION = /^[A-Z0-9]{1,4}-[A-Z0-9]{1,8}$/;
export const AREA_ENTITY = /^[0-9]{1,3}$/;
export const AREA_PROGRAM = /^(?=[0-9]*[A-Z])[A-Z0-9]{1,4}$/;
export type AreaKind = 'location' | 'entity' | 'program';

export function areaKind(entry: string): AreaKind | undefined {
  if (AREA_LOCATION.test(entry)) return 'location';
  if (AREA_ENTITY.test(entry)) return 'entity';
  if (AREA_PROGRAM.test(entry)) return 'program';
  return undefined;
}

export const isAreaEntry = (value: unknown): value is string => typeof value === 'string' && areaKind(value) !== undefined;
