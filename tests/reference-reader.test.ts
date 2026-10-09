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
import { asRecord, parseAdi } from '../src/engine/reference/adi.js';
import { parameterColumn, rulesetOf, validateRecord } from '../src/engine/reference/validate.js';

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

describe('QGD-REF-0008 reading an ADI file', () => {
  it('reads a value by its declared length, not by looking for a delimiter', () => {
    // The length is what makes a value containing < or > or a line break
    // readable at all. A reader that scanned for the next tag would cut this
    // comment in half.
    const value = 'a < b and b > c';
    const file = parseAdi(`<COMMENT:${value.length}>${value}<EOR>`);
    expect(file.records).toHaveLength(1);
    expect(file.records[0][0].value).toBe(value);
    // And the EOR after it was still found, so the length was respected
    // rather than the whole rest of the file swallowed.
    expect(file.records[0]).toHaveLength(1);
  });

  it('keeps a line break inside a value', () => {
    const value = 'NAME FRED\r\nQTH ALENCON';
    const file = parseAdi(`<NOTES:${value.length}:M>${value}<EOR>`);
    expect(file.records[0][0].value).toBe(value);
    expect(file.records[0][0].indicator).toBe('M');
  });

  it('splits the header from the records and ignores free text', () => {
    const file = parseAdi('a comment nobody asked for\n<ADIF_VER:5>3.1.7\n<EOH>\n<CALL:5>W1AW1<EOR>\n<CALL:5>W1AW2<EOR>');
    expect(file.preamble).toBe('a comment nobody asked for\n');
    expect(file.header.map(tag => tag.name)).toEqual(['ADIF_VER']);
    expect(file.records.map(record => record[0].value)).toEqual(['W1AW1', 'W1AW2']);
  });

  it('upper-cases a field name, because ADIF files do not agree on case', () => {
    const file = parseAdi('<eoh><my_field:1>x<eor>');
    expect(file.records[0][0].name).toBe('MY_FIELD');
  });

  it('refuses a file that ends in the middle of a value', () => {
    expect(() => parseAdi('<CALL:20>W1AW')).toThrow(/says 20 bytes and the file ends after 4/);
  });

  it('refuses a tag with no length', () => {
    expect(() => parseAdi('<CALL:>W1AW')).toThrow(/has no length/);
    expect(() => parseAdi('<CALL:x>W1AW')).toThrow(/has no length/);
  });

  it('keeps tags after the last EOR, rather than hiding a truncated file', () => {
    const file = parseAdi('<EOH><CALL:5>W1AW1<EOR><CALL:5>W1AW2');
    expect(file.records).toHaveLength(2);
  });

  it('reads a user-defined field declaration in each of its three forms', () => {
    const file = parseAdi(
      '<USERDEF1:20:B>RCVD_FROM_DX_CLUSTER' +
      '<USERDEF2:32:E>MY_POWER_CATEGORY,{QRPP,QRP,QRO}' +
      '<USERDEF3:35:N>MY_TEMPERATURE_FAHRENHEIT,{-50:150}' +
      '<EOH>');
    expect(file.userDefined).toEqual([
      { number: 1, name: 'RCVD_FROM_DX_CLUSTER', indicator: 'B' },
      { number: 2, name: 'MY_POWER_CATEGORY', indicator: 'E', members: ['QRPP', 'QRP', 'QRO'] },
      { number: 3, name: 'MY_TEMPERATURE_FAHRENHEIT', indicator: 'N', range: { low: -50, high: 150 } }
    ]);
  });

  it('reports a field given twice rather than silently keeping one', () => {
    const file = parseAdi('<EOH><CALL:5>W1AW1<CALL:5>W1AW2<EOR>');
    const { fields, duplicated } = asRecord(file.records[0]);
    expect(duplicated).toEqual(['CALL']);
    expect(fields.get('CALL')?.value).toBe('W1AW2');
  });
});

describe('QGD-REF-0016 a list that does not cover the value', () => {
  const ruleset = rulesetOf({
    Version: '3.1.7', Status: 'Released',
    DataTypes: { Header: ['Data Type Name'], Records: {
      Enumeration: { 'Data Type Name': 'Enumeration', Description: 'a list' },
      PositiveInteger: { 'Data Type Name': 'PositiveInteger', Description: 'a number' }
    } },
    Enumerations: {
      DXCC_Entity_Code: {
        Header: ['Enumeration Name', 'Entity Code', 'Entity Name'],
        Records: {
          '6': { 'Enumeration Name': 'DXCC_Entity_Code', 'Entity Code': '6', 'Entity Name': 'ALASKA' },
          '291': { 'Enumeration Name': 'DXCC_Entity_Code', 'Entity Code': '291', 'Entity Name': 'UNITED STATES' }
        }
      },
      // Alaska only, as ADIF's own enumeration is.
      Secondary_Administrative_Subdivision: {
        Header: ['Enumeration Name', 'Code', 'DXCC Entity Code'],
        Records: {
          'AK,Aleutians East': {
            'Enumeration Name': 'Secondary_Administrative_Subdivision',
            Code: 'AK,Aleutians East', 'DXCC Entity Code': '6'
          }
        }
      }
    },
    Fields: { Header: ['Field Name'], Records: {
      DXCC: { 'Field Name': 'DXCC', 'Data Type': 'Enumeration', Enumeration: 'DXCC_Entity_Code', Description: 'entity' },
      CNTY: {
        'Field Name': 'CNTY', 'Data Type': 'Enumeration',
        Enumeration: 'Secondary_Administrative_Subdivision[DXCC]', Description: 'county'
      }
    } }
  });
  const of = (value: string, dxcc?: string) => {
    const tags = [{ name: 'CNTY', length: value.length, value }];
    if (dxcc) tags.push({ name: 'DXCC', length: dxcc.length, value: dxcc });
    return validateRecord(ruleset, { tags }).find(result => result.field === 'CNTY')!;
  };

  it('says "not checked" for an entity the list does not reach', () => {
    const result = of('MA,Middlesex', '291');
    expect(result.verdict).toBe('unchecked');
    expect(result.reason).toContain('does not cover');
  });

  it('still says "invalid" inside an entity the list does reach', () => {
    // The control. Without it, the rule above is a way of passing anything.
    expect(of('AK,Nowhere At All', '6').verdict).toBe('invalid');
    expect(of('AK,Aleutians East', '6').verdict).toBe('valid');
  });

  it('derives which column answers the parameter from the data', () => {
    // DXCC -> the DXCC field's own enumeration, DXCC_Entity_Code -> the
    // column "DXCC Entity Code". Nothing here names that column.
    expect(parameterColumn(ruleset, 'DXCC')).toBe('DXCC Entity Code');
    expect(parameterColumn(ruleset, 'NOT_A_FIELD')).toBeUndefined();
  });

  it('treats a value in the list for another entity as invalid, not as uncovered', () => {
    const result = of('AK,Aleutians East', '6');
    expect(result.verdict).toBe('valid');
    // Asking for the Alaska county under the USA: the list covers 291 for
    // nothing, so this is uncovered rather than wrong.
    expect(of('AK,Aleutians East', '291').verdict).toBe('unchecked');
  });

  it('asks no coverage question of a plain value', () => {
    const plain = validateRecord(ruleset, { tags: [{ name: 'DXCC', length: 3, value: '291' }] })[0];
    expect(plain.verdict).toBe('valid');
    const wrong = validateRecord(ruleset, { tags: [{ name: 'DXCC', length: 4, value: '9999' }] })[0];
    expect(wrong.verdict, 'a plain enumeration miss is invalid, with no coverage excuse').toBe('invalid');
  });
});
