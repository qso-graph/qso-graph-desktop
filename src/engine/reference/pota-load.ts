// SPDX-License-Identifier: GPL-3.0-only
// Loading POTA's lists into the engine, and keeping the last good one when a
// load cannot happen.
//
// QGD-REF-0010 is the whole of the design here, and it says in so many words
// that **reference data which is briefly stale is worth more than reference
// data which is briefly wrong**. So, in order:
//
// 1. A list loaded less than a day ago is not asked for again.
// 2. Otherwise it is asked for conditionally, with whatever ETag and
//    Last-Modified the last load recorded. A 304 replaces nothing; only the
//    time of asking is written down.
// 3. What arrives is parsed and its shape checked — the columns exactly, every
//    row, no duplicate reference, and a refusal if it arrived a fraction of
//    the size of the last one.
// 4. Only then is the previous load replaced, in one transaction.
// 5. A failure anywhere in 2 to 4 leaves the previous load exactly as it was
//    and is reported. It never stops the engine (QGD-REF-0014).
import type { Client } from 'pg';
import { REFERENCE_SCHEMA } from './schema.js';
import type { FetchText } from './fetch.js';
import {
  type Location, type Park, type Program, ShapeError,
  readLocations, readParks, readPrograms, refuseIfShrunk
} from './pota.js';
import { loadedSource } from './load.js';

export interface PotaSource {
  url: string;
  what: string;
  format: 'csv' | 'json';
  columns: string[];
  conditional: string;
}

export interface PotaRegister {
  what: string;
  refreshAfterHours: number;
  sources: { parks: PotaSource; programs: PotaSource; locations: PotaSource };
}

// The source row ids, which are also the register's list ids.
export const POTA_SOURCES = {
  parks: 'pota-parks',
  programs: 'pota-programs',
  locations: 'pota-locations'
} as const;

export type PotaList = keyof typeof POTA_SOURCES;

export type ListOutcome =
  | { list: PotaList; state: 'loaded'; rows: number; etag: string | null; lastModified: string | null }
  | { list: PotaList; state: 'unchanged' }
  | { list: PotaList; state: 'fresh enough'; loadedAt: Date }
  | { list: PotaList; state: 'kept'; reason: string; rows: number | undefined };

export interface PotaLoaded {
  outcomes: ListOutcome[];
  // Parks whose POTA entity number is also an ADIF DXCC code, and parks whose
  // is not. The second is QGD-REF-0012's evidence: they are loaded, with the
  // number intact and no ADIF link.
  adifLinked?: number;
  adifUnlinked?: number;
}

const HOUR = 60 * 60 * 1000;

export async function loadPota(
  client: Client,
  register: PotaRegister,
  // `fetchText` is required: there is no default, because a default would be
  // a connection opened from this process and all of this product's outbound
  // HTTPS goes through the credential core (D-18, D-31).
  options: { fetchText: FetchText; now?: Date; force?: boolean }
): Promise<PotaLoaded> {
  const now = options.now ?? new Date();
  const fetchText = options.fetchText;
  const outcomes: ListOutcome[] = [];

  for (const list of ['parks', 'programs', 'locations'] as PotaList[]) {
    outcomes.push(await loadOne(client, register, list, now, fetchText, options.force ?? false));
  }

  const link = await linkAdifEntities(client);
  return { outcomes, ...link };
}

async function loadOne(
  client: Client,
  register: PotaRegister,
  list: PotaList,
  now: Date,
  fetchText: FetchText,
  force: boolean
): Promise<ListOutcome> {
  const id = POTA_SOURCES[list];
  const source = register.sources[list];
  const previous = await loadedSource(client, id);

  if (!force && previous && now.getTime() - previous.fetchedAt.getTime() < register.refreshAfterHours * HOUR) {
    return { list, state: 'fresh enough', loadedAt: previous.fetchedAt };
  }

  try {
    const answer = await fetchText(source.url, {
      etag: previous?.etag ?? null,
      lastModified: previous?.lastModified ?? null
    });
    if (answer.status === 'unchanged') {
      // Nothing is replaced. Only the fact that it was asked is written, so
      // the next start does not ask again within the day.
      await client.query(
        `UPDATE ${REFERENCE_SCHEMA}.source SET fetched_at = $2 WHERE id = $1`, [id, now]);
      return { list, state: 'unchanged' };
    }

    // Parsed and checked before a row of the previous load is touched.
    const rows = read(list, answer.body, source);
    refuseIfShrunk(list, rows.count, previous?.rowCount);

    await client.query('BEGIN');
    try {
      await replace(client, list, rows);
      await client.query(
        `INSERT INTO ${REFERENCE_SCHEMA}.source
           (id, what, url, etag, last_modified, fetched_at, row_count)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO UPDATE SET
           what = excluded.what, url = excluded.url, etag = excluded.etag,
           last_modified = excluded.last_modified, fetched_at = excluded.fetched_at,
           row_count = excluded.row_count`,
        [id, source.what, source.url, answer.etag, answer.lastModified, now, rows.count]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    }
    return { list, state: 'loaded', rows: rows.count, etag: answer.etag, lastModified: answer.lastModified };
  } catch (error) {
    // The previous load is still there, whole, because nothing was deleted
    // outside the transaction above. Reported, not thrown (QGD-REF-0010).
    const reason = error instanceof ShapeError
      ? error.message
      : `could not be fetched: ${error instanceof Error ? error.message : String(error)}`;
    return { list, state: 'kept', reason, rows: previous?.rowCount };
  }
}

type Rows =
  | { list: 'parks'; count: number; parks: Park[] }
  | { list: 'programs'; count: number; programs: Program[] }
  | { list: 'locations'; count: number; locations: Location[] };

function read(list: PotaList, body: string, source: PotaSource): Rows {
  if (list === 'parks') {
    // The columns the register names, not a copy of them kept in the code.
    const parsed = readParks(body, source.columns);
    return { list: 'parks', count: parsed.parks.length, parks: parsed.parks };
  }
  if (list === 'programs') {
    const programs = readPrograms(body);
    return { list: 'programs', count: programs.length, programs };
  }
  const locations = readLocations(body);
  return { list: 'locations', count: locations.length, locations };
}

// Inserted in batches, like the ADIF load: 96,000 parks is too many rows for
// one statement's parameters.
const BATCH = 1000;

async function insert(client: Client, table: string, columns: string[], rows: unknown[][]): Promise<void> {
  const quoted = columns.map(column => `"${column}"`).join(', ');
  for (let at = 0; at < rows.length; at += BATCH) {
    const batch = rows.slice(at, at + BATCH);
    const parameters: unknown[] = [];
    const tuples = batch.map(row => `(${row.map(value => {
      parameters.push(value);
      return `$${parameters.length}`;
    }).join(', ')})`);
    await client.query(
      `INSERT INTO ${REFERENCE_SCHEMA}."${table}" (${quoted}) VALUES ${tuples.join(', ')}`, parameters);
  }
}

async function replace(client: Client, list: PotaList, rows: Rows): Promise<void> {
  if (rows.list === 'parks') {
    await client.query(`DELETE FROM ${REFERENCE_SCHEMA}.pota_park_location`);
    await client.query(`DELETE FROM ${REFERENCE_SCHEMA}.pota_park`);
    await insert(client, 'pota_park',
      ['reference', 'name', 'active', 'entity_id', 'location_desc',
        'latitude', 'longitude', 'grid', 'coordinates_usable', 'coordinates_note', 'is_test'],
      rows.parks.map(park => [park.reference, park.name, park.active, park.entityId, park.locationDesc,
        park.latitude, park.longitude, park.grid, park.coordinatesUsable, park.coordinatesNote, park.isTest]));
    // One row per park per location (QGD-REF-0013). A park published with the
    // same location twice contributes it once, because the pair is the key.
    const pairs = new Set<string>();
    const rowsOut: unknown[][] = [];
    for (const park of rows.parks) {
      for (const location of park.locations) {
        const pair = `${park.reference} ${location}`;
        if (pairs.has(pair)) continue;
        pairs.add(pair);
        rowsOut.push([park.reference, location]);
      }
    }
    await insert(client, 'pota_park_location', ['reference', 'location_desc'], rowsOut);
    return;
  }
  if (rows.list === 'programs') {
    await client.query(`DELETE FROM ${REFERENCE_SCHEMA}.pota_program`);
    await insert(client, 'pota_program',
      ['program_id', 'prefix', 'name', 'active', 'iso_country', 'location_unit', 'iso_language'],
      rows.programs.map(program => [program.programId, program.prefix, program.name, program.active,
        program.isoCountry, program.locationUnit, program.isoLanguage]));
    return;
  }
  await client.query(`DELETE FROM ${REFERENCE_SCHEMA}.pota_location`);
  await insert(client, 'pota_location',
    ['location_id', 'entity_id', 'entity_name', 'location_desc', 'location_name',
      'latitude', 'longitude', 'iso'],
    rows.locations.map(location => [location.locationId, location.entityId, location.entityName,
      location.locationDesc, location.locationName, location.latitude, location.longitude, location.iso]));
}

// QGD-REF-0012: the ADIF entity is a derived, nullable link where the two
// organisations' numbers agree, and null where they do not. Set from ADIF's
// own DXCC enumeration, so the link is data meeting data — not a list of
// exceptions written here.
//
// Where ADIF's definitions are not loaded, every link is null and the parks
// are all still there. The number of each is returned, because "no park has an
// ADIF entity" and "every park has one" look the same in a schema.
export async function linkAdifEntities(client: Client): Promise<{ adifLinked: number; adifUnlinked: number }> {
  await client.query(`UPDATE ${REFERENCE_SCHEMA}.pota_park SET adif_entity = NULL`);
  await client.query(`
    UPDATE ${REFERENCE_SCHEMA}.pota_park AS park
       SET adif_entity = park.entity_id
     WHERE park.entity_id IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM ${REFERENCE_SCHEMA}.enumeration_value AS dxcc
          WHERE dxcc.enumeration = 'DXCC_Entity_Code'
            AND dxcc.key = park.entity_id::text)`);
  const counted = await client.query<{ linked: string; unlinked: string }>(`
    SELECT count(adif_entity)::text AS linked,
           count(*) FILTER (WHERE entity_id IS NOT NULL AND adif_entity IS NULL)::text AS unlinked
      FROM ${REFERENCE_SCHEMA}.pota_park`);
  return {
    adifLinked: Number(counted.rows[0]?.linked ?? 0),
    adifUnlinked: Number(counted.rows[0]?.unlinked ?? 0)
  };
}

// What is in the engine, for the suite and for diagnostics.
export async function potaCounts(client: Client): Promise<Record<string, number>> {
  const result = await client.query<Record<string, string>>(`
    SELECT (SELECT count(*) FROM ${REFERENCE_SCHEMA}.pota_park)          AS parks,
           (SELECT count(*) FROM ${REFERENCE_SCHEMA}.pota_program)       AS programs,
           (SELECT count(*) FROM ${REFERENCE_SCHEMA}.pota_location)      AS locations,
           (SELECT count(*) FROM ${REFERENCE_SCHEMA}.pota_park_location) AS park_locations,
           (SELECT count(*) FROM ${REFERENCE_SCHEMA}.pota_park WHERE NOT active)            AS retired,
           (SELECT count(*) FROM ${REFERENCE_SCHEMA}.pota_park WHERE NOT coordinates_usable) AS unusable,
           (SELECT count(*) FROM ${REFERENCE_SCHEMA}.pota_park WHERE is_test)                AS test`);
  return Object.fromEntries(Object.entries(result.rows[0] ?? {}).map(([key, value]) => [key, Number(value)]));
}
