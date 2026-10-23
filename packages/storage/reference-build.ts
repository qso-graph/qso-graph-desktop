// SPDX-License-Identifier: GPL-3.0-only
// Building reference.sqlite from verified inputs (QGD-ENG-0015).
//
// A build writes a complete new file at a path it is given, which is never the
// live file. It creates the tables from the rendered DDL and fills them in one
// transaction. Then it checks the file: integrity_check, foreign_key_check,
// and the counts and provenance of each dataset it holds (QGD-REF-0014). Last
// it stamps the schema version and closes. The caller swaps the file in only
// if all of that succeeded, so a build that fails at any step leaves the live
// file as it was.
//
// It is synchronous work on a synchronous driver, which is why QG Storage runs
// it on a worker thread (reference-worker.ts) and keeps answering meanwhile.
// Tests call it directly.
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { count, isNotNull, sql } from 'drizzle-orm';
import {
  type Definitions, dataTypes, derive, enumerations, fields, values
} from '../reference/adif.js';
import { type Activation, type Location, type Park, type Program, ShapeError, readActivations, readLocations, readParks, readPrograms } from '../reference/pota.js';
import { type Summit, readSummits } from '../reference/sota.js';
import type { Register } from '../reference/register.js';
import type { PotaRegister } from '../reference/register.js';
import { StorageFailure, failure } from './errors.js';
import { type PotaList, type PotaRecord, type SotaList, POTA_LISTS } from './reference-cache.js';
import {
  REFERENCE_SCHEMA_VERSION, dataType, enumeration, enumerationValue, field, list, potaLocation,
  potaActivation, potaPark, potaParkLocation, potaProgram, referenceSchema, sotaSummit, source, uninterpreted, zone
} from './reference-schema.js';
import { applyDdl, stampVersion } from './migrate.js';
import { openStore, type Store } from './sqlite.js';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';

export const ADIF_SOURCE = 'adif';
export const POTA_SOURCE_IDS: Readonly<Record<PotaList, string>> = {
  parks: 'pota-parks', programs: 'pota-programs', locations: 'pota-locations'
};
export const SOTA_SOURCE_IDS: Readonly<Record<SotaList, string>> = { summits: 'sota-summits' };
// One source per location of My Area (QGD-REF-0019): pota-activations-US-ID.
export const ACTIVATIONS_SOURCE_PREFIX = 'pota-activations-';
export const activationsSourceId = (location: string) => `${ACTIVATIONS_SOURCE_PREFIX}${location}`;

export interface AdifInput {
  definitions: Definitions;
  // When the archive these definitions came from was verified: the fetch time
  // the source row records.
  fetchedAt: string;
}

export interface PotaInput {
  record: PotaRecord;
  body: string;
}

export interface BuildInputs {
  register: Register;
  adif?: AdifInput;
  pota: Partial<Record<PotaList, PotaInput>>;
  // SOTA's summits (QGD-REF-0018), when they are downloaded.
  sota?: Partial<Record<SotaList, PotaInput>>;
  // POTA's activations, by location (QGD-REF-0019), when they are downloaded.
  activations?: Record<string, PotaInput>;
}

export interface BuildSummary {
  adif: { version: string; values: number; fields: number; zones: number } | undefined;
  pota: Partial<Record<PotaList, number>>;
  sota?: Partial<Record<SotaList, number>>;
  // Parks with an activation count, a park in two locations once.
  activations?: number;
  adifLinked: number;
  adifUnlinked: number;
}

export interface BuildHooks {
  // For the controls in tests: runs after the data is written and before the
  // checks, with the open store, so a defect can be planted for them to find.
  beforeChecks?: (store: Store<typeof referenceSchema>) => void;
}

// The rendered DDL, split where drizzle-kit marks statement boundaries.
export function referenceDdl(folder: string): string[] {
  const journal = JSON.parse(readFileSync(join(folder, 'meta', '_journal.json'), 'utf8')) as {
    entries: { tag: string }[];
  };
  if (journal.entries.length !== 1) {
    // Derived, never migrated: a change to the schema is rendered again from
    // nothing, so there is only ever one file.
    throw new StorageFailure({ kind: 'build' });
  }
  return readFileSync(join(folder, `${journal.entries[0].tag}.sql`), 'utf8')
    .split('--> statement-breakpoint').map((statement) => statement.trim()).filter(Boolean);
}

// Large lists go in batches. SQLite allows 32,766 bound values in a statement,
// and a park row has twelve.
const BATCH = 1000;
async function insertAll<T>(rows: T[], write: (batch: T[]) => Promise<unknown>): Promise<void> {
  for (let at = 0; at < rows.length; at += BATCH) await write(rows.slice(at, at + BATCH));
}

interface Parsed {
  parks?: Park[];
  programs?: Program[];
  locations?: Location[];
}

function parsePota(register: PotaRegister, pota: BuildInputs['pota']): Parsed {
  const parsed: Parsed = {};
  if (pota.parks) parsed.parks = readParks(pota.parks.body, register.sources.parks.columns).parks;
  if (pota.programs) parsed.programs = readPrograms(pota.programs.body);
  if (pota.locations) parsed.locations = readLocations(pota.locations.body);
  return parsed;
}

const removeFile = (path: string) => {
  for (const name of [path, `${path}-journal`, `${path}-wal`, `${path}-shm`]) rmSync(name, { force: true });
};

export async function buildReference(
  target: string,
  ddlFolder: string,
  inputs: BuildInputs,
  hooks: BuildHooks = {}
): Promise<BuildSummary> {
  removeFile(target);
  let store: Store<typeof referenceSchema> | undefined;
  try {
    const { register } = inputs;
    // Everything is read and checked against its own shape before the file is
    // touched, so a refused input cannot leave a half-filled file to check.
    const adif = inputs.adif && {
      types: dataTypes(inputs.adif.definitions),
      fields: fields(inputs.adif.definitions),
      enumerations: enumerations(inputs.adif.definitions),
      values: values(inputs.adif.definitions),
      derived: derive(inputs.adif.definitions)
    };
    if (adif && inputs.adif && inputs.adif.definitions.Version !== register.adif.version) {
      throw new StorageFailure({ kind: 'shape' });
    }
    const pota = parsePota(register.pota, inputs.pota);
    const summits: Summit[] | undefined = inputs.sota?.summits
      ? readSummits(inputs.sota.summits.body, register.sota.sources.summits.columns).summits : undefined;
    const activations = readAllActivations(inputs.activations);

    store = openStore(target, { schema: referenceSchema, journal: 'delete' });
    const ddl = referenceDdl(ddlFolder);
    const connection = store.connection;

    await store.unit(async (db) => {
      connection.exec('BEGIN IMMEDIATE');
      try {
        // The rendered DDL, shipped with the product. Nothing in it comes from a user.
        applyDdl(store!, ddl);

        if (adif && inputs.adif) {
          await db.insert(source).values({
            id: ADIF_SOURCE, what: register.adif.source.what, url: register.adif.source.url,
            version: register.adif.version, sha256: register.adif.source.sha256,
            published: register.adif.source.published, fetchedAt: inputs.adif.fetchedAt,
            rowCount: adif.values.length, contentSha256: register.adif.source.sha256
          });
          await insertAll(adif.types, (batch) => db.insert(dataType).values(batch));
          await insertAll(adif.fields, (batch) => db.insert(field).values(batch));
          await insertAll(adif.enumerations, (batch) => db.insert(enumeration).values(batch));
          await insertAll(adif.values, (batch) => db.insert(enumerationValue).values(batch));
          await insertAll(adif.derived.zones, (batch) => db.insert(zone).values(batch));
          // A cell can be unreadable in both columns of a row; its place is the key.
          const seen = new Set<string>();
          const cells = adif.derived.uninterpreted.filter((row) => {
            const at = `${row.relation}\u0000${row.key}\u0000${row.column}`;
            if (seen.has(at)) return false;
            seen.add(at);
            return true;
          }).map((row) => ({ ...row, sourceId: ADIF_SOURCE }));
          await insertAll(cells, (batch) => db.insert(uninterpreted).values(batch));
          await insertAll(adifLists(register, adif), (batch) => db.insert(list).values(batch));
        }

        for (const name of POTA_LISTS) {
          const input = inputs.pota[name];
          if (!input) continue;
          const rows = name === 'parks' ? pota.parks : name === 'programs' ? pota.programs : pota.locations;
          await db.insert(source).values({
            id: POTA_SOURCE_IDS[name], what: input.record.what, url: input.record.url,
            etag: input.record.etag, lastModified: input.record.lastModified,
            fetchedAt: input.record.fetchedAt, rowCount: rows?.length ?? 0, contentSha256: input.record.sha256
          });
        }
        if (pota.parks) {
          await insertAll(pota.parks.map((park) => ({
            reference: park.reference, name: park.name, active: park.active, entityId: park.entityId,
            adifEntity: null, locationDesc: park.locationDesc, latitude: park.latitude, longitude: park.longitude,
            grid: park.grid, coordinatesUsable: park.coordinatesUsable, coordinatesNote: park.coordinatesNote,
            isTest: park.isTest
          })),
            (batch) => db.insert(potaPark).values(batch));
          // One row per park per location (QGD-REF-0013); a repeated pair once.
          const pairs = new Map<string, { reference: string; locationDesc: string }>();
          for (const park of pota.parks) {
            for (const location of park.locations) {
              pairs.set(`${park.reference}\u0000${location}`, { reference: park.reference, locationDesc: location });
            }
          }
          await insertAll([...pairs.values()], (batch) => db.insert(potaParkLocation).values(batch));
        }
        if (pota.programs) await insertAll(pota.programs, (batch) => db.insert(potaProgram).values(batch));
        const summitInput = inputs.sota?.summits;
        if (summitInput && summits) {
          await db.insert(source).values({
            id: SOTA_SOURCE_IDS.summits, what: summitInput.record.what, url: summitInput.record.url,
            etag: summitInput.record.etag, lastModified: summitInput.record.lastModified,
            fetchedAt: summitInput.record.fetchedAt, rowCount: summits.length, contentSha256: summitInput.record.sha256
          });
          await insertAll(summits, (batch) => db.insert(sotaSummit).values(batch));
        }
        if (pota.locations) await insertAll(pota.locations, (batch) => db.insert(potaLocation).values(batch));
        for (const [location, input] of Object.entries(inputs.activations ?? {})) {
          await db.insert(source).values({
            id: activationsSourceId(location), what: input.record.what, url: input.record.url,
            etag: input.record.etag, lastModified: input.record.lastModified,
            fetchedAt: input.record.fetchedAt, rowCount: activations.byLocation.get(location) ?? 0,
            contentSha256: input.record.sha256
          });
        }
        await insertAll(activations.rows, (batch) => db.insert(potaActivation).values(batch));

        // QGD-REF-0012: the ADIF entity is set only where POTA's number is also
        // one of ADIF's DXCC codes. With no ADIF in this build, every link stays null.
        await db.run(sql`
          UPDATE pota_park AS park SET adif_entity = park.entity_id
           WHERE park.entity_id IS NOT NULL
             AND EXISTS (SELECT 1 FROM enumeration_value AS dxcc
                          WHERE dxcc.enumeration = 'DXCC_Entity_Code'
                            AND dxcc.key = CAST(park.entity_id AS TEXT))`);
        connection.exec('COMMIT');
      } catch (error) {
        if (connection.isTransaction) connection.exec('ROLLBACK');
        throw error;
      }
    });

    hooks.beforeChecks?.(store);
    await check(store, inputs, adif && { values: adif.values.length, fields: adif.fields.length,
      types: adif.types.length, enumerations: adif.enumerations.length, zones: adif.derived.zones.length }, pota, summits, activations);

    stampVersion(store, REFERENCE_SCHEMA_VERSION);
    const linked = await store.unit((db) => db.values<[number, number]>(sql`
      SELECT count(adif_entity), count(*) FILTER (WHERE entity_id IS NOT NULL AND adif_entity IS NULL) FROM pota_park`));
    store.close();
    store = undefined;
    return {
      adif: adif && inputs.adif ? {
        version: inputs.adif.definitions.Version, values: adif.values.length,
        fields: adif.fields.length, zones: adif.derived.zones.length
      } : undefined,
      pota: Object.fromEntries(POTA_LISTS.filter((name) => pota[name]).map((name) => [name, pota[name]!.length])),
      ...(summits ? { sota: { summits: summits.length } } : {}),
      ...(activations.rows.length > 0 ? { activations: activations.rows.length } : {}),
      adifLinked: linked[0][0],
      adifUnlinked: linked[0][1]
    };
  } catch (error) {
    store?.close();
    removeFile(target);
    throw failure(error, error instanceof ShapeError ? 'shape' : 'build');
  }
}

// Each location's activations read and checked, then joined: a park in two
// locations of My Area is one row. Both lists are POTA's, so where they were
// fetched minutes apart and disagree, the later location's count stands.
interface ReadActivations { rows: Activation[]; byLocation: Map<string, number> }
function readAllActivations(inputs: BuildInputs['activations']): ReadActivations {
  const parks = new Map<string, Activation>();
  const byLocation = new Map<string, number>();
  for (const [location, input] of Object.entries(inputs ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
    const rows = readActivations(input.body);
    byLocation.set(location, rows.length);
    for (const row of rows) parks.set(row.reference, row);
  }
  return { rows: [...parks.values()], byLocation };
}

function adifLists(register: Register, adif: {
  types: unknown[]; fields: unknown[]; enumerations: { name: string; rowCount: number }[];
  derived: { zones: { kind: string }[] };
}) {
  // "Not supplied" is a count of null, never 0: QGD-REF-0006 turns on it.
  const held = (entry: Register['lists'][number]): number | null => {
    if (!entry.supplied && !entry.derived) return null;
    if (entry.derived) {
      const kind = entry.id.startsWith('cq') ? 'cq' : 'itu';
      return adif.derived.zones.filter((row) => row.kind === kind).length;
    }
    if (entry.holds === 'Fields') return adif.fields.length;
    if (entry.holds === 'DataTypes') return adif.types.length;
    if (entry.holds) {
      const found = adif.enumerations.find((row) => row.name === entry.holds);
      if (!found) throw new StorageFailure({ kind: 'shape' });
      return found.rowCount;
    }
    return null;
  };
  return register.lists
    .filter((entry) => entry.source === ADIF_SOURCE || entry.source === null)
    .map((entry) => ({
      id: entry.id, what: entry.what, authority: entry.authority, copy: entry.copy,
      sourceId: entry.source, supplied: entry.supplied, derived: entry.derived, rowCount: held(entry)
    }));
}

// The checks a file must pass before it may be published (QGD-ENG-0015). Each
// dataset is checked only if this build holds it, and its absence is checked
// when it does not (QGD-REF-0014).
async function check(
  store: Store<typeof referenceSchema>,
  inputs: BuildInputs,
  adif: { values: number; fields: number; types: number; enumerations: number; zones: number } | undefined,
  pota: Parsed,
  summits: Summit[] | undefined,
  activations: ReadActivations
): Promise<void> {
  const refuse = (): never => { throw new StorageFailure({ kind: 'build' }); };
  await store.unit(async (db) => {
    const integrity = await db.values<[string]>(sql`PRAGMA integrity_check`);
    if (integrity.length !== 1 || integrity[0][0] !== 'ok') refuse();
    // integrity_check passes an orphaned foreign key; this does not.
    const orphans = await db.values(sql`PRAGMA foreign_key_check`);
    if (orphans.length !== 0) refuse();

    const total = async (table: SQLiteTable) => (await db.select({ n: count() }).from(table).get())?.n ?? -1;
    const sources = await db.select().from(source).all();
    const sourceOf = (id: string) => sources.find((row) => row.id === id);

    if (adif && inputs.adif) {
      const row = sourceOf(ADIF_SOURCE);
      if (!row || row.version !== inputs.register.adif.version || row.sha256 !== inputs.register.adif.source.sha256
          || row.rowCount !== adif.values || row.fetchedAt !== inputs.adif.fetchedAt) refuse();
      if (await total(enumerationValue) !== adif.values || await total(field) !== adif.fields
          || await total(dataType) !== adif.types || await total(enumeration) !== adif.enumerations
          || await total(zone) !== adif.zones) refuse();
    } else {
      if (sourceOf(ADIF_SOURCE)) refuse();
      if (await total(enumerationValue) !== 0 || await total(field) !== 0) refuse();
      // Without ADIF, no park may claim an ADIF entity.
      if ((await db.select({ n: count() }).from(potaPark).where(isNotNull(potaPark.adifEntity)).get())?.n !== 0) refuse();
    }

    const tables = { parks: potaPark, programs: potaProgram, locations: potaLocation } as const;
    for (const name of POTA_LISTS) {
      const input = inputs.pota[name];
      const row = sourceOf(POTA_SOURCE_IDS[name]);
      const rows = pota[name];
      if (input && rows) {
        if (!row || row.fetchedAt !== input.record.fetchedAt || row.etag !== input.record.etag
            || row.lastModified !== input.record.lastModified || row.rowCount !== rows.length
            || row.contentSha256 !== input.record.sha256) refuse();
        if (await total(tables[name]) !== rows.length) refuse();
      } else {
        if (row) refuse();
        if (await total(tables[name]) !== 0) refuse();
      }
    }

    // SOTA's summits, held to their input as POTA's lists are.
    const summitInput = inputs.sota?.summits;
    const summitRow = sourceOf(SOTA_SOURCE_IDS.summits);
    if (summitInput && summits) {
      if (!summitRow || summitRow.fetchedAt !== summitInput.record.fetchedAt || summitRow.etag !== summitInput.record.etag
          || summitRow.lastModified !== summitInput.record.lastModified || summitRow.rowCount !== summits.length
          || summitRow.contentSha256 !== summitInput.record.sha256) refuse();
      if (await total(sotaSummit) !== summits.length) refuse();
    } else {
      if (summitRow) refuse();
      if (await total(sotaSummit) !== 0) refuse();
    }

    // The activations: a source row for each location given and no other,
    // each held to its input, and one row per park.
    const given = Object.entries(inputs.activations ?? {});
    const heldLocations = sources.filter((row) => row.id.startsWith(ACTIVATIONS_SOURCE_PREFIX));
    if (heldLocations.length !== given.length) refuse();
    for (const [location, input] of given) {
      const row = sourceOf(activationsSourceId(location));
      if (!row || row.fetchedAt !== input.record.fetchedAt || row.contentSha256 !== input.record.sha256
          || row.rowCount !== activations.byLocation.get(location)) refuse();
    }
    if (await total(potaActivation) !== activations.rows.length) refuse();
  });
}
