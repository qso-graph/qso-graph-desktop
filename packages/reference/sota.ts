// SPDX-License-Identifier: GPL-3.0-only
// Reading SOTA's summits list (QGD-REF-0018).
//
// One CSV, published daily: a title line ("SOTA Summits List (Date=…)"), then
// a header, then one row per summit, about 182,000 of them. Like POTA's lists
// it is read here, shape-checked before it may replace anything, and stored as
// published (QGD-REF-0011): a retired summit is kept with its dates, so an old
// log still finds it, and only offered for a new location while it is valid.
//
// Kept: the code, association, region, name, height in metres, position and
// the dates it is valid between. Left out: the points, which are SOTA's
// scoring, and the activation count, date and callsign, which change daily
// and name other operators (KI7MT, 2026-10-22: never a source of other
// people's data).
import { ShapeError, parseCsv } from './pota.js';

export interface Summit {
  code: string;
  association: string;
  region: string;
  name: string;
  altitudeM: number | null;
  latitude: number;
  longitude: number;
  // ISO dates, from SOTA's dd/mm/yyyy.
  validFrom: string;
  validTo: string;
}

export const SUMMIT_COLUMNS = [
  'SummitCode', 'AssociationName', 'RegionName', 'SummitName', 'AltM', 'AltFt', 'GridRef1', 'GridRef2',
  'Longitude', 'Latitude', 'Points', 'BonusPoints', 'ValidFrom', 'ValidTo', 'ActivationCount', 'ActivationDate',
  'ActivationCall'
] as const;

// A summit reference, as SOTA writes it: W7I/SI-001, G/LD-001, 3B8/MU-001.
export const SUMMIT_CODE = /^[0-9A-Z]{1,4}[0-9A-Z]{0,3}\/[0-9A-Z]{2}-[0-9]{3}$/;

export interface SummitList {
  summits: Summit[];
  counts: { rows: number; associations: number };
}

function isoDate(cell: string | undefined): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(cell ?? '');
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
}

export function readSummits(csv: string, expected: readonly string[] = SUMMIT_COLUMNS): SummitList {
  const rows = parseCsv(csv);
  if (rows.length === 0) throw new ShapeError('the summits list is empty');
  // The title line first, then the header.
  if (!/^SOTA Summits List/.test(rows[0]?.[0] ?? '')) throw new ShapeError('the summits list has no title line');
  const header = rows[1] ?? [];
  if (header.length !== expected.length || header.some((name, at) => name !== expected[at])) {
    throw new ShapeError(`the summits list's columns are ${header.join(', ')}; expected ${expected.join(', ')}`);
  }
  const at = Object.fromEntries(expected.map((name, index) => [name, index])) as Record<string, number>;
  const body = rows.slice(2).filter(row => !(row.length === 1 && row[0] === ''));
  if (body.length === 0) throw new ShapeError('the summits list has a header and no summits');
  const seen = new Set<string>();
  const associations = new Set<string>();
  const summits: Summit[] = body.map((row, index) => {
    if (row.length !== expected.length) throw new ShapeError(`summit row ${index + 1} has ${row.length} fields`);
    const code = row[at.SummitCode] ?? '';
    if (!SUMMIT_CODE.test(code)) throw new ShapeError(`summit row ${index + 1} has a code SOTA does not write`);
    if (seen.has(code)) throw new ShapeError(`summit ${code} is listed twice`);
    seen.add(code);
    const latitude = Number(row[at.Latitude]);
    const longitude = Number(row[at.Longitude]);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) throw new ShapeError(`summit ${code} has no position`);
    const validFrom = isoDate(row[at.ValidFrom]);
    const validTo = isoDate(row[at.ValidTo]);
    if (!validFrom || !validTo) throw new ShapeError(`summit ${code} has dates SOTA does not write`);
    const height = Number(row[at.AltM]);
    associations.add(row[at.AssociationName] ?? '');
    return {
      code, association: row[at.AssociationName] ?? '', region: row[at.RegionName] ?? '', name: row[at.SummitName] ?? '',
      altitudeM: row[at.AltM] !== '' && Number.isFinite(height) ? height : null,
      latitude, longitude, validFrom, validTo
    };
  });
  return { summits, counts: { rows: summits.length, associations: associations.size } };
}
