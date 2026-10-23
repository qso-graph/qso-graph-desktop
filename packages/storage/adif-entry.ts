// SPDX-License-Identifier: GPL-3.0-only
// What ADIF Lookup's search answers with, and its bounds (adif-search.ts).
// Apart from the search so the window's contract can name it without
// reaching the store, which runs only in QG Storage.

export const ADIF_RESULTS = 40;
export const ADIF_COLUMNS = 12;
// Above any text ADIF publishes (3.1.7's longest is 634 characters, the
// description of MY_GRIDSQUARE_EXT): a bound on what the store sends, never
// a cut of ADIF's text (Codex review, 2026-10-23).
export const ADIF_TEXT = 1000;
export const ADIF_QUERY = 64;

// One of ADIF's bands, with its edges as ADIF gives them (Band enumeration),
// so an extension names a frequency's band by ADIF and never by a table of
// its own (KI7MT: ADIF definitions, never home-made).
export interface AdifBand {
  readonly band: string;
  readonly lowerMHz: number;
  readonly upperMHz: number;
}

// One thing ADIF defines: a field, or a value of one of its enumerations.
export interface AdifEntry {
  // 'Field', or the enumeration's own name (Mode, Band, DXCC_Entity_Code…).
  readonly list: string;
  readonly key: string;
  // ADIF's columns for it, in ADIF's order, the empty ones left out.
  readonly columns: readonly { readonly name: string; readonly value: string }[];
}

// A whole enumeration, as ADIF Lookup shows it when its name is typed
// (#58): ADIF's own columns in ADIF's order, those empty in every row and
// the list's own name left out, and every value. The longest, Primary
// Administrative Subdivision, has 1,965 values and 10 such columns.
export interface AdifList {
  readonly name: string;
  readonly columns: readonly string[];
  readonly rows: readonly (readonly string[])[];
}
export const ADIF_LIST_ROWS = 3000;
export const ADIF_LIST_COLUMNS = 12;
