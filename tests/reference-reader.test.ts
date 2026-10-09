// SPDX-License-Identifier: GPL-3.0-only
// The pure half of the reference load: reading a zip, and reading ADIF's
// definitions out of it. The engine suite proves the whole path against a
// running database; these are the cases that are awkward to reach from there
// — a truncated archive, a cell that is neither true nor false, a field
// naming a data type that does not exist.
import { readFile } from 'node:fs/promises';
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { entries, read } from '../src/engine/reference/zip.js';
import {
  definitionsOf, dataTypes, derive, fields, parseEnumerationRef, values, type Definitions
} from '../src/engine/reference/adif.js';

const register = JSON.parse(await readFile('data/reference-sources.json', 'utf8'));
const release = register.adif;
const archive = await readFile(`vendor/.cache/adif-${release.version}.zip`).catch(() => undefined);
const unpacked = await readFile(`vendor/adif/${release.version}/${release.source.definitions}`, 'utf8')
  .catch(() => undefined);
// Both come from `make setup`. The engine suite is the one that fails loudly
// when they are missing; here the archive cases are skipped rather than
// turning every run without a checkout's vendor directory red.
const withArchive = archive && unpacked ? describe : describe.skip;

// A zip written by hand, so the reader's own contract is tested rather than
// one writer's output. Stored and deflated entries, and a central directory
// that is the authority on both.
function zip(files: { name: string; content: Buffer; deflate?: boolean }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const payload = file.deflate ? deflateRawSync(file.content) : file.content;
    const name = Buffer.from(file.name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(file.deflate ? 8 : 0, 8);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(file.content.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, payload);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(file.deflate ? 8 : 0, 10);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(file.content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + payload.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

describe('QGD-REF-0003 reading an archive', () => {
  const hello = Buffer.from('hello, world'.repeat(40));

  it('reads a stored entry and a deflated one', () => {
    const made = zip([
      { name: 'a/plain.txt', content: hello },
      { name: 'a/squashed.txt', content: hello, deflate: true }
    ]);
    expect(entries(made).map(entry => entry.name)).toEqual(['a/plain.txt', 'a/squashed.txt']);
    expect(entries(made).map(entry => entry.method)).toEqual([0, 8]);
    expect(read(made, 'a/plain.txt').equals(hello)).toBe(true);
    expect(read(made, 'a/squashed.txt').equals(hello)).toBe(true);
  });

  it('names the file it was asked for and has not got', () => {
    expect(() => read(zip([{ name: 'a.txt', content: hello }]), 'b.txt'))
      .toThrow(/b\.txt is not in the archive/);
  });

  it('refuses something that is not a zip at all', () => {
    expect(() => entries(Buffer.from('this is not a zip, it is a sentence')))
      .toThrow(/not a zip archive/);
  });

  it('refuses an archive whose entry is shorter than the directory promised', () => {
    // The failure that matters: a reader returning short content is how a
    // definitions file parses and turns out to hold half of ADIF.
    const made = zip([{ name: 'a.txt', content: hello }]);
    const truncated = Buffer.concat([made.subarray(0, 30 + 5 + 10), made.subarray(30 + 5 + hello.length)]);
    expect(() => read(truncated, 'a.txt')).toThrow();
  });

  it('refuses an archive whose central directory is short', () => {
    const made = zip([{ name: 'a.txt', content: hello }]);
    // Claim two entries where there is one.
    made.writeUInt16LE(2, made.length - 22 + 10);
    expect(() => entries(made)).toThrow(/ends after 1 of 2 entries/);
  });
});

withArchive("ADIF's own archive", () => {
  it('reads the definitions byte-for-byte as unzip wrote them', () => {
    expect(read(archive!, release.source.definitions).toString('utf8')).toBe(unpacked);
  });

  it('holds the test QSOs the register names', () => {
    expect(read(archive!, release.source.testQsos).toString('utf8')).toMatch(/<eor>/i);
  });
});

const sample: Definitions = {
  Version: '3.1.7', Status: 'Released',
  DataTypes: {
    Header: ['Data Type Name'],
    Records: {
      Enumeration: { 'Data Type Name': 'Enumeration', Description: 'a list' },
      CreditList: { 'Data Type Name': 'CreditList', Description: 'credits' },
      AwardList: { 'Data Type Name': 'AwardList', Description: 'awards' }
    }
  },
  Enumerations: {
    Mode: { Header: ['Mode'], Records: { AM: { Mode: 'AM' }, FOO: { Mode: 'FOO', 'Import-only': 'true' } } },
    Primary_Administrative_Subdivision: {
      Header: ['Code', 'DXCC Entity Code', 'CQ Zone', 'ITU Zone'],
      Records: {
        'NS.1': { Code: 'NS', 'DXCC Entity Code': '1', 'CQ Zone': '05', 'ITU Zone': '09' },
        'XX.1': { Code: 'XX', 'DXCC Entity Code': '1', 'CQ Zone': '04,05', 'ITU Zone': '07/08' },
        'YY.2': { Code: 'YY', 'DXCC Entity Code': '2' }
      }
    }
  },
  Fields: {
    Header: ['Field Name'],
    Records: {
      MODE: { 'Field Name': 'MODE', 'Data Type': 'Enumeration', Enumeration: 'Mode', Description: 'mode' },
      STATE: {
        'Field Name': 'STATE', 'Data Type': 'Enumeration',
        Enumeration: 'Primary_Administrative_Subdivision[DXCC]', Description: 'state'
      },
      CREDIT_GRANTED: {
        'Field Name': 'CREDIT_GRANTED', 'Data Type': 'CreditList,AwardList', Description: 'credits'
      }
    }
  }
};

describe('QGD-REF-0004 reading the definitions', () => {
  it('refuses something that is not an ADIF export', () => {
    expect(() => definitionsOf({ hello: true })).toThrow(/not an ADIF definitions export/);
    expect(() => definitionsOf({ Adif: { Version: '3.1.7' } })).toThrow(/not an ADIF definitions export/);
  });

  it('keeps a published data type cell whole and resolves the names in it', () => {
    const credit = fields(sample).find(row => row.name === 'CREDIT_GRANTED')!;
    expect(credit.dataType).toBe('CreditList,AwardList');
    expect(credit.dataTypes).toEqual(['CreditList', 'AwardList']);
  });

  it('refuses a field naming a data type ADIF does not define', () => {
    const broken = structuredClone(sample);
    broken.Fields.Records.MODE['Data Type'] = 'NoSuchType';
    expect(() => fields(broken)).toThrow(/names data type "NoSuchType"/);
  });

  it('splits a parameterised enumeration reference and keeps the whole of it', () => {
    expect(parseEnumerationRef('Primary_Administrative_Subdivision[DXCC]')).toEqual({
      ref: 'Primary_Administrative_Subdivision[DXCC]',
      name: 'Primary_Administrative_Subdivision',
      parameter: 'DXCC'
    });
    expect(parseEnumerationRef('Mode')).toEqual({ ref: 'Mode', name: 'Mode', parameter: null });
    // QGD-REF-0006: a field that names no enumeration says so with nulls.
    expect(parseEnumerationRef(undefined)).toEqual({ ref: null, name: null, parameter: null });
  });

  it('refuses a flag cell that is neither true nor false', () => {
    const broken = structuredClone(sample);
    broken.Fields.Records.MODE['Import-only'] = 'maybe';
    expect(() => fields(broken)).toThrow(/holds "maybe"/);
    const other = structuredClone(sample);
    other.DataTypes.Records.Enumeration['Import-only'] = '1';
    expect(() => dataTypes(other)).toThrow(/holds "1"/);
  });

  it('keeps every published column of a value', () => {
    const row = values(sample).find(entry => entry.key === 'FOO')!;
    expect(row.value).toEqual({ Mode: 'FOO', 'Import-only': 'true' });
    expect(row.importOnly).toBe(true);
  });
});

describe('QGD-REF-0015 what the zone derivation reaches', () => {
  const derived = derive(sample);

  it('counts a subdivision that straddles two zones in both', () => {
    const cq = derived.zones.filter(zone => zone.kind === 'cq');
    expect(cq.map(zone => zone.number)).toEqual([4, 5]);
    expect(cq.find(zone => zone.number === 5)!.subdivisions).toBe(2);
  });

  it('records a cell it cannot read rather than skipping it', () => {
    expect(derived.uninterpreted).toEqual([{
      relation: 'Primary_Administrative_Subdivision',
      key: 'XX.1',
      column: 'ITU Zone',
      cell: '07/08',
      note: expect.stringContaining('07/08')
    }]);
    // And nothing was invented from it: 7 and 8 are not zones here.
    expect(derived.zones.filter(zone => zone.kind === 'itu').map(zone => zone.number)).toEqual([9]);
  });

  it('measures how far the derivation reaches', () => {
    expect(derived.coverage).toEqual({ subdivisions: 3, withZone: 2, entities: 1 });
  });

  it('refuses to derive when the column is gone', () => {
    const broken = structuredClone(sample);
    broken.Enumerations.Primary_Administrative_Subdivision.Header = ['Code'];
    expect(() => derive(broken)).toThrow(/no longer carries "CQ Zone"/);
  });

  it('names the authority, which is never ADIF', () => {
    for (const zone of derived.zones) expect(zone.authority).not.toMatch(/ADIF/);
    expect(derived.zones.find(zone => zone.kind === 'cq')!.authority).toBe('CQ Magazine');
  });
});
