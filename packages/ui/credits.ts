// SPDX-License-Identifier: GPL-3.0-only
// What the Privacy and Licences window credits (QGD-FRM-0015, QGD-REP-0005):
// every source of data the application downloads or ships, who it is from,
// and on what terms. tests/credits.test.mjs holds this to the registers that
// name those sources, so a new source cannot arrive without its credit.
export interface Credit {
  // The register key it answers for: data/<register>-sources.json, then key.
  key: string;
  what: string;
  from: string;
  terms: string;
}
// Names, not web addresses: no product source carries a host (QGD-SEC-0020's
// gate), and the operator needs who and on what terms, not a link.

export const CREDITS: readonly Credit[] = [
  { key: 'reference/adif', what: 'ADIF definitions: the fields, modes, bands and entities logs are checked against. Downloaded when you ask.',
    from: 'ADIF Development Group', terms: 'Published for use by logging programs.' },
  { key: 'reference/pota', what: 'POTA parks, programs and locations. Downloaded when you ask.',
    from: 'Parks on the Air', terms: 'Public data, fetched from POTA and never redistributed.' },
  { key: 'reference/sota', what: 'SOTA summits: each summit\'s reference, name, height and position. Downloaded when you ask.',
    from: 'Summits on the Air', terms: 'Public data, fetched from SOTA and never redistributed.' },
  { key: 'noaa', what: 'Solar flux, the K and A indices and the space weather scales, for Conditions.',
    from: 'NOAA Space Weather Prediction Center', terms: 'A work of the US Government, public domain.' },
  { key: 'county/boundaries', what: 'US county boundaries, to find the county a location is in. Ships with the application.',
    from: 'US Census Bureau', terms: 'A work of the US Government, public domain.' },
  { key: 'county/names', what: 'US county names as LoTW accepts them, from TQSL\'s configuration.',
    from: 'ARRL\'s TQSL', terms: 'Names only; TQSL\'s file is not included.' },
  { key: 'county/sections', what: 'ARRL sections and the counties each holds.',
    from: 'ARRL Section Boundaries', terms: 'Section assignments only; ARRL\'s page is not included.' },
  { key: 'icons', what: 'The navigation icons.',
    from: 'Font Awesome Free, by Fonticons, Inc.', terms: 'CC BY 4.0.' }
];
