// SPDX-License-Identifier: GPL-3.0-only
// P5-archive, P5-structure, P5-provenance, P5-zones and P5-loads: ADIF's
// definitions are in the engine, in the frame's schema, after a migration,
// counted against the archive rather than against a list kept here — and the
// archive they came out of was the pinned one (QGD-REF-0001 to 0004, 0007,
// 0014).
//
// It loads through the same functions the shipped product uses, with one
// substitution: the archive bytes are handed over from the cache `make setup`
// wrote instead of fetched from adif.org. The checksum, the zip reading, the
// version check and the load are all the real ones — what is skipped is the
// network, which is not what any of these tests are about.
import { expect } from '@playwright/test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { redact } from './report.mjs';
import { binariesDirectory } from './postgres-build.mjs';
import { initialise, start, status, stop } from '../dist/engine/supervisor.js';
import { bringUp } from '../dist/engine/start.js';
import { chooseSocketDirectory, socketCandidates } from '../dist/engine/endpoint.js';
import { connectAs, connectAsSuperuser, provision } from '../dist/engine/roles.js';
import { REFERENCE_SCHEMA } from '../dist/engine/reference/schema.js';
import { counts, ensureAdif, grantRead, loadedSource } from '../dist/engine/reference/load.js';
import { cachePath, obtain, openArchive } from '../dist/engine/reference/fetch.js';
import { entries, read } from '../dist/engine/reference/zip.js';
import { definitionsOf, derive } from '../dist/engine/reference/adif.js';

const build = JSON.parse(await readFile('data/postgres-build.json', 'utf8'));
const register = JSON.parse(await readFile('data/reference-sources.json', 'utf8'));
const release = register.adif;

const cached = resolve('vendor', '.cache', `adif-${release.version}.zip`);
const archiveBytes = await readFile(cached).catch(() => undefined);
if (!archiveBytes) {
  console.error(`ADIF ${release.version}'s archive is not in ${cached}. Fetch it with: make setup`);
  process.exit(1);
}
// Stands in for the network. Counted, so a test that meant to read the cache
// and silently went to the network instead would be visible.
let fetches = 0;
const handOver = async () => { fetches += 1; return archiveBytes; };

const root = await mkdtemp(join(tmpdir(), 'qg-reference-'));
const base = join(root, 'Application Support', 'QSO Graph Desktop');
const paths = {
  binaries: join(binariesDirectory(build), 'bin'),
  data: join(base, 'data'),
  sockets: chooseSocketDirectory(socketCandidates(join(base, 'data'), join(base, 'sockets'))),
  logs: join(base, 'logs')
};
const endpoint = { kind: 'socket', directory: paths.sockets };
const cache = join(base, 'reference');
const migrations = resolve('drizzle');
const notes = [];

try {
  // ---- P5-archive: the pinned archive, and nothing else -------------------
  {
    // The checksum is checked before a byte is read out of it.
    const wrong = { ...release, source: { ...release.source, sha256: 'f'.repeat(64) } };
    let refused;
    try { await obtain(wrong, join(root, 'bad-cache'), handOver); } catch (error) { refused = error; }
    expect(refused, 'an archive whose checksum does not match must be refused').toBeDefined();
    expect(refused.message).toContain('expected SHA-256');
    notes.push('an archive that is not the pinned one is refused, by checksum');

    // A cache holding something else is discarded, not trusted for being a
    // cache. It is the easiest file in this whole path to overwrite.
    const poisoned = join(root, 'poisoned');
    await obtain(release, poisoned, handOver);
    const before = fetches;
    await writeFile(cachePath(poisoned, release), Buffer.from('not an archive'));
    const again = await obtain(release, poisoned, handOver);
    expect(again.fromCache, 'a cache that fails its checksum must not be used').toBe(false);
    expect(fetches, 'and the archive must be fetched again').toBe(before + 1);
    // And a cache that does match is used without fetching.
    const third = await obtain(release, poisoned, handOver);
    expect(third.fromCache).toBe(true);
    expect(fetches).toBe(before + 1);
    notes.push('a cached archive is verified like a fetched one, and replaced when it fails');

    // Read out of the zip by the product's own reader, which walks the
    // central directory rather than the local headers.
    const all = entries(archiveBytes);
    expect(all.length, "ADIF's archive holds many files").toBeGreaterThan(50);
    const definitions = definitionsOf(JSON.parse(read(archiveBytes, release.source.definitions).toString('utf8')));
    expect(definitions.Version).toBe(release.version);
    const onDisk = await readFile(join('vendor', 'adif', release.version, release.source.definitions));
    expect(read(archiveBytes, release.source.definitions).equals(onDisk),
      'what the reader returns must be byte-for-byte what unzip wrote').toBe(true);
    notes.push(`the archive's ${all.length} entries are read in process, byte-identically to unzip`);

    // A release whose archive reports another version is not that release.
    const mislabelled = { ...release, version: '9.9.9' };
    let mismatch;
    try { await openArchive(mislabelled, join(root, 'cache-9'), handOver); } catch (error) { mismatch = error; }
    expect(mismatch, 'an archive reporting another version must be refused').toBeDefined();
  }

  // ---- the engine, up and migrated, then loaded --------------------------
  await initialise(paths);
  const started = await bringUp(paths, endpoint, {
    migrations,
    buildFile: resolve('data/postgres-build.json'),
    reference: { register, cacheDirectory: cache, fetchArchive: handOver }
  });
  expect(started.reference.state, 'the start must have loaded the reference data').toBe('loaded');
  expect(await status(paths)).toBe('running');

  const archive = await openArchive(release, cache, handOver);
  const definitions = archive.definitions;
  const client = await connectAsSuperuser(endpoint);
  try {
    // ---- P5-loads: in the engine, in the frame's schema -------------------
    const schema = await client.query(
      'SELECT 1 FROM information_schema.schemata WHERE schema_name = $1', [REFERENCE_SCHEMA]);
    expect(schema.rowCount, 'the migration must have made the reference schema').toBe(1);
    const tables = await client.query(
      'SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name',
      [REFERENCE_SCHEMA]);
    expect(tables.rows.map(row => row.table_name)).toEqual([
      'data_type', 'enumeration', 'enumeration_value', 'field', 'list', 'source',
      'uninterpreted', 'zone'
    ]);
    notes.push(`the reference data is in ${REFERENCE_SCHEMA}, made by a migration`);

    // ---- P5-structure: counted against the archive ------------------------
    const held = await counts(client);
    const inArchive = {
      data_types: Object.keys(definitions.DataTypes.Records).length,
      fields: Object.keys(definitions.Fields.Records).length,
      enumerations: Object.keys(definitions.Enumerations).length,
      values: Object.values(definitions.Enumerations)
        .reduce((total, enumeration) => total + Object.keys(enumeration.Records ?? {}).length, 0)
    };
    for (const [what, expected] of Object.entries(inArchive)) {
      expect(held[what], `${what}: the engine must hold what the archive holds`).toBe(expected);
    }
    notes.push(`${inArchive.fields} fields, ${inArchive.data_types} data types, ` +
      `${inArchive.enumerations} enumerations and ${inArchive.values} values, each counted from the archive`);

    // A field ADIF defines and this product has never heard of is loaded too
    // (QGD-REF-0004). Picked by asking which fields are not named anywhere in
    // this product's own source, rather than by naming one here.
    const sample = await client.query(
      `SELECT name, data_type, data_types FROM ${REFERENCE_SCHEMA}.field ORDER BY name`);
    expect(sample.rowCount).toBe(inArchive.fields);

    // The two fields whose published data type names two types. A foreign key
    // would have refused both; the cell is kept as published and the
    // resolution recorded beside it (QGD-REF-0011).
    const twoTypes = sample.rows.filter(row => row.data_types.length > 1);
    expect(twoTypes.map(row => row.name).sort()).toEqual(['CREDIT_GRANTED', 'CREDIT_SUBMITTED']);
    for (const row of twoTypes) {
      expect(row.data_type, 'the published cell is kept as published').toBe('CreditList,AwardList');
      expect(row.data_types).toEqual(['CreditList', 'AwardList']);
    }
    const names = new Set((await client.query(
      `SELECT name FROM ${REFERENCE_SCHEMA}.data_type`)).rows.map(row => row.name));
    for (const row of sample.rows) {
      for (const type of row.data_types) {
        expect(names.has(type), `${row.name}'s data type ${type} must be one ADIF defines`).toBe(true);
      }
    }
    notes.push('the two fields publishing two data types in one cell are both loaded, cell intact');

    // ---- P5-unsupplied-enumeration: the DARC fields ----------------------
    const darc = await client.query(
      `SELECT name, data_type, enumeration_ref, enumeration_name FROM ${REFERENCE_SCHEMA}.field
       WHERE name IN ('DARC_DOK', 'MY_DARC_DOK') ORDER BY name`);
    expect(darc.rowCount).toBe(2);
    for (const row of darc.rows) {
      expect(row.data_type).toBe('Enumeration');
      expect(row.enumeration_ref, `${row.name} names no enumeration`).toBeNull();
      expect(row.enumeration_name).toBeNull();
    }
    notes.push('DARC_DOK and MY_DARC_DOK are loaded as Enumeration fields naming no enumeration');

    // And the parameterised references are kept whole and split.
    const state = await client.query(
      `SELECT enumeration_ref, enumeration_name, enumeration_parameter FROM ${REFERENCE_SCHEMA}.field
       WHERE name = 'STATE'`);
    expect(state.rows[0].enumeration_ref).toBe('Primary_Administrative_Subdivision[DXCC]');
    expect(state.rows[0].enumeration_name).toBe('Primary_Administrative_Subdivision');
    expect(state.rows[0].enumeration_parameter).toBe('DXCC');

    // ---- P5-zones: derived, recorded as derived, and partial -------------
    const derived = derive(definitions);
    const stored = await client.query(
      `SELECT kind, count(*)::int AS held, min(number)::int AS lowest, max(number)::int AS highest,
              min(authority) AS authority, min(derived_from) AS derived_from
       FROM ${REFERENCE_SCHEMA}.zone GROUP BY kind ORDER BY kind`);
    expect(stored.rows.map(row => row.kind)).toEqual(['cq', 'itu']);
    for (const row of stored.rows) {
      const expected = derived.zones.filter(zone => zone.kind === row.kind);
      expect(row.held, `${row.kind}: the stored zones must be the derived ones`).toBe(expected.length);
      expect(row.derived_from).toContain('Primary_Administrative_Subdivision.');
      // The authority is the owner, never ADIF.
      expect(row.authority).not.toContain('ADIF');
    }
    const cq = stored.rows.find(row => row.kind === 'cq');
    const itu = stored.rows.find(row => row.kind === 'itu');
    expect(cq.authority).toBe('CQ Magazine');
    expect(itu.authority).toBe('International Telecommunication Union');
    expect(cq.lowest).toBeGreaterThanOrEqual(1);
    expect(cq.highest).toBeLessThanOrEqual(40);
    expect(itu.highest).toBeLessThanOrEqual(90);
    // And ADIF publishes no such enumeration, which is why they are derived.
    const asList = await client.query(
      `SELECT name FROM ${REFERENCE_SCHEMA}.enumeration WHERE name ~* '^(CQ|ITU)_?Zone'`);
    expect(asList.rowCount, 'ADIF publishes no zone enumeration; one would make the derivation wrong').toBe(0);

    // QGD-REF-0015. The derivation reaches 152 of the 1,965 subdivisions, so
    // what it yields is a coverage list: it must stay plainly short of CQ's
    // 40 and the ITU's 90. A later change that "completed" either list would
    // mean this product had written another organisation's list by hand.
    expect(derived.coverage.subdivisions).toBe(
      Object.keys(definitions.Enumerations.Primary_Administrative_Subdivision.Records).length);
    expect(derived.coverage.withZone, 'ADIF fills the zone columns for a small minority of subdivisions')
      .toBeLessThan(derived.coverage.subdivisions / 4);
    expect(cq.held, 'the derivation cannot yield all 40 CQ zones, and must not pretend to').toBeLessThan(40);
    expect(itu.held, 'nor all 90 ITU zones').toBeLessThan(90);
    notes.push(`${cq.held} of CQ's 40 zones and ${itu.held} of the ITU's 90, derived from ` +
      `${derived.coverage.withZone} of ${derived.coverage.subdivisions} subdivisions in ` +
      `${derived.coverage.entities} entities — a coverage list, recorded as derived`);

    // The cells the derivation could not read are kept as published and
    // flagged, not skipped. The first version of this derivation dropped all
    // three in silence, which is the whole reason the table exists.
    const unread = await client.query(
      `SELECT relation, key, "column", cell, note FROM ${REFERENCE_SCHEMA}.uninterpreted ORDER BY key, "column"`);
    // Counted from the archive, not written here: every subdivision cell with
    // a part that is not a zone number, in either column. Three distinct cell
    // values across however many subdivisions carry them.
    const expectedUnread = [];
    for (const [key, row] of Object.entries(
      definitions.Enumerations.Primary_Administrative_Subdivision.Records)) {
      for (const column of ['CQ Zone', 'ITU Zone']) {
        const cell = row[column];
        if (!cell) continue;
        if (cell.split(',').some(part => !/^\d+$/.test(part.trim()))) expectedUnread.push([key, column, cell]);
      }
    }
    expect(unread.rowCount, 'every unreadable cell must be recorded, and only those')
      .toBe(expectedUnread.length);
    expect([...new Set(unread.rows.map(row => row.cell))].sort())
      .toEqual(['06/07', '07/08', 'S=16 T=17']);
    for (const row of unread.rows) {
      expect(row.relation).toBe('Primary_Administrative_Subdivision');
      expect(['CQ Zone', 'ITU Zone']).toContain(row.column);
      expect(row.note).toBeTruthy();
      // Stored exactly as published: the cell is in the archive, unchanged.
      const published =
        definitions.Enumerations.Primary_Administrative_Subdivision.Records[row.key][row.column];
      expect(row.cell, 'the cell must be stored exactly as published').toBe(published);
    }
    // And nothing was derived from them: no zone's count includes a cell that
    // could not be read.
    expect(derived.zones.some(zone => zone.number === 0)).toBe(false);
    notes.push(`${unread.rowCount} zone cells holding one of 3 notations that are not zone numbers ` +
      'are stored as published and flagged uninterpreted');

    // ---- P5-provenance: the owner and the copy, as two facts -------------
    const source = await loadedSource(client, 'adif');
    expect(source.version).toBe(release.version);
    expect(source.sha256).toBe(release.source.sha256);
    expect(source.fetchedAt instanceof Date).toBe(true);
    expect(source.rowCount).toBe(inArchive.values);

    const lists = await client.query(
      `SELECT id, authority, copy, source_id, supplied, derived, row_count FROM ${REFERENCE_SCHEMA}.list ORDER BY id`);
    expect(lists.rowCount, 'every ADIF list in the register must be in the database').toBe(
      register.lists.filter(list => list.source === 'adif' || list.source === null).length);
    for (const row of lists.rows) {
      expect(row.authority, `${row.id} must record who owns it`).toBeTruthy();
      expect(row.copy, `${row.id} must record where this copy came from`).toBeTruthy();
      expect(row.authority).not.toBe(row.copy);
      // A list ADIF does not supply holds nothing, and says so with null
      // rather than with 0: not supplied and supplied-but-empty are
      // different answers (QGD-REF-0006).
      if (!row.supplied && !row.derived) expect(row.row_count).toBeNull();
      else expect(row.row_count).toBeGreaterThan(0);
    }
    const dxcc = lists.rows.find(row => row.id === 'dxcc-entities');
    expect(dxcc.authority).toContain('ARRL');
    expect(dxcc.row_count).toBe(Object.keys(definitions.Enumerations.DXCC_Entity_Code.Records).length);
    const dok = lists.rows.find(row => row.id === 'darc-dok');
    expect(dok.supplied).toBe(false);
    expect(dok.row_count).toBeNull();
    notes.push(`${lists.rowCount} lists recorded with their owner and their copy as separate facts`);

    // Deleted and import-only are lifted out where validation turns on them,
    // and the published row is still whole underneath.
    const deleted = await client.query(
      `SELECT value FROM ${REFERENCE_SCHEMA}.enumeration_value
       WHERE enumeration = 'DXCC_Entity_Code' AND deleted LIMIT 1`);
    expect(deleted.rowCount, 'ADIF marks some DXCC entities deleted').toBe(1);
    expect(deleted.rows[0].value.Deleted).toBe('true');
    expect(deleted.rows[0].value['Entity Name']).toBeTruthy();
    const importOnly = await client.query(
      `SELECT count(*)::int AS held FROM ${REFERENCE_SCHEMA}.enumeration_value
       WHERE enumeration = 'Mode' AND import_only`);
    expect(importOnly.rows[0].held).toBe(
      Object.values(definitions.Enumerations.Mode.Records).filter(row => row['Import-only']).length);
    notes.push('deleted and import-only values are kept, flagged, with the published row whole');

    // ---- loading again, and a torn load ----------------------------------
    expect(await ensureAdif(client, definitions, register), 'the same release must not be reloaded').toBe('current');
    // A source row with no data behind it is what a torn load would leave.
    // It is reloaded rather than believed.
    await client.query(`DELETE FROM ${REFERENCE_SCHEMA}.enumeration_value WHERE enumeration = 'Mode'`);
    const again = await ensureAdif(client, definitions, register);
    expect(again, 'a load whose rows are gone must happen again').not.toBe('current');
    expect((await counts(client)).values).toBe(inArchive.values);
    notes.push('the same release is not reloaded, and a load whose rows are missing is');

    // ---- QGD-ENG-0010: an application reads it through a grant -----------
    const grant = await provision(client, 'adif');
    await grantRead(client, grant.role);
    const asApplication = await connectAs(endpoint, grant);
    try {
      const modes = await asApplication.query(
        `SELECT count(*)::int AS held FROM ${REFERENCE_SCHEMA}.enumeration_value WHERE enumeration = 'Mode'`);
      expect(modes.rows[0].held).toBe(Object.keys(definitions.Enumerations.Mode.Records).length);
      // Read, and nothing more: the reference data is the frame's.
      let refused;
      try {
        await asApplication.query(`DELETE FROM ${REFERENCE_SCHEMA}.enumeration_value WHERE enumeration = 'Mode'`);
      } catch (error) { refused = error; }
      expect(refused, 'an application must not be able to change the reference data').toBeDefined();
      expect(refused.code, 'refused for want of privilege').toBe('42501');
    } finally {
      await asApplication.end();
    }
    notes.push('an application reads the reference data through a grant and cannot change it');
  } finally {
    await client.end();
  }

  // ---- QGD-REF-0014: a load that cannot happen does not stop the engine ---
  {
    await stop(paths);
    const empty = join(root, 'no-cache-at-all');
    const offline = async () => { throw new Error('getaddrinfo ENOTFOUND adif.org.uk'); };
    const warnings = [];
    // A second data directory, so this is a first run with no network rather
    // than a restart of a database that already has the data.
    const fresh = {
      ...paths,
      data: join(root, 'offline', 'data'),
      logs: join(root, 'offline', 'logs')
    };
    fresh.sockets = chooseSocketDirectory(socketCandidates(fresh.data, join(root, 'offline', 'sockets')));
    const freshEndpoint = { kind: 'socket', directory: fresh.sockets };
    try {
      const up = await bringUp(fresh, freshEndpoint, {
        migrations,
        buildFile: resolve('data/postgres-build.json'),
        reference: { register, cacheDirectory: empty, fetchArchive: offline },
        onWarning: (message, fields) => warnings.push([message, fields])
      });
      expect(up.reference.state, 'a load that cannot happen is unavailable').toBe('unavailable');
      expect(up.reference.reason).toContain('ENOTFOUND');
      expect(await status(fresh), 'and the engine is up regardless').toBe('running');
      expect(warnings.some(([message]) => message === 'reference data not loaded'),
        'and it is said once, in the log').toBe(true);

      // Not loaded is an answer the database can give, not a silence.
      const offlineClient = await connectAsSuperuser(freshEndpoint);
      try {
        expect(await loadedSource(offlineClient, 'adif')).toBeUndefined();
        expect((await counts(offlineClient)).values).toBe(0);
      } finally {
        await offlineClient.end();
      }
      notes.push('a first run with no network reaches a migrated engine whose reference data is reported not loaded');
    } finally {
      await stop(fresh).catch(() => {});
      await rm(fresh.sockets, { recursive: true, force: true });
    }
  }

  expect(fetches, 'every archive in this run came from the handed-over bytes').toBeGreaterThan(0);
  console.log(`Reference load: ${notes.length} checks: PASS`);
  for (const note of notes) console.log(`  ${note}`);
} catch (error) {
  console.error('Reference load failed.');
  console.error(redact(error.message).split('\n').slice(0, 20).join('\n'));
  if (error.detail) console.error(redact(String(error.detail)).split('\n').slice(0, 10).join('\n'));
  process.exitCode = 1;
} finally {
  await stop(paths).catch(() => {});
  await rm(root, { recursive: true, force: true });
  await rm(paths.sockets, { recursive: true, force: true });
}
