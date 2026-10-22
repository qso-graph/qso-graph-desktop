// SPDX-License-Identifier: GPL-3.0-only
// Reading SOTA's summits list (QGD-REF-0018), on made-up summits in SOTA's
// format: nothing of SOTA's is in this repository (QGD-INV-0011).
import { describe, expect, it } from 'vitest';
import { ShapeError } from '../packages/reference/pota.js';
import { SUMMIT_COLUMNS, readSummits } from '../packages/reference/sota.js';

const header = SUMMIT_COLUMNS.join(',');
const row = (code: string, name = 'Example Peak', extra: Partial<Record<string, string>> = {}) => {
  const cells: Record<string, string> = {
    SummitCode: code, AssociationName: 'Test Association', RegionName: 'Test Region', SummitName: name,
    AltM: '2100', AltFt: '6890', GridRef1: '-116.1', GridRef2: '43.7', Longitude: '-116.1', Latitude: '43.7',
    Points: '8', BonusPoints: '3', ValidFrom: '01/07/2010', ValidTo: '31/12/2099',
    ActivationCount: '12', ActivationDate: '01/06/2026', ActivationCall: 'W1AW', ...extra
  };
  return SUMMIT_COLUMNS.map(column => /[",]/.test(cells[column]) ? `"${cells[column].replaceAll('"', '""')}"` : cells[column]).join(',');
};
const list = (...rows: string[]) => ['SOTA Summits List (Date=22/10/2026)', header, ...rows].join('\r\n') + '\r\n';

describe('SOTA\'s summits list', () => {
  it('reads each summit: code, association, region, name, height, position and dates', () => {
    const { summits, counts } = readSummits(list(row('W7I/SI-001', 'Peak, "the" big one'), row('W7I/SI-002')));
    expect(counts).toEqual({ rows: 2, associations: 1 });
    expect(summits[0]).toEqual({
      code: 'W7I/SI-001', association: 'Test Association', region: 'Test Region', name: 'Peak, "the" big one',
      altitudeM: 2100, latitude: 43.7, longitude: -116.1, validFrom: '2010-07-01', validTo: '2099-12-31'
    });
  });

  it('keeps nothing of the activations: no count, no date, no callsign', () => {
    const json = JSON.stringify(readSummits(list(row('W7I/SI-001'))));
    expect(json).not.toContain('W1AW');
    expect(json).not.toContain('2026-06-01');
  });

  it('keeps a retired summit, with its dates', () => {
    expect(readSummits(list(row('W7I/SI-003', 'Old', { ValidTo: '31/12/2015' }))).summits[0].validTo).toBe('2015-12-31');
  });

  it.each([
    ['an empty file', ''],
    ['no title line', [header, row('W7I/SI-001')].join('\n')],
    ['a changed header', list().replace('SummitCode', 'Code')],
    ['a header and no summits', list()],
    ['a row with a field missing', list(row('W7I/SI-001').replace(/,[^,]*$/, ''))],
    ['a summit listed twice', list(row('W7I/SI-001'), row('W7I/SI-001'))],
    ['a code SOTA does not write', list(row('W7I-SI-001'))],
    ['a position that is not a number', list(row('W7I/SI-001', 'X', { Latitude: 'north' }))],
    ['a date SOTA does not write', list(row('W7I/SI-001', 'X', { ValidFrom: '2010-07-01' }))]
  ])('refuses %s', (_what, text) => {
    expect(() => readSummits(text)).toThrow(ShapeError);
  });
});
