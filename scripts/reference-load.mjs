// SPDX-License-Identifier: GPL-3.0-only
// P5-archive, P5-structure, P5-provenance, P5-zones and P5-loads: ADIF's
// definitions are in reference.sqlite, built by the frame from the pinned
// archive, counted against the archive rather than against a list kept here
// (QGD-REF-0001 to 0004, 0007, 0014; QGD-ENG-0015).
//
// It builds through the same code the shipped product uses (Reference, the
// build, the checks), with one substitution: the archive bytes are handed over
// from the cache `make setup` wrote instead of fetched from adif.org. The
// checksum, the zip reading, the version check and the build are all the real
// ones. What is skipped is the network, which none of these tests are about.
// POTA is refused here so this suite is ADIF's alone; POTA is pota-load's.
import { expect } from '@playwright/test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { redact } from './report.mjs';
import { cachePath, obtain, openArchive } from '../dist/reference/fetch.js';
import { entries, read } from '../dist/reference/zip.js';
import { definitionsOf, derive } from '../dist/reference/adif.js';
import { layout, openState } from '../dist/storage/layout.js';
import { Reference } from '../dist/storage/reference.js';
import { buildReference } from '../dist/storage/reference-build.js';

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
const noPota = async () => { throw new Error('POTA is not part of this suite'); };
const build = (target, ddl, inputs) => buildReference(target, ddl, inputs);

const root = await mkdtemp(join(tmpdir(), 'qg-reference-'));
const paths = layout(join(root, 'QSO Graph Desktop'));
const DDL = resolve('drizzle/reference');
const STATE = resolve('drizzle/state');
const notes = [];
const opened = [];

// Rows as objects, from the read-only handle on the built file. The SQL is
// written here in full; nothing is interpolated into it.
const rows = (store, text, ...params) => store.connection.prepare(text).all(...params);
const json = (cell) => JSON.parse(cell);


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


  // ---- the file, built by a first refresh ---------------------------------
  const state = await openState(paths, STATE, 'reference-load');
  opened.push(state);
  const reference = new Reference({ paths, ddl: DDL, register, state, fetchArchive: handOver, fetchText: noPota, build });
  opened.push(reference);
  const first = await reference.refresh();
  expect(first.built, 'the first refresh must have built the file').toBe(true);
  expect(first.status.adif.state, 'and loaded ADIF into it').toBe('loaded');

  const archive = await openArchive(release, paths.referenceCache, handOver);
  const definitions = archive.definitions;
  const store = reference.reader();
  expect(store, 'the built file must open read-only').toBeDefined();
  expect(store.readOnly).toBe(true);

  // ---- P5-loads: in reference.sqlite, from the declared schema -----------
  const tables = rows(store, "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").map(row => row.name);
  expect(tables).toEqual([
    'data_type', 'enumeration', 'enumeration_value', 'field', 'list',
    'pota_location', 'pota_park', 'pota_park_location', 'pota_program',
    'source', 'uninterpreted', 'zone'
  ]);
  notes.push('the reference data is in reference.sqlite, built from the declared schema');

  // ---- P5-structure: counted against the archive ------------------------
  const counted = rows(store, `
    SELECT (SELECT count(*) FROM data_type) AS data_types, (SELECT count(*) FROM field) AS fields,
           (SELECT count(*) FROM enumeration) AS enumerations, (SELECT count(*) FROM enumeration_value) AS "values"`)[0];
  const inArchive = {
    data_types: Object.keys(definitions.DataTypes.Records).length,
    fields: Object.keys(definitions.Fields.Records).length,
    enumerations: Object.keys(definitions.Enumerations).length,
    values: Object.values(definitions.Enumerations)
      .reduce((total, enumeration) => total + Object.keys(enumeration.Records ?? {}).length, 0)
  };
  for (const [what, expected] of Object.entries(inArchive)) {
    expect(counted[what], `${what}: the file must hold what the archive holds`).toBe(expected);
  }
  notes.push(`${inArchive.fields} fields, ${inArchive.data_types} data types, ` +
    `${inArchive.enumerations} enumerations and ${inArchive.values} values, each counted from the archive`);

  const sample = rows(store, 'SELECT name, data_type, data_types FROM field ORDER BY name')
    .map(row => ({ ...row, data_types: json(row.data_types) }));
  expect(sample.length).toBe(inArchive.fields);

  // The two fields whose published data type names two types (QGD-REF-0011).
  const twoTypes = sample.filter(row => row.data_types.length > 1);
  expect(twoTypes.map(row => row.name).sort()).toEqual(['CREDIT_GRANTED', 'CREDIT_SUBMITTED']);
  for (const row of twoTypes) {
    expect(row.data_type, 'the published cell is kept as published').toBe('CreditList,AwardList');
    expect(row.data_types).toEqual(['CreditList', 'AwardList']);
  }
  const names = new Set(rows(store, 'SELECT name FROM data_type').map(row => row.name));
  for (const row of sample) {
    for (const type of row.data_types) {
      expect(names.has(type), `${row.name}'s data type ${type} must be one ADIF defines`).toBe(true);
    }
  }
  notes.push('the two fields publishing two data types in one cell are both loaded, cell intact');

  // ---- P5-unsupplied-enumeration: the DARC fields ----------------------
  const darc = rows(store, `SELECT name, data_type, enumeration_ref, enumeration_name FROM field
     WHERE name IN ('DARC_DOK', 'MY_DARC_DOK') ORDER BY name`);
  expect(darc.length).toBe(2);
  for (const row of darc) {
    expect(row.data_type).toBe('Enumeration');
    expect(row.enumeration_ref, `${row.name} names no enumeration`).toBeNull();
    expect(row.enumeration_name).toBeNull();
  }
  notes.push('DARC_DOK and MY_DARC_DOK are loaded as Enumeration fields naming no enumeration');

  const stateField = rows(store, "SELECT enumeration_ref, enumeration_name, enumeration_parameter FROM field WHERE name = 'STATE'")[0];
  expect(stateField.enumeration_ref).toBe('Primary_Administrative_Subdivision[DXCC]');
  expect(stateField.enumeration_name).toBe('Primary_Administrative_Subdivision');
  expect(stateField.enumeration_parameter).toBe('DXCC');

  // ---- P5-zones: derived, recorded as derived, and partial -------------
  const derived = derive(definitions);
  const stored = rows(store, `
    SELECT kind, count(*) AS held, min(number) AS lowest, max(number) AS highest,
           min(authority) AS authority, min(derived_from) AS derived_from
      FROM zone GROUP BY kind ORDER BY kind`);
  expect(stored.map(row => row.kind)).toEqual(['cq', 'itu']);
  for (const row of stored) {
    const expected = derived.zones.filter(zone => zone.kind === row.kind);
    expect(row.held, `${row.kind}: the stored zones must be the derived ones`).toBe(expected.length);
    expect(row.derived_from).toContain('Primary_Administrative_Subdivision.');
    expect(row.authority).not.toContain('ADIF');
  }
  const cq = stored.find(row => row.kind === 'cq');
  const itu = stored.find(row => row.kind === 'itu');
  expect(cq.authority).toBe('CQ Magazine');
  expect(itu.authority).toBe('International Telecommunication Union');
  expect(cq.lowest).toBeGreaterThanOrEqual(1);
  expect(cq.highest).toBeLessThanOrEqual(40);
  expect(itu.highest).toBeLessThanOrEqual(90);
  // ADIF publishes no zone enumeration, which is why they are derived.
  const asList = rows(store, 'SELECT name FROM enumeration').filter(row => /^(CQ|ITU)_?Zone/i.test(row.name));
  expect(asList.length, 'ADIF publishes no zone enumeration; one would make the derivation wrong').toBe(0);

  // QGD-REF-0015: a coverage list, plainly short of CQ's 40 and the ITU's 90.
  expect(derived.coverage.subdivisions).toBe(
    Object.keys(definitions.Enumerations.Primary_Administrative_Subdivision.Records).length);
  expect(derived.coverage.withZone, 'ADIF fills the zone columns for a small minority of subdivisions')
    .toBeLessThan(derived.coverage.subdivisions / 4);
  expect(cq.held, 'the derivation cannot yield all 40 CQ zones, and must not pretend to').toBeLessThan(40);
  expect(itu.held, 'nor all 90 ITU zones').toBeLessThan(90);
  notes.push(`${cq.held} of CQ's 40 zones and ${itu.held} of the ITU's 90, derived from ` +
    `${derived.coverage.withZone} of ${derived.coverage.subdivisions} subdivisions in ` +
    `${derived.coverage.entities} entities — a coverage list, recorded as derived`);

  // The cells the derivation could not read are kept as published and flagged.
  const unread = rows(store, 'SELECT relation, key, "column", cell, note FROM uninterpreted ORDER BY key, "column"');
  const expectedUnread = [];
  for (const [key, row] of Object.entries(definitions.Enumerations.Primary_Administrative_Subdivision.Records)) {
    for (const column of ['CQ Zone', 'ITU Zone']) {
      const cell = row[column];
      if (!cell) continue;
      if (cell.split(',').some(part => !/^\d+$/.test(part.trim()))) expectedUnread.push([key, column, cell]);
    }
  }
  expect(unread.length, 'every unreadable cell must be recorded, and only those').toBe(expectedUnread.length);
  expect([...new Set(unread.map(row => row.cell))].sort()).toEqual(['06/07', '07/08', 'S=16 T=17']);
  for (const row of unread) {
    expect(row.relation).toBe('Primary_Administrative_Subdivision');
    expect(['CQ Zone', 'ITU Zone']).toContain(row.column);
    expect(row.note).toBeTruthy();
    const published = definitions.Enumerations.Primary_Administrative_Subdivision.Records[row.key][row.column];
    expect(row.cell, 'the cell must be stored exactly as published').toBe(published);
  }
  expect(derived.zones.some(zone => zone.number === 0)).toBe(false);
  notes.push(`${unread.length} zone cells holding one of 3 notations that are not zone numbers ` +
    'are stored as published and flagged uninterpreted');

  // ---- P5-provenance: the owner and the copy, as two facts -------------
  const source = rows(store, "SELECT version, sha256, fetched_at, row_count FROM source WHERE id = 'adif'")[0];
  expect(source.version).toBe(release.version);
  expect(source.sha256).toBe(release.source.sha256);
  expect(Number.isNaN(Date.parse(source.fetched_at)), 'the fetch time is a time').toBe(false);
  expect(source.row_count).toBe(inArchive.values);

  const lists = rows(store, 'SELECT id, authority, copy, source_id, supplied, derived, row_count FROM list ORDER BY id');
  expect(lists.length, 'every ADIF list in the register must be in the file').toBe(
    register.lists.filter(list => list.source === 'adif' || list.source === null).length);
  for (const row of lists) {
    expect(row.authority, `${row.id} must record who owns it`).toBeTruthy();
    expect(row.copy, `${row.id} must record where this copy came from`).toBeTruthy();
    expect(row.authority).not.toBe(row.copy);
    // Not supplied is null, never 0 (QGD-REF-0006).
    if (!row.supplied && !row.derived) expect(row.row_count).toBeNull();
    else expect(row.row_count).toBeGreaterThan(0);
  }
  const dxcc = lists.find(row => row.id === 'dxcc-entities');
  expect(dxcc.authority).toContain('ARRL');
  expect(dxcc.row_count).toBe(Object.keys(definitions.Enumerations.DXCC_Entity_Code.Records).length);
  const dok = lists.find(row => row.id === 'darc-dok');
  expect(dok.supplied).toBe(0);
  expect(dok.row_count).toBeNull();
  notes.push(`${lists.length} lists recorded with their owner and their copy as separate facts`);

  // Deleted and import-only are lifted out, and the published row is whole.
  const deleted = rows(store, "SELECT value FROM enumeration_value WHERE enumeration = 'DXCC_Entity_Code' AND deleted LIMIT 1");
  expect(deleted.length, 'ADIF marks some DXCC entities deleted').toBe(1);
  const deletedRow = json(deleted[0].value);
  expect(deletedRow.Deleted).toBe('true');
  expect(deletedRow['Entity Name']).toBeTruthy();
  const importOnly = rows(store, "SELECT count(*) AS held FROM enumeration_value WHERE enumeration = 'Mode' AND import_only")[0];
  expect(importOnly.held).toBe(
    Object.values(definitions.Enumerations.Mode.Records).filter(row => row['Import-only']).length);
  notes.push('deleted and import-only values are kept, flagged, with the published row whole');

  // ---- refreshing again: the same release is not rebuilt ----------------
  const again = await reference.refresh();
  expect(again.built, 'the same release, already in the file, must not cause a rebuild').toBe(false);
  expect(again.status.adif).toEqual(first.status.adif);
  notes.push('the same release is not rebuilt; the file is the record of what is loaded');

  // ---- an application cannot change it: the file is opened read-only ----
  let refused;
  try { store.connection.exec("DELETE FROM enumeration_value WHERE enumeration = 'Mode'"); } catch (error) { refused = error; }
  expect(refused, 'nothing but a build may change the reference data').toBeDefined();
  expect(refused.errcode & 0xff, 'refused as read-only (SQLITE_READONLY)').toBe(8);
  notes.push('the reference data is opened read-only by everything but a build');

  // ---- QGD-REF-0014: a build that cannot happen does not stop anything ----
  {
    const offlinePaths = layout(join(root, 'offline profile'));
    const offlineState = await openState(offlinePaths, STATE, 'reference-load');
    opened.push(offlineState);
    const offline = async () => { throw new Error('getaddrinfo ENOTFOUND adif.org.uk'); };
    const empty = new Reference({ paths: offlinePaths, ddl: DDL, register, state: offlineState,
      fetchArchive: offline, fetchText: noPota, build });
    opened.push(empty);
    const outcome = await empty.refresh();
    expect(outcome.adif.state, 'a build that cannot happen keeps what there is: nothing').toBe('kept');
    expect(outcome.adif.failure, 'and says why only as a kind, never with the message').toEqual({ kind: 'fetch' });
    expect(outcome.built).toBe(false);
    expect(existsSync(offlinePaths.reference), 'no file is made from nothing').toBe(false);
    expect(outcome.status.adif.state, 'not loaded is an answer, not a silence').toBe('not loaded');
    notes.push('a first run with no network has no reference file, and reports it not loaded');
  }

  expect(fetches, 'every archive in this run came from the handed-over bytes').toBeGreaterThan(0);
  console.log(`Reference load: ${notes.length} checks: PASS`);
  for (const note of notes) console.log(`  ${note}`);
} catch (error) {
  console.error('Reference load failed.');
  console.error(redact(String(error?.message ?? error)).split('\n').slice(0, 20).join('\n'));
  process.exitCode = 1;
} finally {
  for (const handle of opened.reverse()) { try { handle.close(); } catch { /* closing what is left */ } }
  await rm(root, { recursive: true, force: true });
}
