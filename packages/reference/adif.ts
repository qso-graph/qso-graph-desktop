// SPDX-License-Identifier: GPL-3.0-only
// Reading ADIF's published definitions into the shapes the tables hold.
//
// QGD-REF-0004: what is loaded is ADIF's own structure — every data type,
// every enumeration and every field in the archive, counted from the archive
// rather than against a list kept in this repository. Nothing here knows how
// many of anything there should be; it reads what is there, and the suite
// compares the two counts.
//
// Pure, so it can be tested without a database: the functions take parsed
// JSON and return rows. Putting them into PostgreSQL is load.ts.

// The archive's own shape. ADIF publishes every cell as a string, including
// the booleans ("true") and the numbers ("05"), and the columns differ per
// enumeration — so a row is a bag of strings and this does not pretend
// otherwise.
export type Row = Record<string, string>;

export interface Definitions {
  Version: string;
  Status: string;
  Date?: string;
  Created?: string;
  DataTypes: { Header: string[]; Records: Record<string, Row> };
  Enumerations: Record<string, { Header: string[]; Records: Record<string, Row> }>;
  Fields: { Header: string[]; Records: Record<string, Row> };
}

export function definitionsOf(parsed: unknown): Definitions {
  const adif = (parsed as { Adif?: Definitions })?.Adif;
  if (!adif?.Version || !adif.Fields?.Records || !adif.Enumerations || !adif.DataTypes?.Records) {
    throw new Error('that is not an ADIF definitions export');
  }
  return adif;
}

// ADIF's "true" and nothing else. An absent cell is false, and a cell holding
// something other than "true" is a surprise worth refusing rather than
// quietly reading as false — these decide whether a value may be written.
function flag(cell: string | undefined, where: string): boolean {
  if (cell === undefined || cell === '') return false;
  if (cell.toLowerCase() === 'true') return true;
  if (cell.toLowerCase() === 'false') return false;
  throw new Error(`${where} holds "${cell}", which is neither true nor false`);
}

function text(cell: string | undefined): string | null {
  return cell === undefined || cell === '' ? null : cell;
}

export interface DataTypeRow {
  name: string; indicator: string | null; description: string;
  minimumValue: string | null; maximumValue: string | null;
  importOnly: boolean; comments: string | null;
}

export function dataTypes(definitions: Definitions): DataTypeRow[] {
  return Object.entries(definitions.DataTypes.Records).map(([name, row]) => ({
    name,
    indicator: text(row['Data Type Indicator']),
    description: row.Description ?? '',
    minimumValue: text(row['Minimum Value']),
    maximumValue: text(row['Maximum Value']),
    importOnly: flag(row['Import-only'], `data type ${name}'s Import-only`),
    comments: text(row.Comments)
  }));
}

// STATE's enumeration is written `Primary_Administrative_Subdivision[DXCC]`:
// the subdivisions, selected by whatever is in the DXCC field. The reference
// is kept whole and split here, so the validator never parses it again.
export function parseEnumerationRef(
  ref: string | undefined
): { ref: string | null; name: string | null; parameter: string | null } {
  if (!ref) return { ref: null, name: null, parameter: null };
  const trimmed = ref.trim();
  // Split on the bracket rather than matched with a pattern. The pattern this
  // replaces was two character classes with quantifiers either side of an
  // optional group, which the security lint flags as a regular expression
  // whose worst case is not linear — and it was reading a string from a file
  // fetched over the network, which is exactly where that matters.
  const open = trimmed.indexOf('[');
  if (open === -1) {
    if (trimmed.includes(']')) throw new Error(`"${ref}" is not an enumeration reference this understands`);
    return { ref, name: trimmed, parameter: null };
  }
  if (!trimmed.endsWith(']')) throw new Error(`"${ref}" is not an enumeration reference this understands`);
  const name = trimmed.slice(0, open);
  const parameter = trimmed.slice(open + 1, -1);
  if (!name || !parameter || parameter.includes('[') || parameter.includes(']')) {
    throw new Error(`"${ref}" is not an enumeration reference this understands`);
  }
  return { ref, name, parameter };
}

export interface FieldRow {
  name: string; dataType: string; dataTypes: string[];
  enumerationRef: string | null; enumerationName: string | null; enumerationParameter: string | null;
  description: string; headerField: boolean;
  minimumValue: string | null; maximumValue: string | null;
  importOnly: boolean; comments: string | null;
}

export function fields(definitions: Definitions): FieldRow[] {
  const known = new Set(Object.keys(definitions.DataTypes.Records));
  return Object.entries(definitions.Fields.Records).map(([name, row]) => {
    const published = row['Data Type'] ?? '';
    // Two fields publish two type names in one cell — see the comment on
    // field.dataTypes in schema.ts. Splitting is the derivation; the cell is
    // stored as published either way. A name that is not a data type at all
    // is a different matter and refused, because it would mean the archive
    // and this product disagree about what a field is.
    const resolved = published.split(',').map(part => part.trim()).filter(Boolean);
    for (const part of resolved) {
      if (!known.has(part)) throw new Error(`field ${name} names data type "${part}", which ADIF does not define`);
    }
    const enumeration = parseEnumerationRef(row.Enumeration);
    return {
      name,
      dataType: published,
      dataTypes: resolved,
      enumerationRef: enumeration.ref,
      enumerationName: enumeration.name,
      enumerationParameter: enumeration.parameter,
      description: row.Description ?? '',
      headerField: flag(row['Header Field'], `field ${name}'s Header Field`),
      minimumValue: text(row['Minimum Value']),
      maximumValue: text(row['Maximum Value']),
      importOnly: flag(row['Import-only'], `field ${name}'s Import-only`),
      comments: text(row.Comments)
    };
  });
}

export interface EnumerationRow {
  name: string; header: string[]; valueColumn: string; rowCount: number;
}
export interface ValueRow {
  enumeration: string; key: string; value: Row; deleted: boolean; importOnly: boolean;
}

export function enumerations(definitions: Definitions): EnumerationRow[] {
  return Object.entries(definitions.Enumerations).map(([name, enumeration]) => {
    const header = enumeration.Header ?? [];
    // The first column is "Enumeration Name" in all 25 — the enumeration's own
    // name, repeated on every row — and the second is the value a QSO field
    // carries. Read rather than listed, so a 26th enumeration needs no edit
    // here; refused rather than guessed if the shape ever changes.
    if (header[0] !== 'Enumeration Name' || !header[1]) {
      throw new Error(`the ${name} enumeration's columns are ${header.join(', ') || 'missing'}, ` +
        'which is not the shape every ADIF enumeration has had');
    }
    return {
      name,
      header,
      valueColumn: header[1],
      rowCount: Object.keys(enumeration.Records ?? {}).length
    };
  });
}

export function values(definitions: Definitions): ValueRow[] {
  const rows: ValueRow[] = [];
  for (const [name, enumeration] of Object.entries(definitions.Enumerations)) {
    for (const [key, row] of Object.entries(enumeration.Records ?? {})) {
      rows.push({
        enumeration: name,
        key,
        // Every column, as published (QGD-REF-0011).
        value: row,
        // Two enumerations spell it differently: most carry "Deleted", the
        // ARRL sections carry "Deleted Date". Either means the value is no
        // longer current, and both still have to validate in an old QSO.
        deleted: row.Deleted !== undefined
          ? flag(row.Deleted, `${name}.${key}'s Deleted`)
          : Boolean(text(row['Deleted Date'])),
        importOnly: flag(row['Import-only'], `${name}.${key}'s Import-only`)
      });
    }
  }
  return rows;
}

export interface ZoneRow {
  kind: 'cq' | 'itu'; number: number; authority: string;
  derivedFrom: string; subdivisions: number;
}

export interface UninterpretedRow {
  relation: string; key: string; column: string; cell: string; note: string;
}

export interface Derived {
  zones: ZoneRow[];
  uninterpreted: UninterpretedRow[];
  // How far the derivation reaches, measured rather than assumed. ADIF fills
  // the zone columns for five entities out of all of them, so this is the
  // evidence for QGD-REF-0015: what comes out is a coverage list and not the
  // zone list, and nothing may validate a zone against it.
  coverage: { subdivisions: number; withZone: number; entities: number };
}

// QGD-REF-0007 and QGD-REF-0015. The zones are not lists in ADIF: they are two
// columns on the 1,965 administrative subdivisions, filled for 152 of them.
// So they are derived here, the derivation is recorded with them — which
// column, and how many subdivisions carried each number — and every cell the
// derivation could not read is recorded too.
//
// What is deliberately NOT done here is interpreting the three cells that are
// not numbers. "07/08" plainly means two zones and "S=16 T=17" plainly means
// something about sub-districts, but ADIF's header does not define either
// notation, and reading them would be this product deciding what another
// organisation meant. They are kept as published and flagged.
export const ZONE_AUTHORITIES = {
  cq: { authority: 'CQ Magazine', column: 'CQ Zone' },
  itu: { authority: 'International Telecommunication Union', column: 'ITU Zone' }
} as const;

export function derive(definitions: Definitions): Derived {
  const subdivisions = definitions.Enumerations.Primary_Administrative_Subdivision;
  if (!subdivisions) throw new Error('Primary_Administrative_Subdivision is not in the archive');
  const records = Object.entries(subdivisions.Records ?? {});
  const rows: ZoneRow[] = [];
  const uninterpreted: UninterpretedRow[] = [];
  const entities = new Set<string>();
  const withZone = new Set<string>();

  for (const [kind, { authority, column }] of Object.entries(ZONE_AUTHORITIES)) {
    if (!subdivisions.Header?.includes(column)) {
      throw new Error(`Primary_Administrative_Subdivision no longer carries "${column}"`);
    }
    const counts = new Map<number, number>();
    for (const [key, row] of records) {
      const cell = text(row[column]);
      if (cell === null) continue;
      withZone.add(key);
      const entity = text(row['DXCC Entity Code']);
      if (entity !== null) entities.add(entity);
      // A cell can hold more than one zone, comma-separated, where a
      // subdivision straddles a boundary. Both zones exist, and dropping the
      // row would lose one of them.
      for (const part of cell.split(',').map(value => value.trim()).filter(Boolean)) {
        if (/^\d+$/.test(part)) {
          const number = Number(part);
          counts.set(number, (counts.get(number) ?? 0) + 1);
        } else {
          uninterpreted.push({
            relation: 'Primary_Administrative_Subdivision',
            key,
            column,
            cell,
            note: `"${part}" is not a zone number; ADIF's header does not define this notation`
          });
        }
      }
    }
    for (const [number, subdivisionCount] of [...counts].sort((a, b) => a[0] - b[0])) {
      rows.push({
        kind: kind as 'cq' | 'itu',
        number,
        authority,
        derivedFrom: `Primary_Administrative_Subdivision.${column}`,
        subdivisions: subdivisionCount
      });
    }
  }

  return {
    zones: rows,
    uninterpreted,
    coverage: { subdivisions: records.length, withZone: withZone.size, entities: entities.size }
  };
}

// The zones alone, for a caller that wants only those.
export function zones(definitions: Definitions): ZoneRow[] {
  return derive(definitions).zones;
}
