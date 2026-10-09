// SPDX-License-Identifier: GPL-3.0-only
// Putting the reference data into the engine.
//
// QGD-REF-0001: in the engine, in its own schema, arriving by migration —
// not in a file beside the application and not compiled into it. This is the
// load that fills the tables the migration made.
//
// Two properties the load has to have, and the reason for each:
//
// **All of it or none of it.** One transaction: the old rows go, the new rows
// arrive, and nothing in between is visible to anything reading. A load that
// fails halfway through would leave a validator answering from a list that is
// missing its second half, which is worse than one that cannot answer at all
// — QGD-REF-0010 says in so many words that briefly stale beats briefly wrong.
//
// **Checked before it replaces anything.** The counts are compared against
// what the archive holds before the transaction commits, so a definitions file
// that parsed but arrived empty is refused rather than loaded.
import type { Client } from 'pg';
import { REFERENCE_SCHEMA } from './schema.js';
import type { PotaRegister } from './pota-load.js';
import {
  type Definitions, dataTypes, derive, enumerations, fields, values
} from './adif.js';

export interface Register {
  adif: {
    version: string;
    source: { what: string; url: string; sha256: string; published: string; definitions: string; testQsos: string };
  };
  pota: PotaRegister;
  lists: {
    id: string; what: string; authority: string; copy: string;
    source: string | null; supplied: boolean; derived: boolean; holds?: string;
  }[];
}

export interface Loaded {
  version: string;
  dataTypes: number;
  fields: number;
  enumerations: number;
  values: number;
  zones: number;
  lists: number;
  // Cells kept as published and flagged, not dropped (QGD-REF-0015).
  uninterpreted: number;
}

export interface SourceRow {
  id: string; version: string | null; sha256: string | null;
  fetchedAt: Date; rowCount: number; etag: string | null; lastModified: string | null;
}

export async function loadedSource(client: Client, id: string): Promise<SourceRow | undefined> {
  const result = await client.query<{
    id: string; version: string | null; sha256: string | null;
    fetched_at: Date; row_count: number; etag: string | null; last_modified: string | null;
  }>(`SELECT id, version, sha256, fetched_at, row_count, etag, last_modified
      FROM ${REFERENCE_SCHEMA}.source WHERE id = $1`, [id]);
  const row = result.rows[0];
  return row && {
    id: row.id, version: row.version, sha256: row.sha256,
    fetchedAt: row.fetched_at, rowCount: Number(row.row_count),
    etag: row.etag, lastModified: row.last_modified
  };
}

export const ADIF_SOURCE = 'adif';

// Inserted in batches: 186 fields and 3,500-odd enumeration values is one
// round trip each at this size, and a single statement holding every value
// would be a megabyte of parameters.
const BATCH = 500;

async function insert(
  client: Client,
  table: string,
  columns: string[],
  rows: unknown[][]
): Promise<void> {
  const quoted = columns.map(column => `"${column}"`).join(', ');
  for (let at = 0; at < rows.length; at += BATCH) {
    const batch = rows.slice(at, at + BATCH);
    const parameters: unknown[] = [];
    const tuples = batch.map(row => {
      const places = row.map(value => {
        parameters.push(value);
        return `$${parameters.length}`;
      });
      return `(${places.join(', ')})`;
    });
    await client.query(
      `INSERT INTO ${REFERENCE_SCHEMA}."${table}" (${quoted}) VALUES ${tuples.join(', ')}`,
      parameters);
  }
}

export async function loadAdif(
  client: Client,
  definitions: Definitions,
  register: Register
): Promise<Loaded> {
  const typeRows = dataTypes(definitions);
  const fieldRows = fields(definitions);
  const enumerationRows = enumerations(definitions);
  const valueRows = values(definitions);
  const derived = derive(definitions);
  const zoneRows = derived.zones;

  // Checked against the archive, before anything is replaced. These are not
  // "at least as many as last time": they are the counts the archive itself
  // reports, so a definitions file holding half of ADIF is refused.
  const expected = {
    dataTypes: Object.keys(definitions.DataTypes.Records).length,
    fields: Object.keys(definitions.Fields.Records).length,
    enumerations: Object.keys(definitions.Enumerations).length
  };
  if (typeRows.length !== expected.dataTypes || fieldRows.length !== expected.fields
      || enumerationRows.length !== expected.enumerations) {
    throw new Error('the definitions read back a different shape than the archive reports');
  }
  if (definitions.Version !== register.adif.version) {
    throw new Error(`the definitions are ADIF ${definitions.Version}; the register pins ${register.adif.version}`);
  }
  const valuesInArchive = enumerationRows.reduce((total, row) => total + row.rowCount, 0);
  if (valueRows.length !== valuesInArchive) {
    throw new Error(`${valueRows.length} values read from enumerations holding ${valuesInArchive}`);
  }

  const adifLists = register.lists.filter(list => list.source === ADIF_SOURCE || list.source === null);

  await client.query('BEGIN');
  try {
    // Children before parents: enumeration_value references enumeration.
    for (const table of ['enumeration_value', 'enumeration', 'field', 'data_type', 'zone', 'list', 'uninterpreted']) {
      await client.query(`DELETE FROM ${REFERENCE_SCHEMA}."${table}"`);
    }
    await client.query(`DELETE FROM ${REFERENCE_SCHEMA}.source WHERE id = $1`, [ADIF_SOURCE]);

    await client.query(
      `INSERT INTO ${REFERENCE_SCHEMA}.source
         (id, what, url, version, sha256, published, row_count, fetched_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())`,
      [ADIF_SOURCE, register.adif.source.what, register.adif.source.url, register.adif.version,
        register.adif.source.sha256, register.adif.source.published, valueRows.length]);

    await insert(client, 'data_type',
      ['name', 'indicator', 'description', 'minimum_value', 'maximum_value', 'import_only', 'comments'],
      typeRows.map(row => [row.name, row.indicator, row.description, row.minimumValue,
        row.maximumValue, row.importOnly, row.comments]));

    await insert(client, 'field',
      ['name', 'data_type', 'data_types', 'enumeration_ref', 'enumeration_name', 'enumeration_parameter',
        'description', 'header_field', 'minimum_value', 'maximum_value', 'import_only', 'comments'],
      fieldRows.map(row => [row.name, row.dataType, row.dataTypes, row.enumerationRef,
        row.enumerationName, row.enumerationParameter, row.description, row.headerField,
        row.minimumValue, row.maximumValue, row.importOnly, row.comments]));

    await insert(client, 'enumeration', ['name', 'header', 'value_column', 'row_count'],
      enumerationRows.map(row => [row.name, row.header, row.valueColumn, row.rowCount]));

    await insert(client, 'enumeration_value',
      ['enumeration', 'key', 'value', 'deleted', 'import_only'],
      valueRows.map(row => [row.enumeration, row.key, JSON.stringify(row.value),
        row.deleted, row.importOnly]));

    await insert(client, 'zone', ['kind', 'number', 'authority', 'derived_from', 'subdivisions'],
      zoneRows.map(row => [row.kind, row.number, row.authority, row.derivedFrom, row.subdivisions]));

    // A cell can be unreadable in both columns of the same row, and the key is
    // the cell's place, so the same place is recorded once.
    const seen = new Set<string>();
    const cells = derived.uninterpreted.filter(row => {
      const at = `${row.relation}\u0000${row.key}\u0000${row.column}`;
      if (seen.has(at)) return false;
      seen.add(at);
      return true;
    });
    await insert(client, 'uninterpreted',
      ['source_id', 'relation', 'key', 'column', 'cell', 'note'],
      cells.map(row => [ADIF_SOURCE, row.relation, row.key, row.column, row.cell, row.note]));

    // The register, with the row count of whatever each list turned out to
    // hold. A list ADIF does not supply gets a count of null rather than 0:
    // "not supplied" and "supplied and empty" are different answers, and
    // QGD-REF-0006 turns on the difference.
    const held = (list: Register['lists'][number]): number | null => {
      if (!list.supplied && !list.derived) return null;
      if (list.derived) {
        const kind = list.id.startsWith('cq') ? 'cq' : 'itu';
        return zoneRows.filter(row => row.kind === kind).length;
      }
      if (list.holds === 'Fields') return fieldRows.length;
      if (list.holds === 'DataTypes') return typeRows.length;
      if (list.holds) {
        const enumeration = enumerationRows.find(row => row.name === list.holds);
        if (!enumeration) throw new Error(`the register says the "${list.id}" list is ${list.holds}, which is not in the archive`);
        return enumeration.rowCount;
      }
      return null;
    };
    await insert(client, 'list',
      ['id', 'what', 'authority', 'copy', 'source_id', 'supplied', 'derived', 'row_count'],
      adifLists.map(list => [list.id, list.what, list.authority, list.copy,
        list.source, list.supplied, list.derived, held(list)]));

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }

  return {
    version: definitions.Version,
    dataTypes: typeRows.length,
    fields: fieldRows.length,
    enumerations: enumerationRows.length,
    values: valueRows.length,
    zones: zoneRows.length,
    lists: adifLists.length,
    uninterpreted: derived.uninterpreted.length
  };
}

// Loads only when what is in the database is not the pinned release. The
// comparison is on the version and the checksum together: a release re-cut
// under the same version number is a different release (QGD-REF-0003).
export async function ensureAdif(
  client: Client,
  definitions: Definitions,
  register: Register
): Promise<Loaded | 'current'> {
  const already = await loadedSource(client, ADIF_SOURCE);
  if (already?.version === register.adif.version && already.sha256 === register.adif.source.sha256) {
    const rows = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM ${REFERENCE_SCHEMA}.enumeration_value`);
    // The source row says it was loaded; the values say whether it is there.
    // A source row with no data behind it is the state a torn load would
    // leave, and it is reloaded rather than trusted.
    if (Number(rows.rows[0]?.count ?? 0) === already.rowCount) return 'current';
  }
  return loadAdif(client, definitions, register);
}

// A count of everything loaded, for the suite and for diagnostics. Read with
// one statement rather than six round trips.
export async function counts(client: Client): Promise<Record<string, number>> {
  const result = await client.query<Record<string, string>>(`
    SELECT (SELECT count(*) FROM ${REFERENCE_SCHEMA}.data_type)         AS data_types,
           (SELECT count(*) FROM ${REFERENCE_SCHEMA}.field)             AS fields,
           (SELECT count(*) FROM ${REFERENCE_SCHEMA}.enumeration)       AS enumerations,
           (SELECT count(*) FROM ${REFERENCE_SCHEMA}.enumeration_value) AS values,
           (SELECT count(*) FROM ${REFERENCE_SCHEMA}.zone)              AS zones,
           (SELECT count(*) FROM ${REFERENCE_SCHEMA}.list)              AS lists,
           (SELECT count(*) FROM ${REFERENCE_SCHEMA}.source)            AS sources,
           (SELECT count(*) FROM ${REFERENCE_SCHEMA}.uninterpreted)     AS uninterpreted`);
  return Object.fromEntries(Object.entries(result.rows[0] ?? {}).map(([key, value]) => [key, Number(value)]));
}

// Used by the suite to prove the tables are the frame's and an application
// reaches them through a grant rather than owning them (QGD-ENG-0010).
export async function grantRead(client: Client, role: string): Promise<void> {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(role)) throw new Error(`"${role}" is not a role name this may build SQL with.`);
  await client.query(`GRANT USAGE ON SCHEMA ${REFERENCE_SCHEMA} TO ${role}`);
  await client.query(`GRANT SELECT ON ALL TABLES IN SCHEMA ${REFERENCE_SCHEMA} TO ${role}`);
}
