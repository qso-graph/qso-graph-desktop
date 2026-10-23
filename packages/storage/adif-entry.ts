// SPDX-License-Identifier: GPL-3.0-only
// What ADIF Lookup's search answers with, and its bounds (adif-search.ts).
// Apart from the search so the window's contract can name it without
// reaching the store, which runs only in QG Storage.

export const ADIF_RESULTS = 40;
export const ADIF_COLUMNS = 12;
export const ADIF_TEXT = 200;
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
